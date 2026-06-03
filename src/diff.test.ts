import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { diffScenes, diffAgainstCheckpoint } from "./diff";
import { openCheckpointStore } from "./checkpoint";
import type { El, ExcalidrawScene } from "./scene-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function el(id: string, overrides: Record<string, unknown> = {}): El {
  return {
    id,
    type: "rectangle",
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    ...overrides,
  };
}

function scene(elements: El[]): ExcalidrawScene {
  return {
    type: "excalidraw",
    version: 2,
    source: "test",
    elements,
    appState: {},
    files: {},
  };
}

// ---------------------------------------------------------------------------
// Pure core: diffScenes
// ---------------------------------------------------------------------------

describe("diffScenes — Added", () => {
  it("AC1: id present in current but not checkpoint → Added", () => {
    const checkpoint: El[] = [];
    const current: El[] = [el("new1")];
    const report = diffScenes(checkpoint, current);
    expect(report.added).toContain("new1");
    expect(report.removed).toHaveLength(0);
    expect(report.moved).toHaveLength(0);
    expect(report.changed).toHaveLength(0);
  });
});

describe("diffScenes — Removed", () => {
  it("AC2: id in checkpoint but gone from current → Removed", () => {
    const checkpoint: El[] = [el("gone1")];
    const current: El[] = [];
    const report = diffScenes(checkpoint, current);
    expect(report.removed).toContain("gone1");
    expect(report.added).toHaveLength(0);
    expect(report.moved).toHaveLength(0);
    expect(report.changed).toHaveLength(0);
  });
});

describe("diffScenes — Moved", () => {
  it("AC3a: x changed → Moved", () => {
    const checkpoint: El[] = [el("box1", { x: 10, y: 20 })];
    const current: El[] = [el("box1", { x: 99, y: 20 })];
    const report = diffScenes(checkpoint, current);
    expect(report.moved).toContain("box1");
    expect(report.added).toHaveLength(0);
    expect(report.removed).toHaveLength(0);
    expect(report.changed).toHaveLength(0);
  });

  it("AC3b: y changed → Moved", () => {
    const checkpoint: El[] = [el("box1", { x: 10, y: 20 })];
    const current: El[] = [el("box1", { x: 10, y: 99 })];
    const report = diffScenes(checkpoint, current);
    expect(report.moved).toContain("box1");
  });

  it("AC3c: both x and y changed → Moved (not doubled)", () => {
    const checkpoint: El[] = [el("box1", { x: 10, y: 20 })];
    const current: El[] = [el("box1", { x: 99, y: 77 })];
    const report = diffScenes(checkpoint, current);
    expect(report.moved).toContain("box1");
    expect(report.moved.filter((id) => id === "box1")).toHaveLength(1);
  });
});

describe("diffScenes — metadata-only no-op", () => {
  it("AC4: version/seed/updated/versionNonce changed, meaningful fields same → no diff entry", () => {
    const checkpoint: El[] = [
      el("el1", { version: 1, versionNonce: 100, seed: 999, updated: 1000 }),
    ];
    const current: El[] = [
      el("el1", { version: 5, versionNonce: 200, seed: 888, updated: 9999 }),
    ];
    const report = diffScenes(checkpoint, current);
    expect(report.added).toHaveLength(0);
    expect(report.removed).toHaveLength(0);
    expect(report.moved).toHaveLength(0);
    expect(report.changed).toHaveLength(0);
  });
});

describe("diffScenes — unknown (human-drawn) ids", () => {
  it("AC5a: human-drawn element added by id → Added", () => {
    // human elements have random-looking ids — treated the same
    const humanId = "7f3a2b1c-random";
    const checkpoint: El[] = [];
    const current: El[] = [el(humanId)];
    const report = diffScenes(checkpoint, current);
    expect(report.added).toContain(humanId);
  });

  it("AC5b: human-drawn element moved by id → Moved", () => {
    const humanId = "7f3a2b1c-random";
    const checkpoint: El[] = [el(humanId, { x: 10, y: 10 })];
    const current: El[] = [el(humanId, { x: 50, y: 10 })];
    const report = diffScenes(checkpoint, current);
    expect(report.moved).toContain(humanId);
  });
});

