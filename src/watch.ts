import * as fs from "fs";
import * as path from "path";
import chokidar from "chokidar";

export interface WatchOptions {
  onScene: (scene: unknown) => void;
  onError?: (err: unknown) => void;
  // Echo guard hook: given the exact bytes just read, return true to SKIP this
  // event (it is Duet's own write-back, not an external/agent edit). Keeps the
  // hash registry out of the watcher; the caller shares it with the write path.
  shouldSkip?: (rawBytes: string) => boolean;
}

export interface WatchHandle {
  ready: Promise<void>;
  close(): Promise<void>;
}

// Minimal slice of chokidar's FSWatcher we rely on. Lets tests inject a watcher
// they can emit on (e.g. to drive the error path deterministically).
export interface SceneWatcher {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  close(): Promise<void>;
}

export interface WatchDeps {
  createWatcher?: (dir: string) => SceneWatcher;
}

function defaultCreateWatcher(dir: string): SceneWatcher {
  // Watch the PARENT directory rather than the single file path. Atomic writes
  // (write temp + rename over target) can fire unlink+add and lose a single-file
  // watch, so the directory watch + filename filter keeps seeing the recreated
  // file. Slice 6 writes exactly this way.
  return chokidar.watch(dir, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
  }) as unknown as SceneWatcher;
}

export function watchScene(
  filePath: string,
  { onScene, onError, shouldSkip }: WatchOptions,
  { createWatcher = defaultCreateWatcher }: WatchDeps = {},
): WatchHandle {
  const target = path.resolve(filePath);
  const dir = path.dirname(target);

  const watcher = createWatcher(dir);

  const ready = new Promise<void>((resolve) => {
    watcher.on("ready", () => resolve());
  });

  function readAndEmit() {
    let raw: string;
    try {
      raw = fs.readFileSync(target, "utf8");
    } catch (err) {
      console.warn(`duet: ignoring unreadable scene at ${target}:`, err);
      onError?.(err);
      return;
    }
    // Echo guard: if these exact bytes are Duet's own write-back, consume and
    // skip so the rename-into-place event does not bounce back to the browser.
    if (shouldSkip?.(raw)) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      // Malformed or partial read (agent mid-write). Keep the last good scene:
      // do not call onScene. Warn and report.
      console.warn(`duet: ignoring invalid scene write to ${target}:`, err);
      onError?.(err);
      return;
    }
    onScene(parsed);
  }

  // Route both add and change through the same read+parse path: an atomic
  // rename surfaces as add on platforms where it replaces the inode.
  for (const event of ["add", "change"] as const) {
    watcher.on(event, (changedPath: unknown) => {
      if (typeof changedPath !== "string" || path.resolve(changedPath) !== target) return;
      readAndEmit();
    });
  }

  // Chokidar emits errors on its EventEmitter; an unhandled one (EPERM, inotify
  // limit, inaccessible dir) would throw and can crash the server. Route it.
  watcher.on("error", (err: unknown) => {
    console.warn(`duet: scene watcher error for ${target}:`, err);
    onError?.(err);
  });

  return {
    ready,
    close: () => watcher.close(),
  };
}
