import * as fs from "fs";
import * as crypto from "crypto";

// Version gate: persist a browser edit only when the scene version actually
// CHANGES. Mouse-move/hover/selection/pointer noise re-fires Excalidraw's
// onChange without changing the element version, so those must not write.
// We compare with `!==` (not `>`): after an agent pushes a large scene, a
// genuine human edit can yield a LOWER summed version, and dropping that would
// silently lose the human's change. Only an UNCHANGED version is noise.
export function shouldPersist(prevVersion: number, nextVersion: number): boolean {
  return nextVersion !== prevVersion;
}

// Pure client-side persist decision, extracted from App.tsx so it is testable.
// Returns true only for a genuine human edit that should be written back.
//  - isApplyingRemote: a remote/agent scene is currently being applied; the
//    onChange(s) Excalidraw fires from updateScene must be ABSORBED, never
//    written back (otherwise the agent's update bounces out as a "save").
//  - otherwise persist iff the version actually changed (noise rejection).
export function shouldPersistEdit(args: {
  isApplyingRemote: boolean;
  prevVersion: number;
  nextVersion: number;
}): boolean {
  if (args.isApplyingRemote) return false;
  return shouldPersist(args.prevVersion, args.nextVersion);
}

// The only appState keys we persist. Everything else (scroll, zoom, selection,
// collaborators, cursor, drag state, ...) is transient view/session state and
// must never be written to the shared scene file.
const APP_STATE_WHITELIST = ["viewBackgroundColor", "gridSize", "theme"] as const;

export interface SceneInput {
  elements?: unknown;
  appState?: Record<string, unknown> | null;
}

export interface ShapedScene {
  type: "excalidraw";
  version: 2;
  source: string;
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

// Build the defensive on-disk excalidraw envelope. Drops everything transient
// even if the client sent extra keys: only whitelisted appState survives.
export function shapeSceneForFile(scene: SceneInput, source: string): ShapedScene {
  const inAppState = scene.appState ?? {};
  const appState: Record<string, unknown> = {};
  for (const key of APP_STATE_WHITELIST) {
    if (key in inAppState) appState[key] = inAppState[key];
  }
  return {
    type: "excalidraw",
    version: 2,
    source,
    elements: Array.isArray(scene.elements) ? scene.elements : [],
    appState,
    files: {},
  };
}

// sha256 of the exact bytes written/read, used to recognize Duet's own writes.
export function hashContent(bytes: string): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

// Small self-cleaning registry of content hashes Duet itself wrote. The watcher
// consumes a hash on match (so the rename-into-place event for our own write is
// skipped instead of bouncing back to the browser as a fake "agent update").
export class EchoGuard {
  // Bound the registry: awaitWriteFinish can coalesce writes, so an
  // intermediate write's hash may never be consumed. Without a bound those
  // stale hashes leak forever (memory) and a much later identical EXTERNAL
  // write could wrongly hash-match and be skipped. Keep only the last N
  // (insertion-ordered Set), evicting the oldest. consume() still removes on
  // match, so genuine recent self-writes are skipped correctly.
  private static readonly MAX = 16;
  private pending = new Set<string>();

  record(hash: string): void {
    // Re-insert to refresh recency, then trim to the most recent MAX.
    this.pending.delete(hash);
    this.pending.add(hash);
    while (this.pending.size > EchoGuard.MAX) {
      const oldest = this.pending.values().next().value as string;
      this.pending.delete(oldest);
    }
  }

  // Returns true if this hash was our own write (and consumes it). False means
  // an external/agent write that should be processed normally.
  consume(hash: string): boolean {
    if (this.pending.has(hash)) {
      this.pending.delete(hash);
      return true;
    }
    return false;
  }
}

// Atomically write the shaped scene to filePath (temp file + rename over target,
// so no reader ever sees a half-written file) and register the exact bytes in
// the echo guard so the resulting watcher event is recognized as our own.
export function writeSceneFile(
  filePath: string,
  scene: SceneInput,
  guard: EchoGuard,
  source = "duet",
): ShapedScene {
  const shaped = shapeSceneForFile(scene, source);
  const bytes = JSON.stringify(shaped, null, 2);
  guard.record(hashContent(bytes));
  // Unique tmp path per call: pid + timestamp alone can collide for two writes
  // in the same millisecond (the second would clobber the first's tmp file and
  // the loser's rename can ENOENT, silently losing a write). The random suffix
  // makes every tmp name distinct.
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${crypto
    .randomBytes(6)
    .toString("hex")}.tmp`;
  fs.writeFileSync(tmpPath, bytes, "utf8");
  fs.renameSync(tmpPath, filePath);
  return shaped;
}