describe("diffScenes — Changed (non-positional meaningful field)", () => {
  it("AC6a: text changed, position same → Changed", () => {
    const checkpoint: El[] = [el("t1", { text: "hello" })];
    const current: El[] = [el("t1", { text: "world" })];
    const report = diffScenes(checkpoint, current);
    expect(report.changed).toContain("t1");
    expect(report.moved).toHaveLength(0);
  });

  it("AC6b: width changed, position same → Changed", () => {
    const checkpoint: El[] = [el("box1", { width: 100 })];
    const current: El[] = [el("box1", { width: 200 })];
    const report = diffScenes(checkpoint, current);
    expect(report.changed).toContain("box1");
    expect(report.moved).toHaveLength(0);
  });

  it("AC6c: height changed, position same → Changed", () => {
    const checkpoint: El[] = [el("box1", { height: 50 })];
    const current: El[] = [el("box1", { height: 150 })];
    const report = diffScenes(checkpoint, current);
    expect(report.changed).toContain("box1");
    expect(report.moved).toHaveLength(0);
  });

  it("AC6d: points changed (order-sensitive) → Changed", () => {
    const checkpoint: El[] = [el("line1", { points: [[0, 0], [10, 10]] })];
    const current: El[] = [el("line1", { points: [[0, 0], [20, 20]] })];
    const report = diffScenes(checkpoint, current);
    expect(report.changed).toContain("line1");
  });

  it("AC6e: points same (same order) → no entry", () => {
    const pts = [[0, 0], [10, 10]];
    const checkpoint: El[] = [el("line1", { points: pts })];
    const current: El[] = [el("line1", { points: [[0, 0], [10, 10]] })];
    const report = diffScenes(checkpoint, current);
    expect(report.added).toHaveLength(0);
    expect(report.removed).toHaveLength(0);
    expect(report.moved).toHaveLength(0);
    expect(report.changed).toHaveLength(0);
  });

  it("AC6f: startBinding changed → Changed", () => {
    const checkpoint: El[] = [el("arr1", { startBinding: null })];
    const current: El[] = [el("arr1", { startBinding: { elementId: "box1", fixedPoint: [0, 0.5] } })];
    const report = diffScenes(checkpoint, current);
    expect(report.changed).toContain("arr1");
  });

  it("AC6g: both position and text changed → Moved (position wins, not in Changed)", () => {
    const checkpoint: El[] = [el("t1", { x: 10, text: "hello" })];
    const current: El[] = [el("t1", { x: 99, text: "world" })];
    const report = diffScenes(checkpoint, current);
    // position change → Moved; text also changed but we classify under most-specific
    expect(report.moved).toContain("t1");
    // NOT also in changed (one bucket per id)
    expect(report.changed).not.toContain("t1");
  });
});

describe("diffScenes — boundElements set comparison (order-insensitive)", () => {
  it("same boundElements in different order → no diff entry", () => {
    const be1 = [
      { type: "arrow", id: "a1" },
      { type: "arrow", id: "a2" },
    ];
    const be2 = [
      { type: "arrow", id: "a2" },
      { type: "arrow", id: "a1" },
    ];
    const checkpoint: El[] = [el("box1", { boundElements: be1 })];
    const current: El[] = [el("box1", { boundElements: be2 })];
    const report = diffScenes(checkpoint, current);
    expect(report.added).toHaveLength(0);
    expect(report.removed).toHaveLength(0);
    expect(report.moved).toHaveLength(0);
    expect(report.changed).toHaveLength(0);
  });

  it("boundElements item added → Changed", () => {
    const checkpoint: El[] = [el("box1", { boundElements: [{ type: "arrow", id: "a1" }] })];
    const current: El[] = [
      el("box1", {
        boundElements: [
          { type: "arrow", id: "a1" },
          { type: "arrow", id: "a2" },
        ],
      }),
    ];
    const report = diffScenes(checkpoint, current);
    expect(report.changed).toContain("box1");
  });
});

// ---------------------------------------------------------------------------
// Multiple elements at once
// ---------------------------------------------------------------------------

