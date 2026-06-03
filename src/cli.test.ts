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

afterEach(() => {
  for (const s of servers) {
    try { s.stop(); } catch { /* ignore */ }
  }
  servers = [];
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

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
});
