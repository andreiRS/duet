# Duet

![How Duet works](https://i.ibb.co/99DMKd3G/duet-how-it-works-v2.png)

**v0.1** — first working version.

Build one Excalidraw diagram together with an AI agent. The agent drafts the
structure (ids, geometry, layout) by editing a plain `.excalidraw` file with its
normal file tools; you nudge the visuals in the browser. Both sides see each
other's changes live, no click, no copy-paste. The file is the single source of
truth and Duet keeps it in sync both ways, so a terminal agent that can't see a
canvas and a human who won't hand-edit JSON can finally work on the same picture.

## Run

```sh
bun install
bun run duet new path/to/scene.excalidraw     # scaffold a blank scene (skip if you have one)
bun run duet serve path/to/scene.excalidraw   # start the server + open the browser
```

`serve` opens http://localhost:3737 in your browser. Open more tabs at the same
URL, they all stay in sync. `serve` errors if the file is missing, so a typo
fails loudly instead of serving a blank canvas, create it with `new` first.

## How it works

```
agent  --writes-->  scene.excalidraw  --fs.watch-->  server  --WS-->  browser tabs
browser  --WS "save"-->  server  --atomic write-->  scene.excalidraw  (agent reads)
```

- **File is the source of truth.** Agent and browser both go through it.
- **Atomic writes** (temp-file + rename) so a half-written file is never served.
- **Echo guard** stops a browser save from bouncing back to the tab that made it,
  while still fanning out to the other tabs.
- **Source tagging** lets the client flash "Agent updated the canvas" only on
  agent edits, not on your own.

## Camera — the agent points your view

When the agent changes the scene it can also pull your view to the change, so you
never hunt for what just happened. The agent runs:

```sh
duet camera fit                 # frame the whole scene
duet camera fit --to id1,id2    # frame just these elements
duet camera fit --no-animate    # jump instead of a smooth move
```

Your view tweens (~400ms) to the new frame, and every open tab moves the same
way. It is **view only**: the camera never writes the file (ADR-0005), so your
scene bytes don't change and there's no "agent updated" flash. If the agent asks
for an element id that isn't there, nothing moves and it's told which id was
missing, so your view never lands somewhere you didn't expect.

## Develop

```sh
bun test          # full suite
bun run dev       # Vite dev server for the client only (no file sync)
bun run build     # build the client into dist/
```

Note: `bun run dev` serves only the React client through Vite, the WebSocket
file-sync server is not running, so use `bun run duet serve` to test sync.

## Layout

| File | Role |
|---|---|
| `src/cli.ts` | entry point, wires server + file watcher (`bootstrap`) |
| `src/server.ts` | Bun HTTP + WebSocket server, serves `dist/`, broadcasts scenes |
| `src/watch.ts` | watches the file, parses, keeps last-good on malformed writes |
| `src/writeback.ts` | atomic write, appState whitelist, echo guard |
| `src/camera.ts` | pure resolver for `camera fit` (view path, never touches the file) |
| `src/App.tsx` | Excalidraw client, applies remote scenes, sends saves |
| `src/authoring.ts` | scene-building helpers for agent edits |

More design notes live in `docs/`.
