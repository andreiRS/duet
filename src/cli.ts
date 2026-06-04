import * as fs from "fs";
import { createServer, type ServerHandle, type Scene } from "./server";
import { watchScene, type WatchHandle } from "./watch";
import { EchoGuard, hashContent, type ShapedScene } from "./writeback";

// Default animation duration for camera fit (ms). Tuned to 400ms in #24.
// Keep in sync with CAMERA_DEFAULT_DURATION_MS (camera.ts), the browser-side
// fallback for a non-CLI POST.
const CAMERA_FIT_DURATION_MS = 400;

// Usage text for `duet --help`. Kept here (not a man page) so an agent can
// discover the camera command and its flags from the CLI alone.
export const HELP = `Duet keeps one .excalidraw file in sync between an AI agent and your browser, live.
Watch the agent draw, grab any shape and fix it by hand. The file is the source of truth.

Usage:
  duet new <file.excalidraw>    Create an empty scene file and print its path.
                                Does not start the server. Errors if the file exists.
  duet serve <file.excalidraw>  Start the sync server (HTTP + WebSocket + file watch)
                                and open the scene in your browser. Edit the file
                                directly to drive the canvas. Errors if the file is
                                missing (create it with \`duet new\`).
  duet camera [options]         Move the browser camera in every connected tab.
  duet --help                   Show this help.

Options:
  --port <n>                    Port for the Duet server
                                (default 3737, or the DUET_PORT env var).

camera options:
  --to <id1,id2,...>            Fit (zoom + center) the view to these element ids.
                                Omit to fit the whole scene. ids are the "id" fields
                                of elements in the .excalidraw file.
  --no-animate                  Jump instantly instead of animating the move.

camera output (stdout, JSON) and exit codes:
  {"framed":<n>}                exit 0, n tabs moved (n may be 0 if no browser is open).
  {"missing":[<id>,...]}        exit 1, one or more --to ids are not in the scene.
  (stderr hint, no JSON)        exit 2, no server reachable on the port.

Examples:
  duet new ./scene.excalidraw                   # scaffold a blank scene
  duet serve ./scene.excalidraw                 # serve it + open the browser
  duet camera                                   # fit the whole scene
  duet camera --to aB3xK9,Qz7Lm2                # zoom to two elements
  duet camera --to aB3xK9 --no-animate          # snap, no animation
`;

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

export interface CommandResult {
  code: 0 | 1;
  stdout?: string;
  stderr?: string;
}

/**
 * `duet new <file>` — scaffold a blank scene. Never serves, never clobbers:
 * errors if the path already exists so an agent can't wipe work by re-running.
 * Mirrors `cargo new` / `rails new` (create-only, separate from run).
 */
export function runNew(filePath: string | undefined): CommandResult {
  if (!filePath) {
    return { code: 1, stderr: "duet: new needs a file path, e.g. `duet new ./scene.excalidraw`" };
  }
  if (fs.existsSync(filePath)) {
    return { code: 1, stderr: `duet: ${filePath} already exists — serve it with \`duet serve ${filePath}\`` };
  }
  fs.writeFileSync(filePath, JSON.stringify(EMPTY_SCENE, null, 2), "utf8");
  return { code: 0, stdout: `created ${filePath}\nserve it with: duet serve ${filePath}` };
}

/**
 * Validate the target of `duet serve <file>`. Returns an error result when the
 * path is missing or absent on disk, or null when it's safe to bootstrap.
 * `serve` is strict (no auto-create) so a typo'd path fails loudly instead of
 * silently serving a fresh blank canvas.
 */
export function serveError(filePath: string | undefined): CommandResult | null {
  if (!filePath) {
    return { code: 1, stderr: "duet: serve needs a file path, e.g. `duet serve ./scene.excalidraw`" };
  }
  if (!fs.existsSync(filePath)) {
    return { code: 1, stderr: `duet: no such scene: ${filePath} — create it with \`duet new ${filePath}\`` };
  }
  return null;
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

const isHelpFlag = (a: string | undefined): boolean =>
  a === "--help" || a === "-h" || a === "help";

const KNOWN_COMMANDS = new Set(["new", "serve", "camera"]);

if (import.meta.main) {
  const argv = process.argv.slice(2);

  // `duet --help`, `duet -h`, `duet help`, or `--help` after any known command
  // (e.g. `duet camera --help`, `duet serve --help`).
  if (
    isHelpFlag(argv[0]) ||
    (KNOWN_COMMANDS.has(argv[0]!) && argv.slice(1).some(isHelpFlag))
  ) {
    process.stdout.write(HELP);
    process.exit(0);
  }

  if (argv[0] === "new") {
    const result = runNew(argv[1]);
    if (result.stdout) process.stdout.write(result.stdout + "\n");
    if (result.stderr) process.stderr.write(result.stderr + "\n");
    process.exit(result.code);
  } else if (argv[0] === "serve") {
    // Parse args after "serve": first non-flag is the file, --port <n> optional.
    const rest = argv.slice(1);
    let portArg: string | undefined;
    let filePath: string | undefined;
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === "--port") portArg = rest[++i];
      else if (filePath === undefined && !rest[i]!.startsWith("-")) filePath = rest[i];
    }

    const err = serveError(filePath);
    if (err) {
      if (err.stderr) process.stderr.write(err.stderr + "\n");
      process.exit(err.code);
    }

    // Port precedence: --port flag > DUET_PORT env > 3737 default.
    const portRaw = portArg ?? process.env.DUET_PORT ?? "3737";
    const port = Number(portRaw);
    if (!Number.isInteger(port) || port < 0) {
      process.stderr.write("duet: --port requires a number\n");
      process.exit(1);
    }

    // Long-running: bootstrap keeps the process alive (server + watcher).
    bootstrap({
      filePath: filePath!,
      port,
      openBrowser: (url) => {
        Bun.spawn(["open", url]);
      },
    });
  } else if (argv[0] === "camera") {
    // Short-lived POST client — boots no server, no watcher
    const cameraArgv = argv.slice(1); // args after "camera"
    const result = await runCameraCommand(cameraArgv, process.env as Record<string, string | undefined>);
    if (result.stdout) process.stdout.write(result.stdout + "\n");
    if (result.stderr) process.stderr.write(result.stderr + "\n");
    process.exit(result.code);
  } else if (argv[0]?.endsWith(".excalidraw")) {
    // Old positional form — nudge toward the verb.
    process.stderr.write(`duet: no command given — did you mean \`duet serve ${argv[0]}\`?\n`);
    process.exit(1);
  } else {
    // Unknown / no command: show help so an agent learns the commands.
    process.stderr.write(HELP);
    process.exit(1);
  }
}
