import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  ensureScene,
  bootstrap,
  runCameraCommand,
  runNew,
  runLs,
  serveError,
  HELP,
  writeServedPort,
  readServedPort,
  clearServedPort,
} from "./cli";
import { createServer } from "./server";
import { open } from "./open";

let tmpDir: string;
let servers: Array<{ stop(): void }> = [];

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "duet-cli-test-"));
}

let handles: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  for (const h of handles) {
    try { await h.close(); } catch { /* ignore */ }
  }
  handles = [];
  for (const s of servers) {
    try { s.stop(); } catch { /* ignore */ }
  }
  servers = [];
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

function wsOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) { resolve(); return; }
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", (e) => reject(e), { once: true });
  });
}

function nextSceneMessage(ws: WebSocket, timeoutMs = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout waiting for ws scene message")), timeoutMs);
    ws.addEventListener("message", (e) => {
      clearTimeout(timer);
      resolve(JSON.parse(e.data as string));
    }, { once: true });
  });
}

describe("ensureScene", () => {
  it("creates a valid empty scene when file does not exist", () => {
    tmpDir = makeTmpDir();
    const filePath = path.join(tmpDir, "scene.excalidraw");

    ensureScene(filePath);

    expect(fs.existsSync(filePath)).toBe(true);
    const contents = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(contents.type).toBe("excalidraw");
    expect(contents.version).toBe(2);
    expect(Array.isArray(contents.elements)).toBe(true);
    expect(contents.appState).toBeDefined();
  });

  it("leaves an existing file untouched", () => {
    tmpDir = makeTmpDir();
    const filePath = path.join(tmpDir, "existing.excalidraw");
    const existing = { type: "excalidraw", version: 2, source: "x", elements: [{ id: "abc" }], appState: {}, files: {} };
    const originalBytes = JSON.stringify(existing);
    fs.writeFileSync(filePath, originalBytes, "utf8");

    ensureScene(filePath);

    expect(fs.readFileSync(filePath, "utf8")).toBe(originalBytes);
  });
});

