import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { writeSceneFile, EchoGuard } from "./writeback";
import { load } from "./load";

let tmpDir: string;
afterEach(() => {
  if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
});
function makeTmpDir(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "duet-load-test-"));
  return tmpDir;
}

// Helpers to write a scene file and return its path.
function writeTmp(dir: string, elements: unknown[], appState = {}): string {
  const filePath = path.join(dir, "scene.excalidraw");
  writeSceneFile(filePath, { elements, appState }, new EchoGuard());
  return filePath;
}

describe("load round-trip (AC1: no elements dropped or mutated)", () => {
  it("list() returns the same elements that were written", () => {
    const dir = makeTmpDir();
    const elements = [
      { id: "box1", type: "rectangle", x: 0, y: 0, width: 100, height: 50 },
      { id: "box2", type: "ellipse", x: 200, y: 0, width: 80, height: 80 },
    ];
    const filePath = writeTmp(dir, elements);

    const loaded = load(filePath);
    expect(loaded.list()).toEqual(elements);
  });

  it("preserves a human-drawn element with an unknown id verbatim", () => {
    const dir = makeTmpDir();
    const humanEl = { id: "human-xyz-abc", type: "freedraw", x: 5, y: 5, points: [[0, 0], [1, 1]] };
    const filePath = writeTmp(dir, [humanEl]);

    const loaded = load(filePath);
    expect(loaded.list()[0]).toEqual(humanEl);
  });
});

describe("byId (AC2: hit and miss)", () => {
  it("returns the element for a known id", () => {
    const dir = makeTmpDir();
    const el = { id: "target", type: "rectangle", x: 0, y: 0 };
    const filePath = writeTmp(dir, [el]);

    const loaded = load(filePath);
    expect(loaded.byId("target")).toEqual(el);
  });

  it("returns undefined for an unknown id", () => {
    const dir = makeTmpDir();
    const filePath = writeTmp(dir, [{ id: "a", type: "rectangle" }]);

    const loaded = load(filePath);
    expect(loaded.byId("does-not-exist")).toBeUndefined();
  });
});

describe("list (AC3: all elements)", () => {
  it("returns all elements in order", () => {
    const dir = makeTmpDir();
    const elements = [
      { id: "e1", type: "rectangle" },
      { id: "e2", type: "ellipse" },
      { id: "e3", type: "arrow" },
    ];
    const filePath = writeTmp(dir, elements);

    const loaded = load(filePath);
    expect(loaded.list()).toHaveLength(3);
    expect(loaded.list().map((e) => e.id)).toEqual(["e1", "e2", "e3"]);
  });
});

describe("byte-stable save (AC4: changing one element leaves others untouched)", () => {
  it("only the mutated element differs after save; all others are byte-stable", () => {
    const dir = makeTmpDir();
    const agentEl = { id: "agent-box", type: "rectangle", x: 0, y: 0, width: 100, height: 50, label: "original" };
    const humanEl = { id: "human-abc", type: "freedraw", x: 300, y: 300, points: [[0, 0], [10, 10]] };
    const anotherEl = { id: "another-box", type: "ellipse", x: 500, y: 0, width: 60, height: 60 };
    const filePath = writeTmp(dir, [agentEl, humanEl, anotherEl]);

    // Load, mutate one element, save back
    const loaded = load(filePath);
    const target = loaded.byId("agent-box")!;
    target.label = "updated";
    target.x = 99;

    const guard = new EchoGuard();
    loaded.save(guard);

    // Re-load and check
    const reloaded = load(filePath);
    const reloadedElements = reloaded.list();

    // The mutated element is changed
    const reloadedTarget = reloaded.byId("agent-box")!;
    expect(reloadedTarget.label).toBe("updated");
    expect(reloadedTarget.x).toBe(99);

    // All other elements are byte-stable (deep-equal, same order)
    const humanAfter = reloadedElements.find((e) => e.id === "human-abc")!;
    expect(humanAfter).toEqual(humanEl);

    const anotherAfter = reloadedElements.find((e) => e.id === "another-box")!;
    expect(anotherAfter).toEqual(anotherEl);

    // Order is preserved
    expect(reloadedElements.map((e) => e.id)).toEqual(["agent-box", "human-abc", "another-box"]);
  });
});
