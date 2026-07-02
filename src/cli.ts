#!/usr/bin/env bun
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createServer, type ServerHandle, type Scene } from "./server";
import { watchScene, type WatchHandle } from "./watch";
import { EchoGuard, hashContent, type ShapedScene } from "./writeback";
import { readSceneFile, elementsOf } from "./scene-io";

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
  duet ls <file.excalidraw>     List the scene's elements (id, type, label), one
                                per line. Reads the file directly, no server
                                needed. Use it to learn the ids \`camera --to\` wants.
  duet camera fit [options]     Fit (zoom + center) the browser camera to the
                                scene, in every connected tab.
  duet camera zoom              Not implemented yet.
  duet camera pan               Not implemented yet.
  duet --help                   Show this help.

Options:
  --port <n>                    Port for the Duet server
                                (default 3737, or the DUET_PORT env var).
                                The default falls back to the next free port
                                when 3737 is busy; an explicit --port does not.
                                camera finds the bound port via a discovery file
                                (override its path with the DUET_PORT_FILE env var).

ls options:
  --json                        Print a JSON array of {id,type,label} instead of
                                aligned columns, for machine parsing.

camera fit options:
  --to <id1,id2,...>            Fit (zoom + center) the view to these element ids.
                                Omit to fit the whole scene. ids are the "id" fields
                                of elements in the .excalidraw file.
  --no-animate                  Jump instantly instead of animating the move.

camera fit output (stdout, JSON) and exit codes:
  {"framed":<n>}                exit 0, n tabs moved (n may be 0 if no browser is open).
  {"missing":[<id>,...]}        exit 1, one or more --to ids are not in the scene.
  (stderr hint, no JSON)        exit 2, no server reachable on the port.

Examples:
  duet new ./scene.excalidraw                   # scaffold a blank scene
  duet serve ./scene.excalidraw                 # serve it + open the browser
  duet ls ./scene.excalidraw                    # list element ids + labels
  duet camera fit                               # fit the whole scene
  duet camera fit --to aB3xK9,Qz7Lm2            # zoom to two elements
  duet camera fit --to aB3xK9 --no-animate      # snap, no animation
`;

// --- Served-port discovery file -------------------------------------------
// `duet serve` writes the port it actually bound to a small state file so that
// a later `duet camera` (which resolves its port independently and takes no
// file path) can still reach the server after a free-port fallback moved it off
// the default 3737. The location is env-overridable so tests can point it at a
// temp file.
export interface ServedPortRecord {
  port: number;
  filePath: string;
  pid: number;
}

export function discoveryPath(env: Record<string, string | undefined>): string {
  return env.DUET_PORT_FILE ?? path.join(os.tmpdir(), "duet-serve.json");
}

export function writeServedPort(
  env: Record<string, string | undefined>,
  rec: ServedPortRecord,
): void {
  try {
    fs.writeFileSync(discoveryPath(env), JSON.stringify(rec), "utf8");
  } catch {
    // Best-effort: a discovery-file write failure must never take down serve.
  }
}

export function readServedPort(
  env: Record<string, string | undefined>,
): ServedPortRecord | null {
  try {
    const raw = fs.readFileSync(discoveryPath(env), "utf8");
    const rec = JSON.parse(raw);
    if (rec && typeof rec.port === "number" && Number.isInteger(rec.port) && rec.port > 0) {
      return rec as ServedPortRecord;
    }
    return null;
  } catch {
    return null;
  }
}

export function clearServedPort(env: Record<string, string | undefined>): void {
  try {
    fs.unlinkSync(discoveryPath(env));
  } catch {
    // Missing or already-removed file is fine.
  }
}

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

  // Port precedence: --port flag > DUET_PORT env > served-port discovery file
  // (where a free-port fallback may have moved the server) > 3737 default.
  const discovered = portArg === undefined && env["DUET_PORT"] === undefined
    ? readServedPort(env)?.port
    : undefined;
  const portRaw = portArg ?? env["DUET_PORT"] ?? discovered?.toString() ?? "3737";
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
      stderr: `duet: no server on localhost:${port} — start one with \`duet serve <file>\``,
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
 * The label shown for one element: a text element uses its own `text`; any other
 * shape uses the `text` of its bound text element (via `boundElements`). Empty
 * string when there is no text.
 */
function labelOf(el: any, textById: Map<string, any>): string {
  if (el.type === "text") return (el.text ?? "") as string;
  const bound = Array.isArray(el.boundElements)
    ? el.boundElements.find((b: any) => b.type === "text")
    : undefined;
  return bound ? ((textById.get(bound.id)?.text ?? "") as string) : "";
}

/**
 * `duet ls <file>` — read the scene off disk (no server) and print one row per
 * visible element so an agent can learn the random element ids it needs for
 * `camera --to`. Plain columns by default; `{ json: true }` emits an array of
 * `{id,type,label}`.
 */
export function runLs(
  filePath: string | undefined,
  opts: { json?: boolean },
): CommandResult {
  if (!filePath) {
    return { code: 1, stderr: "duet: ls needs a file path, e.g. `duet ls ./scene.excalidraw`" };
  }
  let scene: { elements?: unknown };
  try {
    scene = readSceneFile(filePath);
  } catch {
    return { code: 1, stderr: `duet: could not read ${filePath} — is it a valid .excalidraw file?` };
  }
  const elements = elementsOf(scene);
  const textById = new Map<string, any>(
    elements.filter((el) => el.type === "text").map((el) => [el.id, el]),
  );

  // A text bound to a container is that container's label, not a row of its own.
  const rows = elements
    .filter((el) => !el.isDeleted)
    .filter((el) => !(el.type === "text" && el.containerId))
    .map((el) => ({
      id: el.id as string,
      type: el.type as string,
      label: labelOf(el, textById),
    }));

  if (opts.json) {
    return { code: 0, stdout: JSON.stringify(rows) };
  }
  // Pad id + type to their widest entry so the label column lines up.
  const idW = Math.max(0, ...rows.map((r) => r.id.length));
  const typeW = Math.max(0, ...rows.map((r) => r.type.length));
  const lines = rows.map(
    (r) => `${r.id.padEnd(idW)}  ${r.type.padEnd(typeW)}  ${JSON.stringify(r.label)}`,
  );
  return { code: 0, stdout: lines.join("\n") };
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
  /**
   * When true, if `port` is already in use, retry on the next ports
   * (`port+1`, `port+2`, …) until one is free. When false (default), a bind
   * failure propagates — the caller asked for that exact port.
   */
  fallback?: boolean;
}

