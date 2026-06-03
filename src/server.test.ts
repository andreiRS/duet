import { describe, it, expect, afterEach } from "bun:test";
import { createServer } from "./server";
import { EchoGuard } from "./writeback";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

// Helper: create a temp fixture dir with a minimal index.html and an asset
function makeFakeDistDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "duet-test-dist-"));
  fs.writeFileSync(path.join(dir, "index.html"), "<html><body>duet</body></html>");
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(dir, "assets", "app.js"), "console.log('app')");
  return dir;
}

// Helper: wait for a websocket to open
function wsOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) { resolve(); return; }
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", (e) => reject(e), { once: true });
  });
}

// Helper: wait for next message on a websocket
function nextMessage(ws: WebSocket, timeoutMs = 2000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout waiting for ws message")), timeoutMs);
    ws.addEventListener("message", (e) => {
      clearTimeout(timer);
      resolve(JSON.parse(e.data));
    }, { once: true });
  });
}

let distDir: string;
let cleanup: (() => void)[] = [];

function setup() {
  distDir = makeFakeDistDir();
  return distDir;
}

function addCleanup(fn: () => void) {
  cleanup.push(fn);
}

afterEach(async () => {
  for (const fn of cleanup) {
    try { fn(); } catch {}
  }
  cleanup = [];
  if (distDir) {
    fs.rmSync(distDir, { recursive: true, force: true });
  }
});

// ─── Behavior 1: module API ───────────────────────────────────────────────────

describe("createServer", () => {
  it("returns server, setScene, and getScene", () => {
    const dir = setup();
    const { server, setScene, getScene } = createServer({ port: 0, distDir: dir });
    addCleanup(() => server.stop(true));

    expect(typeof setScene).toBe("function");
    expect(typeof getScene).toBe("function");
    expect(server).toBeDefined();
  });
});

// ─── Behavior 3: WS connect + replay on connect (null scene) ─────────────────

describe("WebSocket replay-on-connect", () => {
  it("client receives current scene immediately on connect (null scene)", async () => {
    const dir = setup();
    const { server } = createServer({ port: 0, distDir: dir });
    addCleanup(() => server.stop(true));

    const ws = new WebSocket(`ws://localhost:${server.port}/`);
    addCleanup(() => ws.close());

    await wsOpen(ws);
    const msg = await nextMessage(ws);

    expect(msg).toEqual({ type: "scene", scene: null });
  });

  it("client receives scene set before connect (non-null replay)", async () => {
    const dir = setup();
    const { server, setScene } = createServer({ port: 0, distDir: dir });
    addCleanup(() => server.stop(true));

    const scene = { elements: [{ id: "a", type: "rectangle" }], appState: {} };
    setScene(scene);

    const ws = new WebSocket(`ws://localhost:${server.port}/`);
    addCleanup(() => ws.close());

    await wsOpen(ws);
    const msg = await nextMessage(ws);

    expect(msg).toEqual({ type: "scene", scene });
  });
});

// ─── Behavior 4: broadcast to all connected clients on setScene ──────────────

describe("WebSocket broadcast", () => {
  it("two clients both receive the broadcast when setScene is called", async () => {
    const dir = setup();
    const { server, setScene } = createServer({ port: 0, distDir: dir });
    addCleanup(() => server.stop(true));

    const wsUrl = `ws://localhost:${server.port}/`;

    const ws1 = new WebSocket(wsUrl);
    const ws2 = new WebSocket(wsUrl);
    addCleanup(() => ws1.close());
    addCleanup(() => ws2.close());

    // Wait for both to open and consume their replay messages in parallel
    await Promise.all([
      wsOpen(ws1).then(() => nextMessage(ws1)),
      wsOpen(ws2).then(() => nextMessage(ws2)),
    ]);

    // Now set a new scene — both should get the broadcast
    const scene = { elements: [{ id: "x" }], appState: { zoom: 1 } };

    const p1 = nextMessage(ws1);
    const p2 = nextMessage(ws2);
    setScene(scene);

    const [msg1, msg2] = await Promise.all([p1, p2]);

    expect(msg1).toEqual({ type: "scene", scene });
    expect(msg2).toEqual({ type: "scene", scene });
  });
});

