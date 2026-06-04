import { describe, it, expect, afterEach } from "bun:test";
import { createServer } from "./server";
import { EchoGuard } from "./writeback";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

// Helper: create a temp fixture dir with a minimal index.html and an asset
function makeFakeDistDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "duet-test-dist-"));
  fs.writeFileSync(path.join(dir, "index.html"), "<html><body>duet</body></html>");
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(dir, "assets", "app.js"), "console.log('app')");
  return dir;
}

// Helper: wait for a websocket to open
function wsOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) { resolve(); return; }
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", (e) => reject(e), { once: true });
  });
}

// Helper: wait for next message on a websocket
function nextMessage(ws: WebSocket, timeoutMs = 2000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout waiting for ws message")), timeoutMs);
    ws.addEventListener("message", (e) => {
      clearTimeout(timer);
      resolve(JSON.parse(e.data));
    }, { once: true });
  });
}

let distDir: string;
let cleanup: (() => void)[] = [];

function setup() {
  distDir = makeFakeDistDir();
  return distDir;
}

function addCleanup(fn: () => void) {
  cleanup.push(fn);
}

afterEach(async () => {
  for (const fn of cleanup) {
    try { fn(); } catch {}
  }
  cleanup = [];
  if (distDir) {
    fs.rmSync(distDir, { recursive: true, force: true });
  }
});

// ─── Behavior 1: module API ───────────────────────────────────────────────────

describe("createServer", () => {
  it("returns server, setScene, and getScene", () => {
    const dir = setup();
    const { server, setScene, getScene } = createServer({ port: 0, distDir: dir });
    addCleanup(() => server.stop(true));

    expect(typeof setScene).toBe("function");
    expect(typeof getScene).toBe("function");
    expect(server).toBeDefined();
  });
});

// ─── Behavior 3: WS connect + replay on connect (null scene) ─────────────────

describe("WebSocket replay-on-connect", () => {
  it("client receives current scene immediately on connect (null scene)", async () => {
    const dir = setup();
    const { server } = createServer({ port: 0, distDir: dir });
    addCleanup(() => server.stop(true));

    const ws = new WebSocket(`ws://localhost:${server.port}/`);
    addCleanup(() => ws.close());

    await wsOpen(ws);
    const msg = await nextMessage(ws);

    expect(msg).toEqual({ type: "scene", scene: null });
  });

  it("client receives scene set before connect (non-null replay)", async () => {
    const dir = setup();
    const { server, setScene } = createServer({ port: 0, distDir: dir });
    addCleanup(() => server.stop(true));

    const scene = { elements: [{ id: "a", type: "rectangle" }], appState: {} };
    setScene(scene);

    const ws = new WebSocket(`ws://localhost:${server.port}/`);
    addCleanup(() => ws.close());

    await wsOpen(ws);
    const msg = await nextMessage(ws);

    expect(msg).toEqual({ type: "scene", scene });
  });
});

// ─── Behavior 4: broadcast to all connected clients on setScene ──────────────

describe("WebSocket broadcast", () => {
  it("two clients both receive the broadcast when setScene is called", async () => {
    const dir = setup();
    const { server, setScene } = createServer({ port: 0, distDir: dir });
    addCleanup(() => server.stop(true));

    const wsUrl = `ws://localhost:${server.port}/`;

    const ws1 = new WebSocket(wsUrl);
    const ws2 = new WebSocket(wsUrl);
    addCleanup(() => ws1.close());
    addCleanup(() => ws2.close());

    // Wait for both to open and consume their replay messages in parallel
    await Promise.all([
      wsOpen(ws1).then(() => nextMessage(ws1)),
      wsOpen(ws2).then(() => nextMessage(ws2)),
    ]);

    // Now set a new scene — both should get the broadcast
    const scene = { elements: [{ id: "x" }], appState: { zoom: 1 } };

    const p1 = nextMessage(ws1);
    const p2 = nextMessage(ws2);
    setScene(scene);

    const [msg1, msg2] = await Promise.all([p1, p2]);

    expect(msg1).toEqual({ type: "scene", scene });
    expect(msg2).toEqual({ type: "scene", scene });
  });
});