describe("bootstrap", () => {
  it("serves the empty scene after creating a missing file", () => {
    tmpDir = makeTmpDir();
    const filePath = path.join(tmpDir, "new.excalidraw");

    const handle = bootstrap({ filePath, port: 0, openBrowser: () => {} });
    servers.push(handle.server);

    const scene = handle.getScene();
    expect(scene).not.toBeNull();
    expect((scene as any).type).toBe("excalidraw");
    expect(Array.isArray((scene as any).elements)).toBe(true);
    expect((scene as any).elements.length).toBe(0);
  });

  it("serves the existing scene deep-equal to what is on disk", () => {
    tmpDir = makeTmpDir();
    const filePath = path.join(tmpDir, "existing.excalidraw");
    const existingScene = {
      type: "excalidraw",
      version: 2,
      source: "https://excalidraw.com",
      elements: [{ id: "el1", type: "rectangle", x: 10, y: 20 }],
      appState: { viewBackgroundColor: "#ff0000", gridSize: null },
      files: {},
    };
    fs.writeFileSync(filePath, JSON.stringify(existingScene), "utf8");

    const handle = bootstrap({ filePath, port: 0, openBrowser: () => {} });
    servers.push(handle.server);

    expect(handle.getScene()).toEqual(existingScene);
  });

  it("calls the browser opener exactly once with the server URL", () => {
    tmpDir = makeTmpDir();
    const filePath = path.join(tmpDir, "new.excalidraw");
    const openedUrls: string[] = [];

    const handle = bootstrap({
      filePath,
      port: 0,
      openBrowser: (url) => { openedUrls.push(url); },
    });
    servers.push(handle.server);

    expect(openedUrls).toHaveLength(1);
    expect(openedUrls[0]).toBe(`http://localhost:${handle.server.port}/`);
  });

  it("falls back to a free port when the requested one is taken (fallback:true)", () => {
    tmpDir = makeTmpDir();
    const filePath = path.join(tmpDir, "fallback.excalidraw");

    // Occupy a port, then ask bootstrap to bind that same port with fallback on.
    const first = bootstrap({ filePath, port: 0, openBrowser: () => {} });
    servers.push(first.server);
    const taken = first.server.port!;

    const second = bootstrap({ filePath, port: taken, fallback: true, openBrowser: () => {} });
    servers.push(second.server);

    expect(second.server.port).not.toBe(taken);
    expect(second.getScene()).not.toBeNull();
  });

  it("throws on a taken port without fallback (default)", () => {
    tmpDir = makeTmpDir();
    const filePath = path.join(tmpDir, "taken.excalidraw");

    const first = bootstrap({ filePath, port: 0, openBrowser: () => {} });
    servers.push(first.server);
    const taken = first.server.port!;

    expect(() =>
      bootstrap({ filePath, port: taken, openBrowser: () => {} }),
    ).toThrow();
  });

  it("pushes an on-disk file change to a connected ws client (no click)", async () => {
    tmpDir = makeTmpDir();
    const filePath = path.join(tmpDir, "live.excalidraw");

    const handle = bootstrap({ filePath, port: 0, openBrowser: () => {} });
    handles.push(handle);

    const ws = new WebSocket(`ws://localhost:${handle.server.port}/`);
    handles.push({ close: async () => ws.close() });
    await wsOpen(ws);
    await nextSceneMessage(ws); // consume replay

    // give chokidar's ready a moment, then mutate the file on disk
    await new Promise((r) => setTimeout(r, 200));
    const newScene = { type: "excalidraw", version: 2, elements: [{ id: "live1" }], appState: {}, files: {} };
    const pending = nextSceneMessage(ws);
    fs.writeFileSync(filePath, JSON.stringify(newScene), "utf8");

    const msg = await pending;
    expect(msg.type).toBe("scene");
    expect(msg.scene).toEqual(newScene);
    expect(handle.getScene()).toEqual(newScene);
  });

  it("keeps the last good scene on a malformed write and recovers on the next valid one", async () => {
    tmpDir = makeTmpDir();
    const filePath = path.join(tmpDir, "guard.excalidraw");
    const good1 = { type: "excalidraw", version: 2, elements: [{ id: "g1" }], appState: {}, files: {} };
    fs.writeFileSync(filePath, JSON.stringify(good1), "utf8");

    const handle = bootstrap({ filePath, port: 0, openBrowser: () => {} });
    handles.push(handle);
    expect(handle.getScene()).toEqual(good1);

    await new Promise((r) => setTimeout(r, 200));

    // malformed write: scene must not change
    fs.writeFileSync(filePath, "{ broken json", "utf8");
    await new Promise((r) => setTimeout(r, 500));
    expect(handle.getScene()).toEqual(good1);

    // valid write recovers
    const ws = new WebSocket(`ws://localhost:${handle.server.port}/`);
    handles.push({ close: async () => ws.close() });
    await wsOpen(ws);
    await nextSceneMessage(ws); // replay = good1

    const good2 = { type: "excalidraw", version: 2, elements: [{ id: "g2" }], appState: {}, files: {} };
    const pending = nextSceneMessage(ws);
    fs.writeFileSync(filePath, JSON.stringify(good2), "utf8");
    const msg = await pending;
    expect(msg.scene).toEqual(good2);
    expect(handle.getScene()).toEqual(good2);
  });
});

// ─── Slice 6: full write→watch→push→onChange→write loop + echo guard ──────────

// Count every {type:"scene"} broadcast for a bounded window, ignoring the
// initial replay. Lets us assert a self-write produces ZERO broadcasts (echo
// guard) while an external write produces one.
function collectScenes(ws: WebSocket): { scenes: any[] } {
  const scenes: any[] = [];
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data as string);
    if (msg.type === "scene") scenes.push(msg.scene);
  });
  return { scenes };
}

