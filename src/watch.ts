import * as fs from "fs";
import chokidar from "chokidar";

export interface WatchOptions {
  onScene: (scene: unknown) => void;
  onError?: (err: unknown) => void;
}

export interface WatchHandle {
  ready: Promise<void>;
  close(): Promise<void>;
}

export function watchScene(filePath: string, { onScene, onError }: WatchOptions): WatchHandle {
  const watcher = chokidar.watch(filePath, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
  });

  const ready = new Promise<void>((resolve) => {
    watcher.on("ready", () => resolve());
  });

  watcher.on("change", () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (err) {
      // Malformed or partial read (agent mid-write). Keep the last good scene:
      // do not call onScene. Warn and report.
      console.warn(`duet: ignoring invalid scene write to ${filePath}:`, err);
      onError?.(err);
      return;
    }
    onScene(parsed);
  });

  return {
    ready,
    close: () => watcher.close(),
  };
}
