import type { CheckpointEntry, CheckpointStore } from "./checkpoint";
import { openCheckpointStore } from "./checkpoint";
import { diffAgainstCheckpoint, emptyDiffReport } from "./diff";
import type { DiffReport } from "./diff";
import { writeSceneFile, type EchoGuard } from "./writeback";

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
  const store = opts.store ?? openCheckpointStore(sourceFilePath);
  const entry = opts.entry ?? store.latest();

  if (!entry) {
    return { restored: false, diff: emptyDiffReport(), reason: "no checkpoint" };
  }

  // Use diffAgainstCheckpoint to compute the diff (avoids re-reading + re-diffing inline)
  const diff = await diffAgainstCheckpoint(sourceFilePath, { entry, store });

  const isDirty =
    diff.added.length > 0 ||
    diff.removed.length > 0 ||
    diff.moved.length > 0 ||
    diff.changed.length > 0;

  // Gate: if human changed something and force is not set, refuse
  if (isDirty && !opts.force) {
    return { restored: false, diff };
  }

  // Read checkpoint scene for write-back (diffAgainstCheckpoint read it too — acceptable)
  const checkpointScene = store.readScene(entry);

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