describe("browser write-back echo guard (full loop)", () => {
  it("a browser save writes the file and broadcasts the merged scene exactly once (echo guard suppresses the watcher's duplicate); an external write DOES broadcast", async () => {
    tmpDir = makeTmpDir();
    const filePath = path.join(tmpDir, "loop.excalidraw");

    const handle = bootstrap({ filePath, port: 0, openBrowser: () => {} });
    handles.push(handle);

    const ws = new WebSocket(`ws://localhost:${handle.server.port}/`);
    handles.push({ close: async () => ws.close() });
    await wsOpen(ws);
    await nextSceneMessage(ws); // consume replay

    // chokidar ready settle
    await new Promise((r) => setTimeout(r, 250));

    const collector = collectScenes(ws);

    // 1. Browser save → server writes the file via the shared echo guard.
    const drawn = [{ id: "by-human", type: "rectangle" }];
    ws.send(JSON.stringify({ type: "save", elements: drawn, appState: { viewBackgroundColor: "#eee" } }));

    // Wait for the file to actually be written (positive: poll). This proves the
    // loop runs end-to-end (save → server write), not that nothing happened.
    let written: any = { elements: [] };
    for (let i = 0; i < 100; i++) {
      written = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (written.elements.length > 0) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(written.elements).toEqual(drawn);
    // ADR-0007: the server broadcasts the MERGED scene to ALL tabs including the
    // sender (one direct server.publish). The echo guard still suppresses the
    // SECOND broadcast that the watcher would otherwise emit from this write's
    // file event — so the sender sees exactly ONE scene message, not a storm.
    await new Promise((r) => setTimeout(r, 800));
    expect(collector.scenes.length).toBe(1); // exactly one: the merged broadcast
    expect((collector.scenes[0] as any).elements).toEqual(drawn);

    // 2. External (agent) write with DIFFERENT bytes → must broadcast (a second).
    const agentScene = { type: "excalidraw", version: 2, elements: [{ id: "by-agent" }], appState: {}, files: {} };
    fs.writeFileSync(filePath, JSON.stringify(agentScene), "utf8");
    for (let i = 0; i < 150; i++) {
      if (collector.scenes.length > 1) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(collector.scenes.length).toBe(2);
    expect(collector.scenes[1]).toEqual(agentScene);
  });
});

// ─── Issue #7: agent save({source}) reaches watcher + broadcasts (no echo suppression) ─

describe("agent save reaches watcher and broadcasts (issue #7 AC4)", () => {
  it("an agent save() is NOT echo-suppressed: watcher fires and broadcasts to tabs", async () => {
    tmpDir = makeTmpDir();
    const filePath = path.join(tmpDir, "agent.excalidraw");

    const handle = bootstrap({ filePath, port: 0, openBrowser: () => {} });
    handles.push(handle);

    const ws = new WebSocket(`ws://localhost:${handle.server.port}/`);
    handles.push({ close: async () => ws.close() });
    await wsOpen(ws);
    await nextSceneMessage(ws); // consume initial replay

    // chokidar ready settle
    await new Promise((r) => setTimeout(r, 250));

    // Agent loads the file and saves with a new element — no guard involved.
    const scene = open(filePath);
    const elements = scene.list();
    elements.push({ id: "agent-el", type: "rectangle", x: 0, y: 0, width: 50, height: 50 } as any);

    const broadcastP = nextSceneMessage(ws);
    scene.save({ source: "my-agent" });

    // The watcher must pick this up and broadcast to the tab.
    const msg = await broadcastP;
    expect(msg.scene.source).toBe("my-agent");
    expect(msg.scene.elements.some((e: any) => e.id === "agent-el")).toBe(true);
  });
});

// ─── Issue #22: duet camera fit CLI client + exit codes ──────────────────────

function makeFakeDistDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "duet-camera-test-dist-"));
  fs.writeFileSync(path.join(dir, "index.html"), "<html><body>duet</body></html>");
  return dir;
}

