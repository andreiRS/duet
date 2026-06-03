import * as path from "path";
import * as fs from "fs";

export type Scene = Record<string, unknown> | null;

export interface ServerHandle {
  server: ReturnType<typeof Bun.serve>;
  setScene(scene: Scene): void;
  getScene(): Scene;
}

export interface ServerOptions {
  port?: number;
  distDir?: string;
}

function sceneMsg(scene: Scene): string {
  return JSON.stringify({ type: "scene", scene });
}

function isFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

export function createServer({ port = 3000, distDir = "dist" }: ServerOptions = {}): ServerHandle {
  let currentScene: Scene = null;

  const server = Bun.serve({
    port,
    fetch(req, srv) {
      // Upgrade websocket connections; upgrade() returns false for plain HTTP
      if (srv.upgrade(req)) return undefined;

      // Static file serving
      const url = new URL(req.url);
      const fullPath = path.join(distDir, url.pathname);

      if (isFile(fullPath)) {
        return new Response(Bun.file(fullPath));
      }

      // Fallback to index.html for SPA
      const indexPath = path.join(distDir, "index.html");
      if (isFile(indexPath)) {
        return new Response(Bun.file(indexPath));
      }

      return new Response("Not Found", { status: 404 });
    },
    websocket: {
      open(ws) {
        ws.subscribe("scene");
        // Replay current scene immediately
        ws.send(sceneMsg(currentScene));
      },
      message(_ws, _data) {
        // Future slices will handle incoming messages
      },
      close(_ws) {},
    },
  });

  function setScene(scene: Scene): void {
    currentScene = scene;
    server.publish("scene", sceneMsg(scene));
  }

  function getScene(): Scene {
    return currentScene;
  }

  return { server, setScene, getScene };
}
