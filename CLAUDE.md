# Duet — agent guide

**Version: 0.1** (v0.2 backlog in `docs/v0.2-improvements.md`).

Live two-way sync of one `.excalidraw` file between an AI agent and the browser.
The file is the source of truth; both sides edit it and Duet keeps every browser
tab in sync. See `README.md` for the user-facing overview.

## Commands

```sh
bun install
bun test                          # full suite (114 tests)
bun test src/server.test.ts       # one file
bun run duet ./scene.excalidraw   # run the real server (HTTP + WS + file watch)
bun run build                     # build the client into dist/
```

Use `bun`, never `npm`.

## Running the server

`bun run duet <file>` runs `src/cli.ts` directly. **Bun does not hot-reload**, so
after editing any server-side file (`server.ts`, `watch.ts`, `writeback.ts`,
`cli.ts`) you must **restart the process** for changes to take effect. The client
(`App.tsx`) is served from `dist/`, so client changes need `bun run build`.

`bun run dev` (Vite) serves only the client, the WS file-sync server is not
running there, so it cannot test sync. Always test sync through `bun run duet`.

## Architecture

- `cli.ts` `bootstrap()` — wires the server and the file watcher, sharing one
  `EchoGuard`. This is the loop.
- `server.ts` — Bun HTTP (serves `dist/`) + WebSocket. Broadcasts scenes to tabs
  on the `"scene"` topic. Handles `{type:"save"}` browser edits: atomic write +
  `ws.publish` to the other tabs.
- `watch.ts` — watches the file, parses on change, keeps the last good scene on a
  malformed/partial read, skips events caused by Duet's own writes (echo guard).
- `writeback.ts` — atomic write (temp + rename), appState whitelist, echo guard.
- `App.tsx` — Excalidraw client: applies incoming scenes, sends debounced saves,
  gates out noise (selection/pan/zoom) via scene-version.

## Sync invariants (do not regress)

- **Atomic writes** — temp-file + rename, never a bare `writeFile`.
- **Echo guard** — records the bytes Duet writes so the *watcher* skips the file
  event of our own write (no duplicate broadcast). Loop-prevention on the sender
  is the client's `isApplyingRemote` guard, NOT withholding data: a browser save
  re-reads + merges on disk and broadcasts the merged scene to **all** tabs
  including the sender (`server.publish`, not `ws.publish`), so the sender sees
  the reconciled truth (ADR-0007).
- **Agent path vs browser path** — agent edits flow file → watcher → broadcast;
  browser edits flow WS save → re-read + `mergeById` → write → `server.publish`
  (all tabs). Keep both working.
- **First-load buffer** — render existing file content immediately on connect,
  no flash on the initial load (only on later agent edits).
- **appState whitelist** is the single source of truth, shared client + server
  (`APP_STATE_WHITELIST` in `writeback.ts`). Noise keys (`scroll*`, `zoom`,
  selection) must not persist.

## Conventions

- Write tests for sync behavior (`src/*.test.ts`, `bun:test`). New sync rules get
  a test, e.g. "a browser save fans out to other clients but not the sender".
- Backlog and known issues: `docs/v0.2-improvements.md`. Design notes: `docs/`.
- Commit as the real git identity, never a "Duet" `--author` override.