describe("HELP", () => {
  it("documents the commands and the camera's discovery-critical flags", () => {
    // An agent reads --help to learn the commands and how to drive the camera,
    // so the text must name them and the flags it needs.
    expect(HELP).toContain("duet new");
    expect(HELP).toContain("duet serve");
    expect(HELP).toContain("duet camera");
    expect(HELP).toContain("--to");
    expect(HELP).toContain("--no-animate");
    expect(HELP).toContain("--port");
    expect(HELP).toContain("framed");
    expect(HELP).toContain("duet camera fit");
  });

  it("documents `duet ls` and its --json flag", () => {
    expect(HELP).toContain("duet ls");
    expect(HELP).toContain("--json");
  });

  it("lists the planned camera ops and marks them not implemented", () => {
    expect(HELP).toContain("camera zoom");
    expect(HELP).toContain("camera pan");
    expect(HELP).toContain("Not implemented");
  });

  it("documents the camera exit codes and failure shapes", () => {
    // The failure contract must be learnable from --help alone.
    expect(HELP).toContain("missing");
    expect(HELP).toContain("exit 1");
    expect(HELP).toContain("exit 2");
  });

  it("does not leak the internal 'camera client' wording in the --port help", () => {
    expect(HELP).not.toContain("camera client");
  });

  it("is printed by the binary for --help on stdout, exit 0", async () => {
    const proc = Bun.spawn(["bun", "run", "src/cli.ts", "--help"], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await new Response(proc.stdout).text();
    const code = await proc.exited;
    expect(code).toBe(0);
    expect(out).toContain("duet serve");
    expect(out).toContain("duet camera");
    expect(out).toContain("--to");
  });
});

describe("camera op dispatch (binary)", () => {
  async function runCli(args: string[]): Promise<{ code: number; err: string }> {
    const proc = Bun.spawn(["bun", "run", "src/cli.ts", ...args], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });
    const err = await new Response(proc.stderr).text();
    const code = await proc.exited;
    return { code, err };
  }

  it("rejects `camera zoom` as not implemented, exit 1", async () => {
    const { code, err } = await runCli(["camera", "zoom"]);
    expect(code).toBe(1);
    expect(err).toContain("not implemented");
  });

  it("rejects `camera pan` as not implemented, exit 1", async () => {
    const { code, err } = await runCli(["camera", "pan"]);
    expect(code).toBe(1);
    expect(err).toContain("not implemented");
  });

  it("requires an op: bare `camera` errors and points at `camera fit`, exit 1", async () => {
    const { code, err } = await runCli(["camera"]);
    expect(code).toBe(1);
    expect(err).toContain("duet camera fit");
  });

  it("routes `camera fit` to the fit client (exit 2 with no server)", async () => {
    // A dead port proves fit ran: it reaches runCameraCommand's unreachable path.
    const { code } = await runCli(["camera", "fit", "--port", "59999"]);
    expect(code).toBe(2);
  });
});

