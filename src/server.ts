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

export function createServer({ port = 3000, distDir = "dist" }: ServerOptions = {}): ServerHandle {
  let currentScene: Scene = null;

  const server = Bun.serve({
    port,
    fetch(req, srv) {
      // Upgrade websocket connections
      if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
        const ok = srv.upgrade(req);
        if (ok) return undefined;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      // Static file serving
      const url = new URL(req.url);
      const filePath = url.pathname === "/" ? "/index.html" : url.pathname;
      const fullPath = path.join(distDir, filePath);

      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        return new Response(Bun.file(fullPath));
      }

      // Fallback to index.html for SPA
      const indexPath = path.join(distDir, "index.html");
      if (fs.existsSync(indexPath)) {
        return new Response(Bun.file(indexPath));
      }

      return new Response("Not Found", { status: 404 });
    },
    websocket: {
      open(ws) {
        ws.subscribe("scene");
        // Replay current scene immediately
        const msg = JSON.stringify({ type: "scene", scene: currentScene });
        ws.send(msg);
      },
      message(_ws, _data) {
        // Future slices will handle incoming messages
      },
      close(_ws) {},
    },
  });

  function setScene(scene: Scene): void {
    currentScene = scene;
    server.publish("scene", JSON.stringify({ type: "scene", scene }));
  }

  function getScene(): Scene {
    return currentScene;
  }

  return { server, setScene, getScene };
}
