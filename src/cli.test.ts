import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ensureScene, bootstrap } from "./cli";

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