describe("ls dispatch (binary)", () => {
  async function runCli(args: string[]): Promise<{ code: number; out: string; err: string }> {
    const proc = Bun.spawn(["bun", "run", "src/cli.ts", ...args], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await new Response(proc.stdout).text();
    const err = await new Response(proc.stderr).text();
    const code = await proc.exited;
    return { code, out, err };
  }

  it("routes `duet ls <file>` and prints the rows on stdout, exit 0", async () => {
    tmpDir = makeTmpDir();
    const filePath = path.join(tmpDir, "scene.excalidraw");
    fs.writeFileSync(
      filePath,
      JSON.stringify({ type: "excalidraw", version: 2, elements: [{ id: "Qz7Lm2", type: "text", text: "Queue" }], appState: {}, files: {} }),
      "utf8",
    );

    const { code, out } = await runCli(["ls", filePath]);
    expect(code).toBe(0);
    expect(out).toContain("Qz7Lm2");
    expect(out).toContain('"Queue"');
  });

  it("routes `duet ls --json <file>` to JSON output", async () => {
    tmpDir = makeTmpDir();
    const filePath = path.join(tmpDir, "scene.excalidraw");
    fs.writeFileSync(
      filePath,
      JSON.stringify({ type: "excalidraw", version: 2, elements: [{ id: "Qz7Lm2", type: "text", text: "Queue" }], appState: {}, files: {} }),
      "utf8",
    );

    const { code, out } = await runCli(["ls", "--json", filePath]);
    expect(code).toBe(0);
    expect(JSON.parse(out)).toEqual([{ id: "Qz7Lm2", type: "text", label: "Queue" }]);
  });

  it("errors and exits 1 when no file path is given", async () => {
    const { code, err } = await runCli(["ls"]);
    expect(code).toBe(1);
    expect(err).toContain("file path");
  });
});

describe("runNew", () => {
  it("creates a valid empty scene and reports the path, exit 0", () => {
    tmpDir = makeTmpDir();
    const filePath = path.join(tmpDir, "fresh.excalidraw");

    const result = runNew(filePath);

    expect(result.code).toBe(0);
    expect(result.stdout ?? "").toContain(filePath);
    expect(fs.existsSync(filePath)).toBe(true);
    const contents = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(contents.type).toBe("excalidraw");
    expect(Array.isArray(contents.elements)).toBe(true);
  });

  it("refuses to clobber an existing file, exit 1, and leaves bytes untouched", () => {
    tmpDir = makeTmpDir();
    const filePath = path.join(tmpDir, "existing.excalidraw");
    const original = JSON.stringify({ type: "excalidraw", elements: [{ id: "keep" }] });
    fs.writeFileSync(filePath, original, "utf8");

    const result = runNew(filePath);

    expect(result.code).toBe(1);
    expect(result.stderr ?? "").toContain("already exists");
    expect(fs.readFileSync(filePath, "utf8")).toBe(original);
  });

  it("errors with usage when no path is given, exit 1", () => {
    const result = runNew(undefined);
    expect(result.code).toBe(1);
    expect(result.stderr ?? "").toContain("file path");
  });
});

describe("runLs", () => {
  function writeScene(elements: any[]): string {
    tmpDir = makeTmpDir();
    const filePath = path.join(tmpDir, "scene.excalidraw");
    fs.writeFileSync(
      filePath,
      JSON.stringify({ type: "excalidraw", version: 2, source: "x", elements, appState: {}, files: {} }),
      "utf8",
    );
    return filePath;
  }

  it("prints one row per element with id, type and a text element's own text as label", () => {
    const filePath = writeScene([{ id: "Qz7Lm2", type: "text", text: "Queue" }]);

    const result = runLs(filePath, {});

    expect(result.code).toBe(0);
    const lines = (result.stdout ?? "").trimEnd().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Qz7Lm2");
    expect(lines[0]).toContain("text");
    expect(lines[0]).toContain('"Queue"');
  });

  it("folds a container's bound text into its row and gives the bound text no row of its own", () => {
    const filePath = writeScene([
      { id: "aB3xK9", type: "rectangle", boundElements: [{ type: "text", id: "tX1yZ0" }] },
      { id: "tX1yZ0", type: "text", text: "WhatsApp adapter", containerId: "aB3xK9" },
    ]);

    const result = runLs(filePath, {});

    const lines = (result.stdout ?? "").trimEnd().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("aB3xK9");
    expect(lines[0]).toContain("rectangle");
    expect(lines[0]).toContain('"WhatsApp adapter"');
    expect(result.stdout ?? "").not.toContain("tX1yZ0");
  });

  it("shows an empty label for a shape with no text", () => {
    const filePath = writeScene([{ id: "mN4pR8", type: "arrow" }]);

    const result = runLs(filePath, {});

    const lines = (result.stdout ?? "").trimEnd().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("mN4pR8");
    expect(lines[0]).toContain("arrow");
    expect(lines[0]).toContain('""');
  });

  it("skips soft-deleted elements", () => {
    const filePath = writeScene([
      { id: "live01", type: "rectangle" },
      { id: "gone02", type: "rectangle", isDeleted: true },
    ]);

    const result = runLs(filePath, {});

    const lines = (result.stdout ?? "").trimEnd().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("live01");
    expect(result.stdout ?? "").not.toContain("gone02");
  });

  it("with { json: true } emits a parseable array of {id,type,label}", () => {
    const filePath = writeScene([
      { id: "aB3xK9", type: "rectangle", boundElements: [{ type: "text", id: "tX1yZ0" }] },
      { id: "tX1yZ0", type: "text", text: "WhatsApp adapter", containerId: "aB3xK9" },
      { id: "mN4pR8", type: "arrow" },
    ]);

    const result = runLs(filePath, { json: true });

    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout ?? "[]");
    expect(parsed).toEqual([
      { id: "aB3xK9", type: "rectangle", label: "WhatsApp adapter" },
      { id: "mN4pR8", type: "arrow", label: "" },
    ]);
  });

  it("aligns the type column so labels start at the same offset across rows", () => {
    const filePath = writeScene([
      { id: "aB3xK9", type: "rectangle", boundElements: [{ type: "text", id: "tX1yZ0" }] },
      { id: "tX1yZ0", type: "text", text: "WhatsApp adapter", containerId: "aB3xK9" },
      { id: "Qz7Lm2", type: "text", text: "Queue" },
    ]);

    const result = runLs(filePath, {});

    const lines = (result.stdout ?? "").trimEnd().split("\n");
    // The label (opening quote) starts at the same column on every row.
    const offsets = lines.map((l) => l.indexOf('"'));
    expect(new Set(offsets).size).toBe(1);
  });

  it("errors with usage when no path is given, exit 1", () => {
    const result = runLs(undefined, {});
    expect(result.code).toBe(1);
    expect(result.stderr ?? "").toContain("file path");
  });

  it("errors on a missing file, exit 1", () => {
    tmpDir = makeTmpDir();
    const filePath = path.join(tmpDir, "ghost.excalidraw");

    const result = runLs(filePath, {});
    expect(result.code).toBe(1);
    expect(result.stderr ?? "").toContain(filePath);
  });

  it("errors on malformed JSON, exit 1", () => {
    tmpDir = makeTmpDir();
    const filePath = path.join(tmpDir, "broken.excalidraw");
    fs.writeFileSync(filePath, "{ not valid", "utf8");

    const result = runLs(filePath, {});
    expect(result.code).toBe(1);
    expect(result.stderr ?? "").toContain("could not read");
  });
});