// How many consecutive ports to try before giving up when `fallback` is on.
export const PORT_FALLBACK_ATTEMPTS = 20;

// True for the synchronous error Bun.serve throws when the port is taken.
function isAddrInUse(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  return (
    !!e &&
    (e.code === "EADDRINUSE" || /address already in use|EADDRINUSE/i.test(e.message ?? ""))
  );
}

export interface BootstrapHandle extends ServerHandle {
  watcher: WatchHandle;
  close(): Promise<void>;
}

export function bootstrap({
  filePath,
  port = 3737,
  openBrowser,
  fallback = false,
}: BootstrapOptions): BootstrapHandle {
  ensureScene(filePath);
  const scene = JSON.parse(fs.readFileSync(filePath, "utf8"));

  // One echo-guard registry shared by both halves of the loop: the server
  // records the bytes it writes for a browser save, and the watcher consumes
  // the matching hash so Duet's own write-back never bounces to the browser.
  const echoGuard = new EchoGuard();
  // Bind the port. Without fallback, a taken port throws (caller wants that
  // exact port). With fallback, walk to the next free port; Bun.serve throws
  // synchronously on EADDRINUSE, so this is a plain loop.
  let handle: ServerHandle;
  if (!fallback) {
    handle = createServer({ port, filePath, echoGuard });
  } else {
    let bound: ServerHandle | undefined;
    for (let i = 0; i < PORT_FALLBACK_ATTEMPTS; i++) {
      try {
        bound = createServer({ port: port + i, filePath, echoGuard });
        break;
      } catch (err) {
        if (isAddrInUse(err)) continue;
        throw err;
      }
    }
    if (!bound) {
      throw new Error(
        `duet: ports ${port}–${port + PORT_FALLBACK_ATTEMPTS - 1} are all in use`,
      );
    }
    handle = bound;
  }
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

const KNOWN_COMMANDS = new Set(["new", "serve", "ls", "camera"]);

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
  } else if (argv[0] === "ls") {
    // Short-lived reader: no server, no watcher. First non-flag arg is the file;
    // --json switches to machine output.
    const rest = argv.slice(1);
    let json = false;
    let filePath: string | undefined;
    for (const a of rest) {
      if (a === "--json") json = true;
      else if (filePath === undefined && !a.startsWith("-")) filePath = a;
    }
    const result = runLs(filePath, { json });
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
    const explicit = portArg !== undefined || process.env.DUET_PORT !== undefined;
    const portRaw = portArg ?? process.env.DUET_PORT ?? "3737";
    const port = Number(portRaw);
    if (!Number.isInteger(port) || port <= 0) {
      process.stderr.write("duet: --port requires a number\n");
      process.exit(1);
    }

    // Long-running: bootstrap keeps the process alive (server + watcher).
    // Only the unspecified default falls back to a free port; an explicit port
    // is a hard requirement, so a collision there fails loudly.
    let handle: BootstrapHandle;
    try {
      handle = bootstrap({
        filePath: filePath!,
        port,
        fallback: !explicit,
        openBrowser: (url) => {
          Bun.spawn(["open", url]);
        },
      });
    } catch (err) {
      if (isAddrInUse(err)) {
        process.stderr.write(
          `duet: port ${port} is already in use — stop the other server or pass a different --port\n`,
        );
      } else if (err instanceof Error && err.message.startsWith("duet:")) {
        process.stderr.write(err.message + " — pass --port to pick one\n");
      } else {
        throw err;
      }
      process.exit(1);
    }

    const boundPort = handle.server.port ?? port;
    process.stdout.write(
      `Duet serving ${filePath} on http://localhost:${boundPort}` +
        (boundPort !== port ? ` (${port} was busy)` : "") +
        "\n",
    );

    // Record where we actually bound so `duet camera` (no --port) finds us even
    // after a free-port fallback. Clean up on exit so the record never goes stale.
    writeServedPort(process.env as Record<string, string | undefined>, {
      port: boundPort,
      filePath: filePath!,
      pid: process.pid,
    });
    const cleanup = () => clearServedPort(process.env as Record<string, string | undefined>);
    process.on("exit", cleanup);
    process.on("SIGINT", () => {
      cleanup();
      process.exit(0);
    });
    process.on("SIGTERM", () => {
      cleanup();
      process.exit(0);
    });
  } else if (argv[0] === "camera") {
    // Short-lived POST client — boots no server, no watcher.
    // camera takes an op: `fit` (implemented), `zoom`/`pan` (planned).
    const op = argv[1];
    if (op === "zoom" || op === "pan") {
      process.stderr.write(`duet: camera ${op} is not implemented yet\n`);
      process.exit(1);
    }
    if (op !== "fit") {
      process.stderr.write(
        "duet: camera needs an op, e.g. `duet camera fit` (zoom, pan not implemented)\n",
      );
      process.exit(1);
    }
    const cameraArgv = argv.slice(2); // args after "camera fit"
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
