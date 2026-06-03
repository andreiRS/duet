import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { restoreCheckpoint } from "./restore";
import { openCheckpointStore } from "./checkpoint";
import { EchoGuard } from "./writeback";
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
    isDeleted: false,
    ...overrides,
  };
}

function scene(elements: El[]): ExcalidrawScene {
  return {
    type: "excalidraw",
    version: 2,
    source: "test",
    elements,
    appState: { viewBackgroundColor: "#ffffff" },
    files: {},
  };
}

function writeTempScene(filePath: string, elements: El[]): void {
  fs.writeFileSync(filePath, JSON.stringify(scene(elements), null, 2), "utf8");
}

function readCurrentElements(filePath: string): El[] {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as ExcalidrawScene;
  return parsed.elements;
}

let tmpDir: string;
let sourceFile: string;

function setup(): void {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "duet-restore-test-"));
  sourceFile = path.join(tmpDir, "scene.excalidraw");
}

afterEach(() => {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// AC1: Restoring returns the file to the checkpoint's exact state
// ---------------------------------------------------------------------------

describe("restoreCheckpoint — AC1: exact state restore", () => {
  it("saves a checkpoint, mutates the file, restores, re-read elements match checkpoint", async () => {
    setup();
    const checkpointElements = [el("a"), el("b")];
    writeTempScene(sourceFile, checkpointElements);

    const store = openCheckpointStore(sourceFile);
    const cpScene = JSON.parse(fs.readFileSync(sourceFile, "utf8")) as ExcalidrawScene;
    const entry = store.save(cpScene);

    // Mutate the source file — add a new element
    writeTempScene(sourceFile, [el("a"), el("b"), el("c")]);

    const guard = new EchoGuard();
    // force: true so we can verify the exact-state write regardless of gate
    const result = await restoreCheckpoint(sourceFile, guard, { store, entry, force: true });

    expect(result.restored).toBe(true);

    const afterElements = readCurrentElements(sourceFile);
    // Should match checkpoint (a and b, no c)
    expect(afterElements.filter((e) => !e.isDeleted).map((e) => e.id).sort()).toEqual(
      ["a", "b"].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// AC2: Human has NOT edited since checkpoint → restore proceeds
// ---------------------------------------------------------------------------

describe("restoreCheckpoint — AC2: clean restore (no human edits)", () => {
  it("restored: true and file is written when diff is empty", async () => {
    setup();
    const elements = [el("x"), el("y")];
    writeTempScene(sourceFile, elements);

    const store = openCheckpointStore(sourceFile);
    const cpScene = JSON.parse(fs.readFileSync(sourceFile, "utf8")) as ExcalidrawScene;
    const entry = store.save(cpScene);
    // Do NOT modify the file — human changed nothing

    const guard = new EchoGuard();
    const result = await restoreCheckpoint(sourceFile, guard, { store, entry });

    expect(result.restored).toBe(true);
    expect(result.diff.added).toHaveLength(0);
    expect(result.diff.removed).toHaveLength(0);
    expect(result.diff.moved).toHaveLength(0);
    expect(result.diff.changed).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// AC3: Human HAS edited → gated (not restored), file unchanged on disk
// ---------------------------------------------------------------------------

describe("restoreCheckpoint — AC3: gate on human edit", () => {
  it("restored: false, diff non-empty, file is unchanged on disk", async () => {
    setup();
    const checkpointElements = [el("a"), el("b")];
    writeTempScene(sourceFile, checkpointElements);

    const store = openCheckpointStore(sourceFile);
    const cpScene = JSON.parse(fs.readFileSync(sourceFile, "utf8")) as ExcalidrawScene;
    const entry = store.save(cpScene);

    // Human moves element "a"
    const mutatedElements = [el("a", { x: 999 }), el("b")];
    writeTempScene(sourceFile, mutatedElements);

    // Capture exact bytes before restore attempt
    const bytesBefore = fs.readFileSync(sourceFile, "utf8");

    const guard = new EchoGuard();
    const result = await restoreCheckpoint(sourceFile, guard, { store, entry });

    expect(result.restored).toBe(false);
    // Diff must be non-empty
    const totalChanges =
      result.diff.added.length +
      result.diff.removed.length +
      result.diff.moved.length +
      result.diff.changed.length;
    expect(totalChanges).toBeGreaterThan(0);

    // File on disk must be UNCHANGED
    const bytesAfter = fs.readFileSync(sourceFile, "utf8");
    expect(bytesAfter).toBe(bytesBefore);
  });
});

// ---------------------------------------------------------------------------
// AC4: force: true overrides the gate
// ---------------------------------------------------------------------------

describe("restoreCheckpoint — AC4: force overrides gate", () => {
  it("restored: true even with non-empty diff when force: true", async () => {
    setup();
    const checkpointElements = [el("a"), el("b")];
    writeTempScene(sourceFile, checkpointElements);

    const store = openCheckpointStore(sourceFile);
    const cpScene = JSON.parse(fs.readFileSync(sourceFile, "utf8")) as ExcalidrawScene;
    const entry = store.save(cpScene);

    // Human adds element "c"
    writeTempScene(sourceFile, [el("a"), el("b"), el("c")]);

    const guard = new EchoGuard();
    const result = await restoreCheckpoint(sourceFile, guard, { store, entry, force: true });

    expect(result.restored).toBe(true);
    // diff is still surfaced
    expect(result.diff.added.length + result.diff.removed.length + result.diff.moved.length + result.diff.changed.length).toBeGreaterThan(0);

    // File is restored to checkpoint state
    const afterElements = readCurrentElements(sourceFile);
    expect(afterElements.filter((e) => !e.isDeleted).map((e) => e.id).sort()).toEqual(
      ["a", "b"].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// AC5: No checkpoint → clear result
// ---------------------------------------------------------------------------

describe("restoreCheckpoint — AC5: no checkpoint", () => {
  it("returns restored: false with reason 'no checkpoint' when store is empty", async () => {
    setup();
    writeTempScene(sourceFile, [el("a")]);

    const store = openCheckpointStore(sourceFile);
    // No checkpoints saved

    const guard = new EchoGuard();
    const result = await restoreCheckpoint(sourceFile, guard, { store });

    expect(result.restored).toBe(false);
    expect(result.reason).toBe("no checkpoint");
    expect(result.diff.added).toHaveLength(0);
    expect(result.diff.removed).toHaveLength(0);
    expect(result.diff.moved).toHaveLength(0);
    expect(result.diff.changed).toHaveLength(0);
  });
});
