import * as fs from "fs";
import { createServer, type ServerHandle, type Scene } from "./server";
import { watchScene, type WatchHandle } from "./watch";
import { EchoGuard, hashContent, type ShapedScene } from "./writeback";

// Default animation duration for camera fit (ms). Exact value tuned in #24.
const CAMERA_FIT_DURATION_MS = 300;

export interface CameraResult {
  code: 0 | 1 | 2;
  stdout?: string;
  stderr?: string;
}

/**
 * Parse and run the `camera` subcommand.
 * @param argv  The args AFTER "camera" (e.g. ["--port", "3737", "--no-animate"])
 * @param env   An env-var map (e.g. process.env). Used for DUET_PORT fallback.
 * @returns     A result object — does NOT call process.exit or write to console.
 */
export async function runCameraCommand(
  argv: string[],
  env: Record<string, string | undefined>,
): Promise<CameraResult> {
  // Parse flags
  let portArg: string | undefined;
  let animate = true;
  const ids: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--port") {
      portArg = argv[++i];
    } else if (arg === "--no-animate") {
      animate = false;
    } else if (arg === "--to") {
      const raw = argv[++i] ?? "";
      ids.push(...raw.split(",").filter(Boolean));
    }
  }

  // Port precedence: --port flag > DUET_PORT env > 3737 default
  const portRaw = portArg ?? env["DUET_PORT"] ?? "3737";
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port <= 0) {
    return { code: 1, stderr: "duet: --port requires a number" };
  }

  // Build request body
  const body: Record<string, unknown> = {
    op: "fit",
    animate,
    duration: CAMERA_FIT_DURATION_MS,
  };
  if (ids.length > 0) {
    body.to = ids;
  }

  // POST to server. A connection failure or an unreadable (non-JSON) body are
  // both treated as "server unreachable" (code 2) — we never got a usable reply.
  let resp: Response;
  let json: unknown;
  try {
    resp = await fetch(`http://localhost:${port}/camera`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    json = await resp.json();
  } catch {
    return {
      code: 2,
      stderr: `duet: no server on localhost:${port} — start one with \`duet <file>\``,
    };
  }

  if (!resp.ok) {
    return { code: 1, stdout: JSON.stringify(json) };
  }

  const framed = (json as { framed: number }).framed;
  if (framed === 0) {
    return {
      code: 0,
      stdout: JSON.stringify(json),
      stderr: "duet: 0 tabs connected",
    };
  }

  return { code: 0, stdout: JSON.stringify(json) };
}

export const EMPTY_SCENE: ShapedScene = {
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
  port = 3737,
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
  if (process.argv[2] === "camera") {
    // Short-lived POST client — boots no server, no watcher
    const cameraArgv = process.argv.slice(3); // args after "camera"
    const result = await runCameraCommand(cameraArgv, process.env as Record<string, string | undefined>);
    if (result.stdout) process.stdout.write(result.stdout + "\n");
    if (result.stderr) process.stderr.write(result.stderr + "\n");
    process.exit(result.code);
  }

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