// ─── Behavior 2: HTTP serves index.html at GET / ─────────────────────────────

describe("HTTP static serving", () => {
  it("GET / returns index.html content", async () => {
    const dir = setup();
    const { server } = createServer({ port: 0, distDir: dir });
    addCleanup(() => server.stop(true));

    const url = `http://localhost:${server.port}/`;
    const res = await fetch(url);
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text).toContain("duet");
  });

  it("GET /assets/app.js returns the static asset", async () => {
    const dir = setup();
    const { server } = createServer({ port: 0, distDir: dir });
    addCleanup(() => server.stop(true));

    const url = `http://localhost:${server.port}/assets/app.js`;
    const res = await fetch(url);
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text).toContain("console.log");
  });
});

// ─── Slice 6: browser → file write-back via {type:"save"} WS message ─────────

let sceneDir: string;
function makeSceneFile(): string {
  sceneDir = fs.mkdtempSync(path.join(os.tmpdir(), "duet-save-test-"));
  const filePath = path.join(sceneDir, "scene.excalidraw");
  fs.writeFileSync(filePath, JSON.stringify({ type: "excalidraw", elements: [], appState: {} }), "utf8");
  addCleanup(() => fs.rmSync(sceneDir, { recursive: true, force: true }));
  return filePath;
}

describe("browser → file write-back (save message)", () => {
  it("a {type:'save'} message writes the elements to the scene file", async () => {
    const dir = setup();
    const filePath = makeSceneFile();
    const { server } = createServer({ port: 0, distDir: dir, filePath, echoGuard: new EchoGuard() });
    addCleanup(() => server.stop(true));

    const ws = new WebSocket(`ws://localhost:${server.port}/`);
    addCleanup(() => ws.close());
    await wsOpen(ws);
    await nextMessage(ws); // consume replay

    const elements = [{ id: "drawn", type: "rectangle" }];
    ws.send(JSON.stringify({ type: "save", elements, appState: { viewBackgroundColor: "#eee", scrollX: 5 } }));

    // Poll the file until the write lands (no fixed-sleep race on a positive assertion).
    let onDisk: any;
    for (let i = 0; i < 100; i++) {
      const raw = fs.readFileSync(filePath, "utf8");
      onDisk = JSON.parse(raw);
      if (onDisk.elements.length > 0) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(onDisk.elements).toEqual(elements);
    // whitelist held: viewBackgroundColor kept, scrollX dropped
    expect(onDisk.appState).toEqual({ viewBackgroundColor: "#eee" });
    expect(onDisk.files).toEqual({});
    // atomic: no lingering tmp
    expect(fs.readdirSync(sceneDir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("a browser save fans out to other connected clients but not the sender (B1)", async () => {
    const dir = setup();
    const filePath = makeSceneFile();
    const { server } = createServer({ port: 0, distDir: dir, filePath, echoGuard: new EchoGuard() });
    addCleanup(() => server.stop(true));

    const wsUrl = `ws://localhost:${server.port}/`;
    const sender = new WebSocket(wsUrl); // tab A — makes the edit
    const other = new WebSocket(wsUrl);  // tab B — should receive it live
    addCleanup(() => sender.close());
    addCleanup(() => other.close());

    // Open both and consume their replay-on-connect messages.
    await Promise.all([
      wsOpen(sender).then(() => nextMessage(sender)),
      wsOpen(other).then(() => nextMessage(other)),
    ]);

    const elements = [{ id: "drawn", type: "rectangle" }];

    // tab B must get the fan-out; tab A must NOT bounce (publish excludes sender).
    const otherMsg = nextMessage(other);
    const senderBounce = nextMessage(sender, 300).then(() => "bounced").catch(() => "silent");

    sender.send(JSON.stringify({ type: "save", elements, appState: {} }));

    const msg = (await otherMsg) as { type: string; scene: { elements: unknown[] } };
    expect(msg.type).toBe("scene");
    expect(msg.scene.elements).toEqual(elements);

    expect(await senderBounce).toBe("silent");
  });
});
