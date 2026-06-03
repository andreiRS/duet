import * as fs from "fs";
import { createServer, type ServerHandle } from "./server";

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
  // ServerHandle already has server, setScene, getScene
}

export async function bootstrap({
  filePath,
  port = 3000,
  openBrowser,
}: BootstrapOptions): Promise<BootstrapHandle> {
  ensureScene(filePath);
  const scene = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const handle = createServer({ port });
  handle.setScene(scene);

  const url = `http://localhost:${handle.server.port}/`;
  if (openBrowser) {
    openBrowser(url);
  }

  return handle;
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
