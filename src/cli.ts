import * as fs from "fs";
import { createServer, type ServerHandle, type Scene } from "./server";
import { watchScene, type WatchHandle } from "./watch";
import { EchoGuard, hashContent } from "./writeback";

export const EMPTY_SCENE = {
  type: "excalidraw",
  version: 2,
  source: "https://excalidraw.com",
  elements: [],
  appState: {
    viewBackgroundColor: "#ffffff",
    gridSize: null,
  },
  files: {},
};

export function ensureScene(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(EMPTY_SCENE, null, 2), "utf8");
  }
}

export interface BootstrapOptions {
  filePath: string;
  port?: number;
  openBrowser?: (url: string) => void;
}

export interface BootstrapHandle extends ServerHandle {
  watcher: WatchHandle;
  close(): Promise<void>;
}

export function bootstrap({
  filePath,
  port = 3000,
  openBrowser,
}: BootstrapOptions): BootstrapHandle {
  ensureScene(filePath);
  const scene = JSON.parse(fs.readFileSync(filePath, "utf8"));

  // One echo-guard registry shared by both halves of the loop: the server
  // records the bytes it writes for a browser save, and the watcher consumes
  // the matching hash so Duet's own write-back never bounces to the browser.
  const echoGuard = new EchoGuard();
  const handle = createServer({ port, filePath, echoGuard });
  handle.setScene(scene);

  // Watch the served file: on each valid change, push it to all browser tabs.
  // Malformed/partial reads keep the last good scene (handled inside watchScene).
  // shouldSkip drops the events caused by our own write-back (echo guard).
  const watcher = watchScene(filePath, {
    onScene: (parsed) => handle.setScene(parsed as Scene),
    shouldSkip: (raw) => echoGuard.consume(hashContent(raw)),
  });

  const url = `http://localhost:${handle.server.port}/`;
  if (openBrowser) {
    openBrowser(url);
  }

  return {
    ...handle,
    watcher,
    close: async () => {
      await watcher.close();
      handle.server.stop(true);
    },
  };
}

if (import.meta.main) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: duet <path-to-scene.excalidraw>");
    process.exit(1);
  }
  bootstrap({
    filePath,
    openBrowser: (url) => {
      Bun.spawn(["open", url]);
    },
  });
}
