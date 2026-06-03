import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { watchScene, type WatchHandle } from "./watch";

let tmpDir: string;
let watchers: WatchHandle[] = [];

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "duet-watch-test-"));
}

// Resolve when onScene fires (or reject on timeout). Lets us await the
// chokidar awaitWriteFinish-debounced event instead of racing a fixed sleep.
function waitForScene(timeoutMs = 3000): {
  promise: Promise<unknown>;
  onScene: (scene: unknown) => void;
} {
  let resolve!: (scene: unknown) => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const timer = setTimeout(() => reject(new Error("timeout waiting for scene")), timeoutMs);
  return {
    promise,
    onScene: (scene) => {
      clearTimeout(timer);
      resolve(scene);
    },
  };
}

afterEach(async () => {
  for (const w of watchers) {
    try { await w.close(); } catch { /* ignore */ }
  }
  watchers = [];
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe("watchScene", () => {
  it("calls onScene with the parsed scene when the file changes with valid JSON", async () => {
    tmpDir = makeTmpDir();
    const filePath = path.join(tmpDir, "scene.excalidraw");
    fs.writeFileSync(filePath, JSON.stringify({ elements: [], appState: {} }), "utf8");

    const waiter = waitForScene();
    const handle = watchScene(filePath, { onScene: waiter.onScene });
    watchers.push(handle);
    await handle.ready;

    const newScene = { elements: [{ id: "a", type: "rectangle" }], appState: { zoom: 1 } };
    fs.writeFileSync(filePath, JSON.stringify(newScene), "utf8");

    const received = await waiter.promise;
    expect(received).toEqual(newScene);
  });

  it("does not call onScene on a malformed write and reports the error instead", async () => {
    tmpDir = makeTmpDir();
    const filePath = path.join(tmpDir, "scene.excalidraw");
    fs.writeFileSync(filePath, JSON.stringify({ elements: [], appState: {} }), "utf8");

    let sceneCalls = 0;
    let errorCalled = false;
    let resolveError!: () => void;
    const errored = new Promise<void>((res) => { resolveError = res; });

    const handle = watchScene(filePath, {
      onScene: () => { sceneCalls++; },
      onError: () => { errorCalled = true; resolveError(); },
    });
    watchers.push(handle);
    await handle.ready;

    fs.writeFileSync(filePath, "{ this is not json", "utf8");

    await errored;
    expect(errorCalled).toBe(true);
    expect(sceneCalls).toBe(0);
  });

  it("recovers on the next valid write after a malformed one", async () => {
    tmpDir = makeTmpDir();
    const filePath = path.join(tmpDir, "scene.excalidraw");
    fs.writeFileSync(filePath, JSON.stringify({ elements: [], appState: {} }), "utf8");

    const scenes: unknown[] = [];
    let resolveScene: (() => void) | null = null;

    const handle = watchScene(filePath, {
      onScene: (s) => { scenes.push(s); resolveScene?.(); },
    });
    watchers.push(handle);
    await handle.ready;

    // malformed write: no onScene
    fs.writeFileSync(filePath, "broken{", "utf8");
    await new Promise((r) => setTimeout(r, 400));
    expect(scenes.length).toBe(0);

    // valid write recovers
    const recovered = new Promise<void>((res) => { resolveScene = res; });
    const good = { elements: [{ id: "z" }], appState: {} };
    fs.writeFileSync(filePath, JSON.stringify(good), "utf8");
    await recovered;

    expect(scenes).toEqual([good]);
  });
});
