# Duet — Issues

Vertical slices for the v1 build. Source: `SPEC.md`, ADRs in `docs/adr/`. All slices are **unattended** (architecture is locked in the ADRs).

Two tracks: **A** (the bridge) is a strict dependency chain; **B** (agent-side tooling) is independent and can be built in parallel.

---

## 1. Vite + React scaffold serving the Excalidraw component

**Track:** A
**Attendance:** unattended
**Blocked by:** None — can start immediately

### What to build

A Vite 8 + `@vitejs/plugin-react` app (React 19) that mounts `@excalidraw/excalidraw` 0.18.1 and renders an editable canvas in the browser. Build target `es2022` (Excalidraw uses arbitrary module namespace identifiers that fail on lower targets). `base: "./"` so the built `index.html` works regardless of serve path. Build output to `dist/`. Online font loading is acceptable at this stage — offline is the next slice.

### Acceptance criteria

- [x] `bun run build` produces a static `dist/` with hashed chunks.
- [x] Opening the built page shows an editable Excalidraw canvas. (confirmed at slice-4 `/run` checkpoint: headless Chromium loads the served bundle, full Excalidraw editor + canvas render, 0 console/page errors)
- [x] Build target is `es2022` for both `build.target` and `optimizeDeps.esbuildOptions.target`.
- [x] Pinned versions recorded in `package.json` (`bun pm view` to confirm latest at install).

---

## 2. Offline asset loading (fonts + EXCALIDRAW_ASSET_PATH)

**Track:** A
**Attendance:** unattended
**Blocked by:** #1

### What to build

Make the app run with no network at runtime. Copy `node_modules/@excalidraw/excalidraw/dist/prod/fonts` into the served static dir, and set `window.EXCALIDRAW_ASSET_PATH` to the local base **before** the component mounts (in `index.html` head). No CDN requests at runtime.

### Acceptance criteria

- [x] Fonts are served from the local `dist/`, not a CDN. (234 .woff2 across 9 families copied to dist/fonts/)
- [x] `EXCALIDRAW_ASSET_PATH` is set before the bundle loads. (inline script precedes module script in index.html)
- [x] With the network physically off, the page loads, fonts render, and no outbound requests are attempted. (confirmed at slice-4 `/run` checkpoint: headless Chromium network trace = 12 requests, all localhost, 0 external, 0 failed; hand-drawn font renders from local dist/)

---

## 3. Duet server: static serve + websocket pub/sub

**Track:** A
**Attendance:** unattended
**Blocked by:** #2

### What to build

A `Bun.serve` server (native, no hono/ws lib) that serves the built `dist/` and exposes one websocket. Use Bun's pub/sub: clients `subscribe` to a `scene` topic; the server `publish`es scene updates to all of them. On connect, immediately send the current scene (replay-on-connect) so a refreshed/woken tab is never stale. Multiple tabs all stay live.

### Acceptance criteria

- [x] Server serves the built app over HTTP. (`Bun.serve` static serve in `src/server.ts`; HTTP GET / + asset tests)
- [x] A browser tab opens a websocket and subscribes to `scene`. (native Bun pub/sub `ws.subscribe("scene")`; proven via WS test clients)
- [x] On connect, the tab receives the current scene immediately. (replay-on-connect in `websocket.open`; null + non-null replay tests)
- [x] A second tab also connects and receives updates (broadcast). (two-client broadcast test on `setScene` → `server.publish`)

---

## 4. CLI bootstrap: `duet ./scene.excalidraw`

**Track:** A
**Attendance:** unattended
**Blocked by:** #3

### What to build

A CLI entry that takes the target file path as an argument, creates it as an empty valid `.excalidraw` scene if missing, launches the server, and opens the browser tab pointed at it. One argument handles both "new diagram" and "open existing".

### Acceptance criteria

- [x] `duet ./scene.excalidraw` on a missing file creates a valid empty scene and opens the browser showing a blank canvas. (`ensureScene` + bootstrap tests; `/run` checkpoint: blank canvas renders)
- [x] `duet ./existing.excalidraw` opens the browser showing the existing scene. (`/run` checkpoint: served rect+text scene renders via WS replay → `updateScene`)
- [x] The path the agent writes to is the same path Duet serves. (bootstrap reads the file → `setScene`; `getScene` deep-equals on-disk scene test)

---

## 5. File → browser live update

**Track:** A
**Attendance:** unattended
**Blocked by:** #4

### What to build

Watch the target file with chokidar 4 (`awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 }`, `ignoreInitial: true`). On a valid change, read and parse the file and `publish` the scene; the browser applies it via `excalidrawAPI.updateScene()` (not by remounting `initialData`). If the file fails to parse (agent mid-write, broken JSON), keep the last good scene, log a warning, and don't push. Show an "Agent updated the canvas" flash in the browser on each external update.

