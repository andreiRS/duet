import * as fs from "fs";
import * as crypto from "crypto";

// Version gate: persist a browser edit only when the scene version actually
// ADVANCES. Mouse-move/hover/selection/pointer noise re-fires Excalidraw's
// onChange without changing the element version, so those must not write.
export function shouldPersist(prevVersion: number, nextVersion: number): boolean {
  return nextVersion > prevVersion;
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
  private pending = new Set<string>();

  record(hash: string): void {
    this.pending.add(hash);
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
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, bytes, "utf8");
  fs.renameSync(tmpPath, filePath);
  return shaped;
}
