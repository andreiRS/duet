# Duet

**v0.1** — first working version. Live-sync an Excalidraw scene between an AI agent and your browser through a
single `.excalidraw` file. The agent edits the file; Duet watches it and pushes
changes to every open tab. You draw in the browser; Duet writes your edits back
to the same file so the agent sees them. One file, both directions.

## Run

```sh
bun install
bun run duet path/to/scene.excalidraw   # creates the file if missing
```

Opens http://localhost:3737 in your browser. Open more tabs at the same URL,
they all stay in sync.

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

## Develop

```sh
bun test          # full suite
bun run dev       # Vite dev server for the client only (no file sync)
bun run build     # build the client into dist/
```

Note: `bun run dev` serves only the React client through Vite, the WebSocket
file-sync server is not running, so use `bun run duet` to test sync.

## Layout

| File | Role |
|---|---|
| `src/cli.ts` | entry point, wires server + file watcher (`bootstrap`) |
| `src/server.ts` | Bun HTTP + WebSocket server, serves `dist/`, broadcasts scenes |
| `src/watch.ts` | watches the file, parses, keeps last-good on malformed writes |
| `src/writeback.ts` | atomic write, appState whitelist, echo guard |
| `src/App.tsx` | Excalidraw client, applies remote scenes, sends saves |
| `src/authoring.ts` | scene-building helpers for agent edits |

More design notes live in `docs/`.