describe("serveError", () => {
  it("returns null (safe to serve) when the file exists", () => {
    tmpDir = makeTmpDir();
    const filePath = path.join(tmpDir, "real.excalidraw");
    fs.writeFileSync(filePath, JSON.stringify({ type: "excalidraw", elements: [] }), "utf8");

    expect(serveError(filePath)).toBeNull();
  });

  it("errors on a missing file and points at `duet new`, exit 1", () => {
    tmpDir = makeTmpDir();
    const filePath = path.join(tmpDir, "ghost.excalidraw");

    const result = serveError(filePath);
    expect(result?.code).toBe(1);
    expect(result?.stderr ?? "").toContain("no such scene");
    expect(result?.stderr ?? "").toContain("duet new");
  });

  it("errors with usage when no path is given, exit 1", () => {
    const result = serveError(undefined);
    expect(result?.code).toBe(1);
    expect(result?.stderr ?? "").toContain("file path");
  });
});

describe("runCameraCommand", () => {
  it("returns code 0 with {framed:N} on stdout when server has elements and tabs", async () => {
    const dir = makeFakeDistDir();
    servers.push({ stop: () => fs.rmSync(dir, { recursive: true, force: true }) });
    const srv = createServer({ port: 0, distDir: dir });
    servers.push(srv.server);
    srv.setScene({
      type: "excalidraw", version: 2, elements: [{ id: "el1" }], appState: {}, files: {},
    });

    // Connect a WS tab so framed >= 1
    const ws = new WebSocket(`ws://localhost:${srv.server.port}/`);
    handles.push({ close: async () => ws.close() });
    await wsOpen(ws);
    await nextSceneMessage(ws); // consume replay

    const result = await runCameraCommand(["--port", String(srv.server.port)], {});

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({ framed: 1 });
    expect(result.stderr ?? "").toBe("");
  });

  it("returns code 0 with {framed:0} on stdout and a warning on stderr when zero tabs are connected", async () => {
    const dir = makeFakeDistDir();
    servers.push({ stop: () => fs.rmSync(dir, { recursive: true, force: true }) });
    const srv = createServer({ port: 0, distDir: dir });
    servers.push(srv.server);
    srv.setScene({
      type: "excalidraw", version: 2, elements: [{ id: "el1" }], appState: {}, files: {},
    });
    // No WS tab connected

    const result = await runCameraCommand(["--port", String(srv.server.port)], {});

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({ framed: 0 });
    expect(result.stderr ?? "").toContain("0 tabs");
  });

  it("returns code 1 with {missing:[...]} on stdout when --to references unknown ids", async () => {
    const dir = makeFakeDistDir();
    servers.push({ stop: () => fs.rmSync(dir, { recursive: true, force: true }) });
    const srv = createServer({ port: 0, distDir: dir });
    servers.push(srv.server);
    srv.setScene({
      type: "excalidraw", version: 2, elements: [{ id: "real-el" }], appState: {}, files: {},
    });

    const result = await runCameraCommand(
      ["--port", String(srv.server.port), "--to", "bogus"],
      {},
    );

    expect(result.code).toBe(1);
    const body = JSON.parse(result.stdout ?? "{}");
    expect(body.missing).toContain("bogus");
  }, 2000);

  it("returns code 2 with a stderr hint when no server is reachable", async () => {
    // Start a server just to grab a random port, then stop it before POST
    const dir = makeFakeDistDir();
    servers.push({ stop: () => fs.rmSync(dir, { recursive: true, force: true }) });
    const srv = createServer({ port: 0, distDir: dir });
    const deadPort = srv.server.port;
    srv.server.stop(true);

    const result = await runCameraCommand(["--port", String(deadPort)], {});

    expect(result.code).toBe(2);
    expect(result.stderr ?? "").toContain(String(deadPort));
  });

  it("sends animate:true by default and animate:false with --no-animate (verified via WS camera message)", async () => {
    const dir = makeFakeDistDir();
    servers.push({ stop: () => fs.rmSync(dir, { recursive: true, force: true }) });
    const srv = createServer({ port: 0, distDir: dir });
    servers.push(srv.server);
    srv.setScene({
      type: "excalidraw", version: 2, elements: [{ id: "el1" }], appState: {}, files: {},
    });

    const ws = new WebSocket(`ws://localhost:${srv.server.port}/`);
    handles.push({ close: async () => ws.close() });
    await wsOpen(ws);
    await nextSceneMessage(ws); // consume replay

    // Helper: collect next message of type "camera"
    function nextCameraMsg(): Promise<any> {
      return new Promise((res, rej) => {
        const timer = setTimeout(() => rej(new Error("timeout waiting for camera msg")), 2000);
        ws.addEventListener("message", (e) => {
          const msg = JSON.parse(e.data as string);
          if (msg.type === "camera") { clearTimeout(timer); res(msg); }
        }, { once: true });
      });
    }

    // Default: animate:true
    const p1 = nextCameraMsg();
    await runCameraCommand(["--port", String(srv.server.port)], {});
    const msg1 = await p1;
    expect(msg1.animate).toBe(true);

    // --no-animate: animate:false
    const p2 = nextCameraMsg();
    await runCameraCommand(["--port", String(srv.server.port), "--no-animate"], {});
    const msg2 = await p2;
    expect(msg2.animate).toBe(false);
  }, 5000);

  it("returns code 1 (not 2) with a usage error when --port is not a number", async () => {
    const result = await runCameraCommand(["--port", "abc"], {});

    expect(result.code).toBe(1);
    expect(result.stderr ?? "").toContain("--port requires a number");
    expect(result.stdout ?? "").toBe("");
  });

  it("returns code 1 with a usage error when DUET_PORT env is not a number", async () => {
    const result = await runCameraCommand([], { DUET_PORT: "foo" });

    expect(result.code).toBe(1);
    expect(result.stderr ?? "").toContain("--port requires a number");
  });

  it("resolves port from --port flag first, then DUET_PORT env", async () => {
    const dir = makeFakeDistDir();
    servers.push({ stop: () => fs.rmSync(dir, { recursive: true, force: true }) });
    const srv = createServer({ port: 0, distDir: dir });
    servers.push(srv.server);
    srv.setScene({
      type: "excalidraw", version: 2, elements: [{ id: "el1" }], appState: {}, files: {},
    });
    const p = srv.server.port;

    // --port flag wins over DUET_PORT env
    const r1 = await runCameraCommand(["--port", String(p)], { DUET_PORT: "9999" });
    expect(r1.code).toBe(0);

    // DUET_PORT env used when no --port flag
    const r2 = await runCameraCommand([], { DUET_PORT: String(p) });
    expect(r2.code).toBe(0);
  });

  it("resolves port from the discovery file when neither --port nor DUET_PORT is set", async () => {
    const dir = makeFakeDistDir();
    servers.push({ stop: () => fs.rmSync(dir, { recursive: true, force: true }) });
    const srv = createServer({ port: 0, distDir: dir });
    servers.push(srv.server);
    srv.setScene({
      type: "excalidraw", version: 2, elements: [{ id: "el1" }], appState: {}, files: {},
    });
    const p = srv.server.port!;

    tmpDir = makeTmpDir();
    const portFile = path.join(tmpDir, "duet-serve.json");
    const env = { DUET_PORT_FILE: portFile };
    writeServedPort(env, { port: p, filePath: "/whatever.excalidraw", pid: 1 });

    // No --port, no DUET_PORT: camera should read the discovery file and reach p.
    const result = await runCameraCommand([], env);
    expect(result.code).toBe(0);
    expect(result.stderr ?? "").not.toContain("localhost:3737");
  });

  it("lets --port override the discovery file", async () => {
    const dir = makeFakeDistDir();
    servers.push({ stop: () => fs.rmSync(dir, { recursive: true, force: true }) });
    const srv = createServer({ port: 0, distDir: dir });
    servers.push(srv.server);
    srv.setScene({
      type: "excalidraw", version: 2, elements: [{ id: "el1" }], appState: {}, files: {},
    });
    const p = srv.server.port!;

    tmpDir = makeTmpDir();
    const portFile = path.join(tmpDir, "duet-serve.json");
    const env = { DUET_PORT_FILE: portFile };
    // Discovery points at a dead port; --port must win and reach the live server.
    writeServedPort(env, { port: 65000, filePath: "/x.excalidraw", pid: 1 });

    const result = await runCameraCommand(["--port", String(p)], env);
    expect(result.code).toBe(0);
  });
});

