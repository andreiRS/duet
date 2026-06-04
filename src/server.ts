import * as path from "path";
import * as fs from "fs";
import { EchoGuard, writeSceneFile } from "./writeback";
import { readSceneFile, elementsOf } from "./scene-io";
import { mergeById, type El } from "./reconcile";

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

// Re-read the current on-disk elements for the browser-save merge. If the file
// does not exist yet, disk is empty (mergeById([], incoming) preserves today's
// "write the incoming scene" behavior). On a malformed/unreadable read, log and
// fall back to empty disk so a bad on-disk file degrades to writing the incoming
// scene rather than crashing the WS handler (matches its try/catch tolerance).
function readDiskElements(filePath: string): El[] {
  if (!fs.existsSync(filePath)) return [];
  try {
    return elementsOf(readSceneFile(filePath));
  } catch (err) {
    console.warn(`duet: could not re-read ${filePath} for merge, writing incoming scene as-is:`, err);
    return [];
  }
}

function isFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

export function createServer({
  port = 3737,
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
            // Reverse-race fix (ADR-0007, #17): the browser save is a stale,
            // 400ms-debounced full-scene snapshot. Re-read the current on-disk
            // elements and merge the incoming ones by id, so an element the
            // agent wrote during the debounce window is KEPT instead of blindly
            // overwritten. Only `elements` are merged; appState stays
            // whole-value/whitelisted via writeSceneFile.
            const incoming: El[] = Array.isArray(elements) ? (elements as El[]) : [];
            const merged = mergeById(readDiskElements(filePath), incoming);
            const shaped = writeSceneFile(filePath, { elements: merged, appState }, echoGuard);
            currentScene = shaped as unknown as Scene;
            // Broadcast the MERGED scene to ALL tabs INCLUDING the sender
            // (ADR-0007). The merge can differ from what the sender sent (it
            // gains the agent's concurrent element), so the sender must see the
            // reconciled truth. server.publish reaches every subscriber;
            // ws.publish would exclude the sender. No save-loop: the client's
            // isApplyingRemote guard absorbs the resulting onChange.
            server.publish("scene", sceneMsg(currentScene));
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