### Acceptance criteria

- [x] Editing the file on disk updates the browser canvas with no click. (`src/watch.ts` chokidar; integration test: file write → WS broadcast; `/run` browser check: live render after edit)
- [x] Live updates use `updateScene`, preserving the canvas (no full remount flicker). (App.tsx applies `updateScene({elements, appState, captureUpdate: NEVER})` via WS, no remount; verified visually)
- [x] A malformed/partial file read leaves the last good scene on screen and logs a warning; the next valid write recovers. (watch.ts parse-guard; unit + integration tests for keep-last-good + recovery)
- [x] The "Agent updated the canvas" flash appears on each external change. (`/run` browser check: flash visible after on-disk edit, incl. atomic tmp+rename)
- Review fix-up `30cb19a`: chokidar `error` events routed to `onError` (no crash); watcher now watches the parent dir + handles `add`+`change` so **atomic tmp+rename writes are caught** (real RED test — de-risks slice 6); WS moved into a mount-once `useEffect` with cleanup (no socket leak / duplicate flash); flash timer cleared on unmount.

---

## 6. Browser → file write-back + echo guard

**Track:** A
**Attendance:** unattended
**Blocked by:** #5

### What to build

On the human's `onChange`, debounce 300–500ms and gate on `getSceneVersion` so mouse-move/hover/selection noise never writes. When the scene version actually advances, write the file atomically (tmp + rename) with `elements` + a whitelisted persistent `appState` slice (`viewBackgroundColor`, `gridSize`, theme); drop scroll/zoom/selection/pointer/collaborators and clone before use. **Echo guard:** record the content hash of the bytes Duet just wrote; in the watcher, ignore the next event whose on-disk hash matches. This is the highest-risk area (write → watch → push → onChange → write loop) — test it directly.

### Acceptance criteria

- [ ] Dragging/typing in the browser writes the change to the file after the debounce.
- [ ] Mouse-move/hover/selection alone never writes (version gate holds).
- [ ] The file contains only `elements` + whitelisted `appState`; transient state is dropped.
- [ ] Writes are atomic (no reader ever sees a half-written file).
- [ ] Duet's own write-back does **not** trigger a push back to the browser (echo guard holds) — covered by an explicit test.

---

## 7. Authoring helper: stable ids + label survival

**Track:** B
**Attendance:** unattended
**Blocked by:** None — can start immediately

### What to build

Promote `reference/excalidraw-helper.ts` into Duet as the agent's authoring library: a scene builder with deterministic ids (`api`, label `api_t`, arrow `a1`), bound-text labels (text carries `containerId`, box carries `boundElements`), arrows (multi-point + bound label), zones, and a `build()` that emits valid Excalidraw JSON. See ADR-0002 (stable ids) and the **Bound text** glossary entry.

### Acceptance criteria

- [x] A built scene is valid Excalidraw JSON that loads in the component without error.
- [x] Box labels survive as separate bound-text elements (not dropped).
- [x] Element ids are deterministic and match the documented scheme.

---

## 8. Geometry check

**Track:** B
**Attendance:** unattended
**Blocked by:** #7

### What to build

The agent's "eyes" (ADR-0003). Given a scene, run the five checks: label wider than box, box overlap, arrow endpoint misses target edge (tolerance ≤ 5px), off-canvas (outside scene bounds + margin), spacing < 20px. Auto-fix the mechanical violations (widen box to fit label, nudge off-canvas elements in-bounds, push too-close elements apart) and re-check; flag the structural ones (box overlap from bad layout, arrow missing because the target moved) for the agent to rethink. Never return "clean" while a known violation stands. Reuse the element-geometry parsing in `reference/local-renderer.ts`.

### Acceptance criteria

- [x] Each of the five checks detects its violation on a crafted bad scene.
- [x] Mechanical violations are auto-fixed and the re-check passes.
- [x] Structural violations are reported, not silently "fixed".
- [x] A scene with a known violation is never reported as passing.

---

## 9. Diff-by-id / reconciliation

**Track:** B
**Attendance:** unattended
**Blocked by:** #7

### What to build

Given a baseline scene and the current scene, classify each element by id (ADR-0002): moved (geometry changed), retyped (text changed), added (unknown/random id = human-drawn), deleted (a known id gone). Diff on `id` + `x/y/width/height/text/points` only — never on `version`/`versionNonce`. Human-drawn random-id elements are preserved as-is. Produce a patch-by-id the agent can apply so human nudges survive the next programmatic edit.

### Acceptance criteria

- [x] Moved / retyped / added / deleted are each correctly classified on a crafted before/after pair.
- [x] Diff ignores `version`/`versionNonce` changes (no false positives from no-op edits).
- [x] Elements with unknown ids are classified as human-added and preserved unchanged.
- [x] Applying the patch keeps a human's moved/renamed element at the human's value.
