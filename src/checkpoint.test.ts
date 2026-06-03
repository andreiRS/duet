import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { openCheckpointStore } from "./checkpoint";
import type { CheckpointEntry } from "./checkpoint";

let tmpDir: string;
afterEach(() => {
  if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
});
function makeTmpDir(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "duet-checkpoint-test-"));
  return tmpDir;
}

function makeSourceFile(dir: string): string {
  const p = path.join(dir, "scene.excalidraw");
  const scene = JSON.stringify({
    type: "excalidraw",
    version: 2,
    source: "test",
    elements: [{ id: "el1", type: "rectangle" }],
    appState: {},
    files: {},
  });
  fs.writeFileSync(p, scene, "utf8");
  return p;
}

const SCENE_A = {
  type: "excalidraw" as const,
  version: 2 as const,
  source: "test",
  elements: [{ id: "el1", type: "rectangle", x: 10, y: 20 }],
  appState: {},
  files: {},
};

const SCENE_B = {
  type: "excalidraw" as const,
  version: 2 as const,
  source: "test",
  elements: [{ id: "el2", type: "ellipse", x: 50, y: 60 }],
  appState: {},
  files: {},
};

// Fake clock helper
function fakeNow(start = 1000): () => number {
  let t = start;
  return () => t++;
}

