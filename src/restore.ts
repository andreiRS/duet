import type { CheckpointEntry, CheckpointStore } from "./checkpoint";
import { openCheckpointStore } from "./checkpoint";
import { diffScenes } from "./diff";
import type { DiffReport } from "./diff";
import { writeSceneFile, type EchoGuard } from "./writeback";
import * as fs from "fs";
import type { ExcalidrawScene, El } from "./scene-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RestoreResult {
  /** True if the checkpoint was written back to the source file. */
  restored: boolean;
  /** Diff of checkpoint vs. current file at time of restore call. */
  diff: DiffReport;
  /** Set when restore could not proceed (e.g. "no checkpoint"). */
  reason?: string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Restore a checkpoint to the source file, gated on a diff.
 *
 * - Defaults to the latest checkpoint.
 * - Computes diff (checkpoint vs. current file) first.
 * - Empty diff OR force: true  → writes checkpoint scene back (atomic, via writeSceneFile).
 * - Non-empty diff and no force → returns { restored: false, diff } without writing.
 * - No checkpoint at all → returns { restored: false, diff: <empty>, reason: "no checkpoint" }.
 *
 * The write goes through writeSceneFile so it is atomic (temp + rename) and the
 * EchoGuard records the bytes, letting a running Duet server treat the restore as
 * its own write rather than bouncing it back as a fake browser save.
 */
export async function restoreCheckpoint(
  sourceFilePath: string,
  guard: EchoGuard,
  opts: {
    entry?: CheckpointEntry;
    store?: CheckpointStore;
    force?: boolean;
  } = {},
): Promise<RestoreResult> {
  const emptyDiff: DiffReport = { added: [], removed: [], moved: [], changed: [] };

  const store = opts.store ?? openCheckpointStore(sourceFilePath);
  const entry = opts.entry ?? store.latest();

  if (!entry) {
    return { restored: false, diff: emptyDiff, reason: "no checkpoint" };
  }

  // Read checkpoint scene
  const checkpointScene = store.readScene(entry);
  const checkpointElements: El[] = Array.isArray(checkpointScene.elements)
    ? checkpointScene.elements
    : [];

  // Read current file
  const rawCurrent = fs.readFileSync(sourceFilePath, "utf8");
  const currentScene = JSON.parse(rawCurrent) as ExcalidrawScene;
  const currentElements: El[] = Array.isArray(currentScene.elements)
    ? currentScene.elements
    : [];

  // Compute diff (checkpoint vs. current)
  const diff = diffScenes(checkpointElements, currentElements);

  const isDirty =
    diff.added.length > 0 ||
    diff.removed.length > 0 ||
    diff.moved.length > 0 ||
    diff.changed.length > 0;

  // Gate: if human changed something and force is not set, refuse
  if (isDirty && !opts.force) {
    return { restored: false, diff };
  }

  // Write checkpoint scene back atomically
  writeSceneFile(
    sourceFilePath,
    {
      elements: checkpointScene.elements,
      appState: checkpointScene.appState,
    },
    guard,
    checkpointScene.source ?? "duet",
  );

  return { restored: true, diff };
}