describe("diffScenes — multiple elements", () => {
  it("handles mixed add/remove/move/no-op together", () => {
    const checkpoint: El[] = [
      el("keep", { x: 0, y: 0 }),
      el("move", { x: 0, y: 0 }),
      el("gone"),
    ];
    const current: El[] = [
      el("keep", { x: 0, y: 0 }),
      el("move", { x: 50, y: 0 }),
      el("fresh"),
    ];
    const report = diffScenes(checkpoint, current);
    expect(report.added).toContain("fresh");
    expect(report.added).toHaveLength(1);
    expect(report.removed).toContain("gone");
    expect(report.removed).toHaveLength(1);
    expect(report.moved).toContain("move");
    expect(report.moved).toHaveLength(1);
    expect(report.changed).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// isDeleted: Excalidraw soft-delete
// ---------------------------------------------------------------------------

describe("diffScenes — isDeleted (Excalidraw soft-delete)", () => {
  it("AC-DEL1: active in checkpoint, isDeleted:true in current → Removed", () => {
    const checkpoint: El[] = [el("gone")];
    const current: El[] = [el("gone", { isDeleted: true })];
    const report = diffScenes(checkpoint, current);
    expect(report.removed).toContain("gone");
    expect(report.added).toHaveLength(0);
    expect(report.moved).toHaveLength(0);
    expect(report.changed).toHaveLength(0);
  });

  it("AC-DEL2: isDeleted:true in checkpoint, active in current → Added", () => {
    const checkpoint: El[] = [el("revived", { isDeleted: true })];
    const current: El[] = [el("revived")];
    const report = diffScenes(checkpoint, current);
    expect(report.added).toContain("revived");
    expect(report.removed).toHaveLength(0);
    expect(report.moved).toHaveLength(0);
    expect(report.changed).toHaveLength(0);
  });

  it("AC-DEL3: isDeleted:true in both checkpoint and current → no bucket", () => {
    const checkpoint: El[] = [el("phantom", { isDeleted: true })];
    const current: El[] = [el("phantom", { isDeleted: true })];
    const report = diffScenes(checkpoint, current);
    expect(report.added).toHaveLength(0);
    expect(report.removed).toHaveLength(0);
    expect(report.moved).toHaveLength(0);
    expect(report.changed).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Convenience wrapper: diffAgainstCheckpoint
// ---------------------------------------------------------------------------

let tmpDir: string;
afterEach(() => {
  if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeTmpSourceFile(dir: string, elements: El[]): string {
  const p = path.join(dir, "scene.excalidraw");
  fs.writeFileSync(p, JSON.stringify(scene(elements)), "utf8");
  return p;
}

describe("diffAgainstCheckpoint", () => {
  it("diffs current file against latest checkpoint by default", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "duet-diff-test-"));
    const sourceFile = makeTmpSourceFile(tmpDir, [el("el1", { x: 10, y: 20 })]);

    const store = openCheckpointStore(sourceFile);
    // Save checkpoint with el1 at x=10
    store.save(scene([el("el1", { x: 10, y: 20 })]));

    // Now update the source file: el1 moved
    fs.writeFileSync(sourceFile, JSON.stringify(scene([el("el1", { x: 99, y: 20 })])), "utf8");

    const report = await diffAgainstCheckpoint(sourceFile, { store });
    expect(report.moved).toContain("el1");
    expect(report.added).toHaveLength(0);
    expect(report.removed).toHaveLength(0);
    expect(report.changed).toHaveLength(0);
  });

  it("no checkpoint → all current elements reported as Added", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "duet-diff-test-nocp-"));
    const sourceFile = makeTmpSourceFile(tmpDir, [el("el1"), el("el2")]);

    const store = openCheckpointStore(sourceFile);
    // No checkpoints saved
    const report = await diffAgainstCheckpoint(sourceFile, { store });
    expect(report.added).toContain("el1");
    expect(report.added).toContain("el2");
    expect(report.removed).toHaveLength(0);
    expect(report.moved).toHaveLength(0);
    expect(report.changed).toHaveLength(0);
  });

  it("can diff against a specific entry (not latest)", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "duet-diff-test-entry-"));
    const sourceFile = makeTmpSourceFile(tmpDir, [el("el1", { x: 0, y: 0 })]);

    const store = openCheckpointStore(sourceFile);
    const entry1 = store.save(scene([el("el1", { x: 0, y: 0 })]));
    // Second checkpoint: el1 already moved
    store.save(scene([el("el1", { x: 50, y: 0 })]));

    // Current file has el1 at x=0 (same as entry1)
    fs.writeFileSync(sourceFile, JSON.stringify(scene([el("el1", { x: 0, y: 0 })])), "utf8");

    // Diff against entry1 → no diff
    const report = await diffAgainstCheckpoint(sourceFile, { store, entry: entry1 });
    expect(report.moved).toHaveLength(0);
    expect(report.added).toHaveLength(0);
  });

  it("is empty report easy to detect (all arrays empty)", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "duet-diff-test-empty-"));
    const sourceFile = makeTmpSourceFile(tmpDir, [el("el1")]);
    const store = openCheckpointStore(sourceFile);
    store.save(scene([el("el1")]));
    // No changes
    const report = await diffAgainstCheckpoint(sourceFile, { store });
    const isEmpty =
      report.added.length === 0 &&
      report.removed.length === 0 &&
      report.moved.length === 0 &&
      report.changed.length === 0;
    expect(isEmpty).toBe(true);
  });
});
