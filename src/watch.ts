import * as fs from "fs";
import * as path from "path";
import chokidar from "chokidar";

export interface WatchOptions {
  onScene: (scene: unknown) => void;
  onError?: (err: unknown) => void;
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
  { onScene, onError }: WatchOptions,
  { createWatcher = defaultCreateWatcher }: WatchDeps = {},
): WatchHandle {
  const target = path.resolve(filePath);
  const dir = path.dirname(target);

  const watcher = createWatcher(dir);

  const ready = new Promise<void>((resolve) => {
    watcher.on("ready", () => resolve());
  });

  function readAndEmit() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(target, "utf8"));
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