// --------------------------------------------------------------------------
// AC1: Save creates a checkpoint that survives a new process
// --------------------------------------------------------------------------
describe("AC1: save creates an on-disk checkpoint that survives a new process", () => {
  it("entry is present in a fresh store opened on the same path", () => {
    const dir = makeTmpDir();
    const src = makeSourceFile(dir);
    const now = fakeNow();

    const store1 = openCheckpointStore(src, { now });
    const entry = store1.save(SCENE_A);

    // entry should have id, timestamp, label null
    expect(typeof entry.id).toBe("string");
    expect(entry.label).toBeNull();
    expect(typeof entry.timestamp).toBe("number");

    // .duet/ dir must exist beside the source file
    const duetDir = path.join(dir, ".duet");
    expect(fs.existsSync(duetDir)).toBe(true);

    // fresh store sees the entry
    const store2 = openCheckpointStore(src, { now });
    const found = store2.get(entry.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(entry.id);

    // and readScene returns the same scene
    const loaded = store2.readScene(found!);
    expect(loaded.elements).toEqual(SCENE_A.elements);
  });
});

// --------------------------------------------------------------------------
// AC2: Auto vs labeled checkpoints
// --------------------------------------------------------------------------
describe("AC2: auto and labeled checkpoints", () => {
  it("auto checkpoint has label null", () => {
    const dir = makeTmpDir();
    const src = makeSourceFile(dir);
    const store = openCheckpointStore(src, { now: fakeNow() });
    const entry = store.save(SCENE_A);
    expect(entry.label).toBeNull();
  });

  it("labeled checkpoint carries its label", () => {
    const dir = makeTmpDir();
    const src = makeSourceFile(dir);
    const store = openCheckpointStore(src, { now: fakeNow() });
    const entry = store.save(SCENE_A, { label: "before-refactor" });
    expect(entry.label).toBe("before-refactor");
  });

  it("get() finds a labeled checkpoint by label", () => {
    const dir = makeTmpDir();
    const src = makeSourceFile(dir);
    const store = openCheckpointStore(src, { now: fakeNow() });
    store.save(SCENE_A, { label: "my-label" });
    const found = store.get("my-label");
    expect(found).toBeDefined();
    expect(found!.label).toBe("my-label");
  });

  it("get() finds a checkpoint by id", () => {
    const dir = makeTmpDir();
    const src = makeSourceFile(dir);
    const store = openCheckpointStore(src, { now: fakeNow() });
    const entry = store.save(SCENE_A);
    const found = store.get(entry.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(entry.id);
  });
});

// --------------------------------------------------------------------------
// AC3: Pruning — oldest auto evicted, labeled kept past cap
// --------------------------------------------------------------------------
describe("AC3: history cap and pruning", () => {
  it("prunes the oldest auto checkpoint when over the cap", () => {
    const dir = makeTmpDir();
    const src = makeSourceFile(dir);
    const now = fakeNow();
    const store = openCheckpointStore(src, { now });

    // Save 11 auto checkpoints — should keep ~10, oldest gets pruned
    const ids: string[] = [];
    for (let i = 0; i < 11; i++) {
      ids.push(store.save(SCENE_A).id);
    }

    const list = store.list();
    expect(list.length).toBe(10);

    // oldest (first saved) should be gone
    expect(store.get(ids[0])).toBeUndefined();
    // newest should still be there
    expect(store.get(ids[10])).toBeDefined();
  });

  it("keeps labeled checkpoints past the cap — only auto ones get pruned", () => {
    const dir = makeTmpDir();
    const src = makeSourceFile(dir);
    const now = fakeNow();
    const store = openCheckpointStore(src, { now });

    // Save a labeled checkpoint first
    const labeled = store.save(SCENE_A, { label: "keep-me" });

    // Then save 11 more auto checkpoints to push over the cap
    const autoIds: string[] = [];
    for (let i = 0; i < 11; i++) {
      autoIds.push(store.save(SCENE_A).id);
    }

    // labeled must still be there even though we're past the cap
    expect(store.get(labeled.id)).toBeDefined();
    expect(store.get("keep-me")).toBeDefined();

    // 1 labeled + 11 autos saved; cap=10 for auto means 1 oldest auto evicted
    // Total surviving = 1 labeled + 10 autos = 11
    const list = store.list();
    expect(list.length).toBe(11);
    expect(list.filter((e) => e.label === null).length).toBe(10);

    const labeledInList = list.filter((e) => e.label !== null);
    expect(labeledInList.length).toBe(1);
    expect(labeledInList[0].id).toBe(labeled.id);
  });

  it("labeled checkpoints can be deleted explicitly via delete()", () => {
    const dir = makeTmpDir();
    const src = makeSourceFile(dir);
    const store = openCheckpointStore(src, { now: fakeNow() });

    const labeled = store.save(SCENE_A, { label: "my-label" });
    expect(store.get("my-label")).toBeDefined();

    store.delete(labeled.id);
    expect(store.get("my-label")).toBeUndefined();
    expect(store.get(labeled.id)).toBeUndefined();
  });

  it("delete() also accepts a label string", () => {
    const dir = makeTmpDir();
    const src = makeSourceFile(dir);
    const store = openCheckpointStore(src, { now: fakeNow() });

    store.save(SCENE_A, { label: "to-delete" });
    store.delete("to-delete");
    expect(store.get("to-delete")).toBeUndefined();
  });
});

// --------------------------------------------------------------------------
// AC4: Listing defaults to latest
// --------------------------------------------------------------------------
describe("AC4: listing and default-latest selection", () => {
  it("list() returns checkpoints newest-first", () => {
    const dir = makeTmpDir();
    const src = makeSourceFile(dir);
    const now = fakeNow(1000);
    const store = openCheckpointStore(src, { now });

    const e1 = store.save(SCENE_A);
    const e2 = store.save(SCENE_B);

    const list = store.list();
    expect(list.length).toBe(2);
    // newest first
    expect(list[0].id).toBe(e2.id);
    expect(list[1].id).toBe(e1.id);
  });

  it("latest() returns the most-recently saved entry", () => {
    const dir = makeTmpDir();
    const src = makeSourceFile(dir);
    const now = fakeNow();
    const store = openCheckpointStore(src, { now });

    store.save(SCENE_A);
    const last = store.save(SCENE_B);

    expect(store.latest()!.id).toBe(last.id);
  });

  it("latest() returns undefined when no checkpoints exist", () => {
    const dir = makeTmpDir();
    const src = makeSourceFile(dir);
    const store = openCheckpointStore(src, { now: fakeNow() });
    expect(store.latest()).toBeUndefined();
  });
});

// --------------------------------------------------------------------------
// AC2b: duplicate-label resolution (latest-wins)
// --------------------------------------------------------------------------
describe("AC2b: duplicate-label — get/delete resolve to latest", () => {
  it("get(label) returns the entry with the highest seq when two share the same label", () => {
    const dir = makeTmpDir();
    const src = makeSourceFile(dir);
    const store = openCheckpointStore(src, { now: fakeNow() });

    const first = store.save(SCENE_A, { label: "before-refactor" });
    const second = store.save(SCENE_B, { label: "before-refactor" });

    const found = store.get("before-refactor");
    expect(found).toBeDefined();
    expect(found!.id).toBe(second.id);
    expect(found!.seq).toBeGreaterThan(first.seq);
  });

  it("delete(label) removes the latest labeled entry and leaves the older one", () => {
    const dir = makeTmpDir();
    const src = makeSourceFile(dir);
    const store = openCheckpointStore(src, { now: fakeNow() });

    const first = store.save(SCENE_A, { label: "before-refactor" });
    store.save(SCENE_B, { label: "before-refactor" });

    store.delete("before-refactor");

    // The older one must still exist by id
    expect(store.get(first.id)).toBeDefined();
    // But a label lookup now returns the only remaining one (the first/older)
    const remaining = store.get("before-refactor");
    expect(remaining).toBeDefined();
    expect(remaining!.id).toBe(first.id);
  });
});

// --------------------------------------------------------------------------
// AC2c: failure-path — get/delete on nonexistent
// --------------------------------------------------------------------------
describe("AC2c: failure paths — nonexistent id/label", () => {
  it("get('nonexistent-id') returns undefined", () => {
    const dir = makeTmpDir();
    const src = makeSourceFile(dir);
    const store = openCheckpointStore(src, { now: fakeNow() });
    store.save(SCENE_A);
    expect(store.get("nonexistent-id")).toBeUndefined();
  });

  it("delete('nonexistent-id') does not throw and leaves the list unchanged", () => {
    const dir = makeTmpDir();
    const src = makeSourceFile(dir);
    const store = openCheckpointStore(src, { now: fakeNow() });
    store.save(SCENE_A);
    const before = store.list().map((e) => e.id);
    expect(() => store.delete("nonexistent-id")).not.toThrow();
    expect(store.list().map((e) => e.id)).toEqual(before);
  });
});

// --------------------------------------------------------------------------
// AC5: .duet/ is gitignored
// --------------------------------------------------------------------------
describe("AC5: .duet/ is gitignored in the repo root .gitignore", () => {
  it("root .gitignore contains .duet/", () => {
    // Walk up from src/ to find the root .gitignore
    const repoRoot = path.resolve(__dirname, "..");
    const gitignore = path.join(repoRoot, ".gitignore");
    expect(fs.existsSync(gitignore)).toBe(true);
    const content = fs.readFileSync(gitignore, "utf8");
    expect(content).toContain(".duet/");
  });
});

// --------------------------------------------------------------------------
// AC6: Sequence is monotonic + deterministic with injected clock
// --------------------------------------------------------------------------
describe("AC6: sequence is monotonic and determinism with injected clock", () => {
  it("two saves in the same ms get different sequence numbers (monotonic counter)", () => {
    const dir = makeTmpDir();
    const src = makeSourceFile(dir);
    // Freeze the clock at one value — same timestamp for both saves
    const frozenNow = () => 9999;
    const store = openCheckpointStore(src, { now: frozenNow });

    const e1 = store.save(SCENE_A);
    const e2 = store.save(SCENE_B);

    // Both have the same timestamp but different ids/sequences
    expect(e1.timestamp).toBe(e2.timestamp);
    expect(e1.id).not.toBe(e2.id);

    // list ordering must still be newest-first (by sequence)
    const list = store.list();
    expect(list[0].id).toBe(e2.id);
  });

  it("fresh store reconstructs sequence from disk, never resets counter", () => {
    const dir = makeTmpDir();
    const src = makeSourceFile(dir);
    const now = fakeNow(500);

    const store1 = openCheckpointStore(src, { now });
    const e1 = store1.save(SCENE_A);

    // New store process: seq must continue from where store1 left off
    const store2 = openCheckpointStore(src, { now });
    const e2 = store2.save(SCENE_B);

    const list = store2.list();
    // e2 is newer so should be first
    expect(list[0].id).toBe(e2.id);
    expect(list[1].id).toBe(e1.id);
  });
});