// ─── Behavior 2: HTTP serves index.html at GET / ─────────────────────────────

describe("HTTP static serving", () => {
  it("GET / returns index.html content", async () => {
    const dir = setup();
    const { server } = createServer({ port: 0, distDir: dir });
    addCleanup(() => server.stop(true));

    const url = `http://localhost:${server.port}/`;
    const res = await fetch(url);
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text).toContain("duet");
  });

  it("GET /assets/app.js returns the static asset", async () => {
    const dir = setup();
    const { server } = createServer({ port: 0, distDir: dir });
    addCleanup(() => server.stop(true));

    const url = `http://localhost:${server.port}/assets/app.js`;
    const res = await fetch(url);
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text).toContain("console.log");
  });
});

// ─── Slice 20: POST /camera validation + fan-out ─────────────────────────────

// Helper: POST to /camera with a JSON body
function postCamera(port: number | undefined, body: unknown): Promise<Response> {
  return fetch(`http://localhost:${port}/camera`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Helper: collect all {type:"camera"} messages received after setup until
// `done` resolves. Returns the collected messages.
async function collectCameraMessages(ws: WebSocket, done: Promise<unknown>): Promise<unknown[]> {
  const msgs: unknown[] = [];
  const listener = (e: MessageEvent) => {
    const parsed = JSON.parse(e.data);
    if ((parsed as { type?: string }).type === "camera") msgs.push(parsed);
  };
  ws.addEventListener("message", listener);
  await done;
  ws.removeEventListener("message", listener);
  return msgs;
}

describe("POST /camera — fit on empty scene is rejected", () => {
  it("returns 4xx and publishes nothing when scene has no elements", async () => {
    const dir = setup();
    const { server, setScene } = createServer({ port: 0, distDir: dir });
    addCleanup(() => server.stop(true));

    // empty scene
    setScene({ elements: [], appState: {} });

    const ws = new WebSocket(`ws://localhost:${server.port}/`);
    addCleanup(() => ws.close());
    await wsOpen(ws);
    await nextMessage(ws); // consume replay

    // Register collector BEFORE the POST; await fetch to know server is done
    const collected = collectCameraMessages(ws, postCamera(server.port, { op: "fit" }));
    const res = await postCamera(server.port, { op: "fit" });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await collected).toHaveLength(0);
  });
});

describe("POST /camera — fit with empty to array is rejected", () => {
  it("returns 422 and publishes no camera message when to:[] (nothing to frame)", async () => {
    const dir = setup();
    const { server, setScene } = createServer({ port: 0, distDir: dir });
    addCleanup(() => server.stop(true));

    setScene({ elements: [{ id: "a" }], appState: {} });

    const ws = new WebSocket(`ws://localhost:${server.port}/`);
    addCleanup(() => ws.close());
    await wsOpen(ws);
    await nextMessage(ws); // consume replay

    const collected = collectCameraMessages(ws, postCamera(server.port, { op: "fit", to: [] }));
    const res = await postCamera(server.port, { op: "fit", to: [] });

    expect(res.status).toBe(422);
    expect(await collected).toHaveLength(0);
  });
});

describe("POST /camera — fit with non-string to items is rejected", () => {
  it("returns 400 and publishes no camera message when to contains non-strings", async () => {
    const dir = setup();
    const { server, setScene } = createServer({ port: 0, distDir: dir });
    addCleanup(() => server.stop(true));

    setScene({ elements: [{ id: "a" }], appState: {} });

    const ws = new WebSocket(`ws://localhost:${server.port}/`);
    addCleanup(() => ws.close());
    await wsOpen(ws);
    await nextMessage(ws); // consume replay

    const collected = collectCameraMessages(ws, postCamera(server.port, { op: "fit", to: [1, 2] }));
    const res = await postCamera(server.port, { op: "fit", to: [1, 2] });

    expect(res.status).toBe(400);
    expect(await collected).toHaveLength(0);
  });
});

describe("POST /camera — fit with --to (all ids present)", () => {
  it("publishes {type:'camera', ids:[...]} and returns 200 {framed:N}", async () => {
    const dir = setup();
    const { server, setScene } = createServer({ port: 0, distDir: dir });
    addCleanup(() => server.stop(true));

    setScene({ elements: [{ id: "a" }, { id: "b" }], appState: {} });

    const ws = new WebSocket(`ws://localhost:${server.port}/`);
    addCleanup(() => ws.close());
    await wsOpen(ws);
    await nextMessage(ws); // consume replay

    const cameraMsg = nextMessage(ws);

    const res = await postCamera(server.port, { op: "fit", to: ["a"] });
    const body = await res.json() as { framed: number };

    expect(res.status).toBe(200);
    expect(body.framed).toBe(1);

    const msg = await cameraMsg as { type: string; op: string; ids: string[] };
    expect(msg.type).toBe("camera");
    expect(msg.op).toBe("fit");
    expect(msg.ids).toEqual(["a"]);
  });
});

describe("POST /camera — fit with --to (missing ids)", () => {
  it("returns 4xx {missing:[...]} and publishes nothing (all-or-nothing)", async () => {
    const dir = setup();
    const { server, setScene } = createServer({ port: 0, distDir: dir });
    addCleanup(() => server.stop(true));

    setScene({ elements: [{ id: "a" }], appState: {} });

    const ws = new WebSocket(`ws://localhost:${server.port}/`);
    addCleanup(() => ws.close());
    await wsOpen(ws);
    await nextMessage(ws); // consume replay

    // Register collector BEFORE the POST; await fetch to know server is done
    const collected = collectCameraMessages(ws, postCamera(server.port, { op: "fit", to: ["a", "nonexistent"] }));
    const res = await postCamera(server.port, { op: "fit", to: ["a", "nonexistent"] });
    const body = await res.json() as { missing: string[] };

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(body.missing).toEqual(["nonexistent"]);
    expect(await collected).toHaveLength(0);
  });
});

describe("POST /camera — animate and duration are forwarded into the published message", () => {
  it("published camera message includes animate:false and duration:0 when sent", async () => {
    const dir = setup();
    const { server, setScene } = createServer({ port: 0, distDir: dir });
    addCleanup(() => server.stop(true));

    setScene({ elements: [{ id: "a" }], appState: {} });

    const ws = new WebSocket(`ws://localhost:${server.port}/`);
    addCleanup(() => ws.close());
    await wsOpen(ws);
    await nextMessage(ws); // consume replay

    const cameraMsg = nextMessage(ws);
    const res = await postCamera(server.port, { op: "fit", animate: false, duration: 0 });

    expect(res.status).toBe(200);
    const msg = await cameraMsg as { type: string; animate: boolean; duration: number };
    expect(msg.type).toBe("camera");
    expect(msg.animate).toBe(false);
    expect(msg.duration).toBe(0);
  });
});

describe("POST /camera — framed reflects live client count", () => {
  it("framed drops after a tab disconnects", async () => {
    const dir = setup();
    const { server, setScene } = createServer({ port: 0, distDir: dir });
    addCleanup(() => server.stop(true));

    setScene({ elements: [{ id: "a" }], appState: {} });

    const ws = new WebSocket(`ws://localhost:${server.port}/`);
    addCleanup(() => ws.close());
    await wsOpen(ws);
    await nextMessage(ws); // consume replay

    // One tab connected → framed should be 1
    const res1 = await postCamera(server.port, { op: "fit" });
    expect((await res1.json() as { framed: number }).framed).toBe(1);

    // Close the tab and wait for the server to process the close
    ws.close();
    await new Promise((r) => setTimeout(r, 50));

    // Zero tabs → framed should be 0
    const res2 = await postCamera(server.port, { op: "fit" });
    expect((await res2.json() as { framed: number }).framed).toBe(0);
  });
});

describe("POST /camera — zero connected tabs", () => {
  it("returns 200 {framed:0} when no WebSocket clients are connected", async () => {
    const dir = setup();
    const { server, setScene } = createServer({ port: 0, distDir: dir });
    addCleanup(() => server.stop(true));

    setScene({ elements: [{ id: "a" }], appState: {} });

    // No WS clients connected at all
    const res = await postCamera(server.port, { op: "fit" });
    const body = await res.json() as { framed: number };

    expect(res.status).toBe(200);
    expect(body.framed).toBe(0);
  });
});

describe("POST /camera — basic fit on non-empty scene", () => {
  it("returns 200 {framed:N} and publishes {type:'camera'} to connected tabs", async () => {
    const dir = setup();
    const { server, setScene } = createServer({ port: 0, distDir: dir });
    addCleanup(() => server.stop(true));

    setScene({ elements: [{ id: "a", type: "rectangle" }], appState: {} });

    const ws = new WebSocket(`ws://localhost:${server.port}/`);
    addCleanup(() => ws.close());
    await wsOpen(ws);
    await nextMessage(ws); // consume replay

    const cameraMsg = nextMessage(ws);

    const res = await postCamera(server.port, { op: "fit" });
    const body = await res.json() as { framed: number };

    expect(res.status).toBe(200);
    expect(body.framed).toBe(1);

    const msg = await cameraMsg as { type: string; op: string };
    expect(msg.type).toBe("camera");
    expect(msg.op).toBe("fit");
  });
});

// ─── Slice 6: browser → file write-back via {type:"save"} WS message ─────────

let sceneDir: string;
function makeSceneFile(): string {
  sceneDir = fs.mkdtempSync(path.join(os.tmpdir(), "duet-save-test-"));
  const filePath = path.join(sceneDir, "scene.excalidraw");
  fs.writeFileSync(filePath, JSON.stringify({ type: "excalidraw", elements: [], appState: {} }), "utf8");
  addCleanup(() => fs.rmSync(sceneDir, { recursive: true, force: true }));
  return filePath;
}

describe("browser → file write-back (save message)", () => {
  it("a {type:'save'} message writes the elements to the scene file", async () => {
    const dir = setup();
    const filePath = makeSceneFile();
    const { server } = createServer({ port: 0, distDir: dir, filePath, echoGuard: new EchoGuard() });
    addCleanup(() => server.stop(true));

    const ws = new WebSocket(`ws://localhost:${server.port}/`);
    addCleanup(() => ws.close());
    await wsOpen(ws);
    await nextMessage(ws); // consume replay

    const elements = [{ id: "drawn", type: "rectangle" }];
    ws.send(JSON.stringify({ type: "save", elements, appState: { viewBackgroundColor: "#eee", scrollX: 5 } }));

    // Poll the file until the write lands (no fixed-sleep race on a positive assertion).
    let onDisk: any;
    for (let i = 0; i < 100; i++) {
      const raw = fs.readFileSync(filePath, "utf8");
      onDisk = JSON.parse(raw);
      if (onDisk.elements.length > 0) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(onDisk.elements).toEqual(elements);
    // whitelist held: viewBackgroundColor kept, scrollX dropped
    expect(onDisk.appState).toEqual({ viewBackgroundColor: "#eee" });
    expect(onDisk.files).toEqual({});
    // atomic: no lingering tmp
    expect(fs.readdirSync(sceneDir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("reconciles a stale browser save against a concurrent agent write (reverse race, #17)", async () => {
    const dir = setup();
    const filePath = makeSceneFile();
    const { server } = createServer({ port: 0, distDir: dir, filePath, echoGuard: new EchoGuard() });
    addCleanup(() => server.stop(true));

    // The agent wrote [base, A_agent] to the file. The browser's debounced save
    // was captured BEFORE A_agent existed, so it only knows [base, H_human].
    const base = { id: "base", type: "rectangle", version: 1, versionNonce: 1 };
    const aAgent = { id: "A_agent", type: "ellipse", version: 1, versionNonce: 1 };
    fs.writeFileSync(
      filePath,
      JSON.stringify({ type: "excalidraw", elements: [base, aAgent], appState: {} }),
      "utf8",
    );

    const ws = new WebSocket(`ws://localhost:${server.port}/`);
    addCleanup(() => ws.close());
    await wsOpen(ws);
    await nextMessage(ws); // consume replay

    const hHuman = { id: "H_human", type: "diamond", version: 2, versionNonce: 7 };
    ws.send(JSON.stringify({ type: "save", elements: [base, hHuman], appState: {} }));

    // Poll the file until the human's element lands.
    let onDisk: any;
    for (let i = 0; i < 100; i++) {
      onDisk = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (onDisk.elements.some((e: any) => e.id === "H_human")) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    const ids = onDisk.elements.map((e: any) => e.id);
    expect(ids).toContain("base"); // shared id, unchanged
    expect(ids).toContain("A_agent"); // agent's concurrent write SURVIVED
    expect(ids).toContain("H_human"); // browser's new element APPLIED
  });

  it("the merged broadcast carries the agent's concurrent element the sender never sent (ADR-0007)", async () => {
    const dir = setup();
    const filePath = makeSceneFile();
    const { server } = createServer({ port: 0, distDir: dir, filePath, echoGuard: new EchoGuard() });
    addCleanup(() => server.stop(true));

    // The agent wrote [base, A_agent] to disk during the browser's debounce
    // window. The browser's stale save only knows [base, H_human].
    const base = { id: "base", type: "rectangle", version: 1, versionNonce: 1 };
    const aAgent = { id: "A_agent", type: "ellipse", version: 1, versionNonce: 1 };
    fs.writeFileSync(
      filePath,
      JSON.stringify({ type: "excalidraw", elements: [base, aAgent], appState: {} }),
      "utf8",
    );

    const ws = new WebSocket(`ws://localhost:${server.port}/`);
    addCleanup(() => ws.close());
    await wsOpen(ws);
    await nextMessage(ws); // consume replay

    const hHuman = { id: "H_human", type: "diamond", version: 2, versionNonce: 7 };

    // ADR-0007 central claim: the sender does NOT just see its own snapshot
    // echoed back — it receives the reconciled truth OVER THE WIRE, including
    // the agent's concurrent element it never sent.
    const senderMsg = nextMessage(ws);
    ws.send(JSON.stringify({ type: "save", elements: [base, hHuman], appState: {} }));

    const msg = (await senderMsg) as { type: string; scene: { elements: { id: string }[] } };
    expect(msg.type).toBe("scene");
    const ids = msg.scene.elements.map((e) => e.id);
    expect(ids).toContain("A_agent"); // reconciled agent element the sender never sent
    expect(ids).toContain("H_human"); // sender's own new element
  });

  it("a browser save broadcasts the merged scene to ALL tabs including the sender (B1, #17)", async () => {
    const dir = setup();
    const filePath = makeSceneFile();
    const { server } = createServer({ port: 0, distDir: dir, filePath, echoGuard: new EchoGuard() });
    addCleanup(() => server.stop(true));

    const wsUrl = `ws://localhost:${server.port}/`;
    const sender = new WebSocket(wsUrl); // tab A — makes the edit
    const other = new WebSocket(wsUrl);  // tab B — should receive it live
    addCleanup(() => sender.close());
    addCleanup(() => other.close());

    // Open both and consume their replay-on-connect messages.
    await Promise.all([
      wsOpen(sender).then(() => nextMessage(sender)),
      wsOpen(other).then(() => nextMessage(other)),
    ]);

    const elements = [{ id: "drawn", type: "rectangle" }];

    // ADR-0007: the merged scene reaches EVERY tab, the sender included, because
    // the merge can differ from what the sender sent. The client's
    // isApplyingRemote guard prevents a save-loop (server side: a single
    // broadcast, not a storm).
    const otherMsg = nextMessage(other);
    const senderMsg = nextMessage(sender);

    sender.send(JSON.stringify({ type: "save", elements, appState: {} }));

    const oMsg = (await otherMsg) as { type: string; scene: { elements: unknown[] } };
    const sMsg = (await senderMsg) as { type: string; scene: { elements: unknown[] } };
    expect(oMsg.type).toBe("scene");
    expect(oMsg.scene.elements).toEqual(elements);
    // The sender ALSO receives the broadcast, with the merged result.
    expect(sMsg.type).toBe("scene");
    expect(sMsg.scene.elements).toEqual(elements);

    // No storm: after the single broadcast the sender stays quiet (one message,
    // not an infinite loop).
    const secondBounce = nextMessage(sender, 300).then(() => "stormed").catch(() => "quiet");
    expect(await secondBounce).toBe("quiet");
  });
});
