import type { El } from "./scene-types";
import { readSceneFile, elementsOf } from "./scene-io";
import { openCheckpointStore } from "./checkpoint";
import type { CheckpointEntry, CheckpointStore } from "./checkpoint";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Result of a semantic diff between two element sets.
 * All arrays contain element ids.
 *
 * - added: id present in current but not in checkpoint.
 * - removed: id present in checkpoint but gone in current.
 * - moved: same id in both, position (x and/or y) changed.
 * - changed: same id in both, non-positional meaningful field changed
 *            (text, width, height, points, startBinding, endBinding,
 *            boundElements). An element with a position change is Moved,
 *            not Changed, even if other fields also differ.
 *
 * An id appears in at most one bucket.
 * A metadata-only change (version/versionNonce/seed/updated) produces no entry.
 */
export interface DiffReport {
  added: string[];
  removed: string[];
  moved: string[];
  changed: string[];
}

// ---------------------------------------------------------------------------
// Meaningful fields (non-volatile fields we compare)
// ---------------------------------------------------------------------------

const POSITION_FIELDS = new Set(["x", "y"]);

const MEANINGFUL_FIELDS = new Set([
  "x",
  "y",
  "width",
  "height",
  "points",
  "text",
  "startBinding",
  "endBinding",
  "boundElements",
]);

// ---------------------------------------------------------------------------
// Field-level comparators
// ---------------------------------------------------------------------------

/** Compare two values for a given field. Returns true if they are equal. */
function fieldEqual(field: string, a: unknown, b: unknown): boolean {
  if (field === "boundElements") {
    return boundElementsEqual(
      a as Array<{ type: string; id: string }> | null | undefined,
      b as Array<{ type: string; id: string }> | null | undefined,
    );
  }
  // points: deep order-sensitive comparison
  if (field === "points") {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  // startBinding / endBinding: deep structural comparison (order doesn't apply)
  if (field === "startBinding" || field === "endBinding") {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  // primitives and other fields: strict equality
  return a === b;
}

/**
 * boundElements is order-insensitive: compare as a set by (type, id).
 */
function boundElementsEqual(
  a: Array<{ type: string; id: string }> | null | undefined,
  b: Array<{ type: string; id: string }> | null | undefined,
): boolean {
  const arrA = a ?? [];
  const arrB = b ?? [];
  if (arrA.length !== arrB.length) return false;
  const keySet = new Set(arrA.map((e) => `${e.type}:${e.id}`));
  return arrB.every((e) => keySet.has(`${e.type}:${e.id}`));
}

// ---------------------------------------------------------------------------
// Pure core
// ---------------------------------------------------------------------------

/**
 * Diff two element sets by id.
 *
 * Pure function — no file IO. Elements are matched by `id`.
 * Volatile metadata (version, versionNonce, seed, updated) is ignored.
 * Meaningful fields: x, y, width, height, points, text,
 *                    startBinding, endBinding, boundElements.
 *
 * Classification priority:
 *   1. id only in current → Added
 *   2. id only in checkpoint → Removed
 *   3. same id, x or y differs → Moved (even if other fields also differ)
 *   4. same id, no position change but a non-positional meaningful field changed → Changed
 *   5. same id, only volatile metadata differs → no entry (no-op)
 */
export function diffScenes(checkpointElements: El[], currentElements: El[]): DiffReport {
  const report: DiffReport = { added: [], removed: [], moved: [], changed: [] };

  // Treat isDeleted:true elements as absent — Excalidraw soft-deletes keep the
  // element in the array but mark it deleted; we filter both inputs so that a
  // human deletion (active → isDeleted) is reported as Removed and the reverse
  // (isDeleted → active) is reported as Added. Inputs are not mutated.
  const activeCheckpoint = checkpointElements.filter((e) => !e.isDeleted);
  const activeCurrent = currentElements.filter((e) => !e.isDeleted);

  const checkpointById = new Map<string, El>();
  for (const e of activeCheckpoint) checkpointById.set(String(e.id), e);

  const currentById = new Map<string, El>();
  for (const e of activeCurrent) currentById.set(String(e.id), e);

  // Added: in current but not in checkpoint
  for (const [id] of currentById) {
    if (!checkpointById.has(id)) {
      report.added.push(id);
    }
  }

  // Removed: in checkpoint but not in current
  for (const [id] of checkpointById) {
    if (!currentById.has(id)) {
      report.removed.push(id);
    }
  }

  // Present in both: classify changes
  for (const [id, curr] of currentById) {
    const prev = checkpointById.get(id);
    if (!prev) continue; // already in Added

    // Check position fields first
    const positionChanged =
      !fieldEqual("x", prev.x, curr.x) || !fieldEqual("y", prev.y, curr.y);

    if (positionChanged) {
      report.moved.push(id);
      continue;
    }

    // Check non-positional meaningful fields
    let meaningfulChanged = false;
    for (const field of MEANINGFUL_FIELDS) {
      if (POSITION_FIELDS.has(field)) continue;
      if (!fieldEqual(field, prev[field], curr[field])) {
        meaningfulChanged = true;
        break;
      }
    }

    if (meaningfulChanged) {
      report.changed.push(id);
    }
    // else: metadata-only or identical → no entry
  }

  return report;
}

// ---------------------------------------------------------------------------
// Factory for an empty diff report
// ---------------------------------------------------------------------------

export function emptyDiffReport(): DiffReport {
  return { added: [], removed: [], moved: [], changed: [] };
}

// ---------------------------------------------------------------------------
// Convenience wrapper
// ---------------------------------------------------------------------------

/**
 * Diff the current source file against a checkpoint.
 *
 * Defaults to the latest checkpoint. If there is no checkpoint, every element
 * in the current file is reported as Added (all-added semantic: treat the
 * absence of a reference as if the checkpoint were an empty scene).
 *
 * @param sourceFilePath - Path to the .excalidraw source file.
 * @param opts.entry     - Specific checkpoint entry to diff against (overrides latest).
 * @param opts.store     - Pre-opened CheckpointStore (useful for testing); if omitted,
 *                         one is opened from the default .duet/ dir.
 */
// Declared async for API stability: callers can always await it uniformly even
// though the current implementation does only synchronous IO.
export async function diffAgainstCheckpoint(
  sourceFilePath: string,
  opts: { entry?: CheckpointEntry; store?: CheckpointStore } = {},
): Promise<DiffReport> {
  const store = opts.store ?? openCheckpointStore(sourceFilePath);

  // Read current file
  const currentScene = readSceneFile(sourceFilePath);
  const currentElements: El[] = elementsOf(currentScene);

  // Resolve checkpoint entry
  const entry = opts.entry ?? store.latest();

  // No checkpoint → everything is Added
  if (!entry) {
    const report = emptyDiffReport();
    report.added = currentElements.map((e) => String(e.id));
    return report;
  }

  const checkpointScene = store.readScene(entry);
  const checkpointElements: El[] = elementsOf(checkpointScene);

  return diffScenes(checkpointElements, currentElements);
}
