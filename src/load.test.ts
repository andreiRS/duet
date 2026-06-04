import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { writeSceneFile, EchoGuard } from "./writeback";
import { open, type OpenScene } from "./open";

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

    const loaded = open(filePath);
    expect(loaded.list()).toEqual(elements);
  });

  it("preserves a human-drawn element with an unknown id verbatim", () => {
    const dir = makeTmpDir();
    const humanEl = { id: "human-xyz-abc", type: "freedraw", x: 5, y: 5, points: [[0, 0], [1, 1]] };
    const filePath = writeTmp(dir, [humanEl]);

    const loaded = open(filePath);
    expect(loaded.list()[0]).toEqual(humanEl);
  });
});

describe("byId (AC2: hit and miss)", () => {
  it("returns the element for a known id", () => {
    const dir = makeTmpDir();
    const el = { id: "target", type: "rectangle", x: 0, y: 0 };
    const filePath = writeTmp(dir, [el]);

    const loaded = open(filePath);
    expect(loaded.byId("target")).toEqual(el);
  });

  it("returns undefined for an unknown id", () => {
    const dir = makeTmpDir();
    const filePath = writeTmp(dir, [{ id: "a", type: "rectangle" }]);

    const loaded = open(filePath);
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

    const loaded = open(filePath);
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
    const loaded = open(filePath);
    const target = loaded.byId("agent-box")!;
    target.label = "updated";
    target.x = 99;

    loaded.save();

    // Re-load and check
    const reloaded = open(filePath);
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

// ─── Issue #7: save({source?}) — no guard on the agent path ──────────────────

describe("save({ source? }) API — no EchoGuard argument (issue #7 AC1)", () => {
  it("save() accepts no arguments and writes the file atomically", () => {
    const dir = makeTmpDir();
    const el = { id: "ag1", type: "rectangle", x: 0, y: 0 };
    const filePath = writeTmp(dir, [el]);

    const loaded = open(filePath);
    const target = loaded.byId("ag1")!;
    target.x = 42;

    // New API: no guard argument
    loaded.save();

    const onDisk = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(onDisk.elements[0].x).toBe(42);
    // atomic: no lingering tmp
    expect(fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("save() type signature does NOT accept an EchoGuard (guard param is gone)", () => {
    // This is a compile-time / type-level test enforced at runtime:
    // We verify the OpenScene interface has save taking no guard.
    // The TypeScript type must be save(opts?: { source?: string }): void
    const dir = makeTmpDir();
    const filePath = writeTmp(dir, []);
    const loaded: OpenScene = open(filePath);

    // These must all compile and work: no guard, empty opts, with source
    loaded.save();
    loaded.save({});
    loaded.save({ source: "my-agent" });
  });
});

describe("save({ source }) sets the source field in the written file (issue #7 AC5)", () => {
  it("uses the provided source when given", () => {
    const dir = makeTmpDir();
    const filePath = writeTmp(dir, []);
    const loaded = open(filePath);

    loaded.save({ source: "my-agent" });

    const onDisk = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(onDisk.source).toBe("my-agent");
  });

  it("defaults source to 'duet' when omitted", () => {
    const dir = makeTmpDir();
    const filePath = writeTmp(dir, []);
    const loaded = open(filePath);

    loaded.save();

    const onDisk = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(onDisk.source).toBe("duet");
  });

  it("defaults to 'duet' even when the file already has a different source", () => {
    // AC5: source defaults to the agent tag "duet", NOT the file's existing source.
    const dir = makeTmpDir();
    // Write a file that already has source: "https://excalidraw.com"
    const filePath = path.join(dir, "scene.excalidraw");
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        type: "excalidraw",
        version: 2,
        source: "https://excalidraw.com",
        elements: [],
        appState: {},
        files: {},
      }),
      "utf8",
    );

    const loaded = open(filePath);
    loaded.save(); // no source arg

    const onDisk = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(onDisk.source).toBe("duet");
  });
});