describe("served-port discovery file", () => {
  it("round-trips write → read and clears back to null", () => {
    tmpDir = makeTmpDir();
    const portFile = path.join(tmpDir, "duet-serve.json");
    const env = { DUET_PORT_FILE: portFile };

    expect(readServedPort(env)).toBeNull();

    writeServedPort(env, { port: 3812, filePath: "/scene.excalidraw", pid: 4242 });
    const rec = readServedPort(env);
    expect(rec).not.toBeNull();
    expect(rec!.port).toBe(3812);
    expect(rec!.filePath).toBe("/scene.excalidraw");
    expect(rec!.pid).toBe(4242);

    clearServedPort(env);
    expect(readServedPort(env)).toBeNull();
  });

  it("returns null for a malformed discovery file", () => {
    tmpDir = makeTmpDir();
    const portFile = path.join(tmpDir, "duet-serve.json");
    fs.writeFileSync(portFile, "{ not valid json", "utf8");

    expect(readServedPort({ DUET_PORT_FILE: portFile })).toBeNull();
  });

  it("returns null when the record has no usable port", () => {
    tmpDir = makeTmpDir();
    const portFile = path.join(tmpDir, "duet-serve.json");
    fs.writeFileSync(portFile, JSON.stringify({ filePath: "/x", pid: 1 }), "utf8");

    expect(readServedPort({ DUET_PORT_FILE: portFile })).toBeNull();
  });
});
