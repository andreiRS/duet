import * as path from "path";
import * as fs from "fs";
import { EchoGuard, writeSceneFile } from "./writeback";

export type Scene = Record<string, unknown> | null;

export interface ServerHandle {
  server: ReturnType<typeof Bun.serve>;
  setScene(scene: Scene): void;
  getScene(): Scene;
}

export interface ServerOptions {
  port?: number;
  distDir?: string;
  // When provided, the server persists incoming {type:"save"} browser edits to
  // this file (atomic write). The echo guard is shared with the watcher so the
  // resulting file event is recognized as Duet's own and not bounced back.
  filePath?: string;
  echoGuard?: EchoGuard;
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

export function createServer({
  port = 3000,
  distDir = "dist",
  filePath,
  echoGuard,
}: ServerOptions = {}): ServerHandle {
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
      message(ws, data) {
        // Browser write-back: persist the human's edit to the same file the
        // agent reads. The echo guard records the bytes so the watcher skips the
        // resulting file event instead of rebroadcasting our own write.
        if (!filePath || !echoGuard) return;
        let msg: unknown;
        try {
          msg = JSON.parse(typeof data === "string" ? data : data.toString());
        } catch {
          return; // ignore non-JSON
        }
        if (
          typeof msg === "object" &&
          msg !== null &&
          (msg as { type?: unknown }).type === "save"
        ) {
          const { elements, appState } = msg as {
            elements?: unknown;
            appState?: Record<string, unknown> | null;
          };
          try {
            const shaped = writeSceneFile(filePath, { elements, appState }, echoGuard);
            currentScene = shaped as unknown as Scene;
            // Fan out the human's edit to OTHER clients. The echo guard makes the
            // watcher skip the file event this write triggers, so without this
            // publish the edit never reaches other tabs until they reconnect
            // (bug B1). ws.publish excludes the sender, so this tab does not bounce.
            ws.publish("scene", sceneMsg(currentScene));
          } catch (err) {
            console.warn(`duet: failed to persist browser edit to ${filePath}:`, err);
          }
        }
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
