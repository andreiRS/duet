# Agent-controlled camera — fit and fit-region

Slice of the v0.2 backlog (`docs/v0.2-improvements.md`, idea #4b). Lets the
[agent](../../GLOSSARY.md) frame the [human](../../GLOSSARY.md)'s viewport
without touching the [source-of-truth file](../../GLOSSARY.md).

## Problem

The agent has no way to control what the human is looking at. After an edit it
can only hope the human's viewport already shows the changed region. There is no
"zoom to fit" and no "look at these boxes." Two forces make this hard:

1. A correct "fit" needs the browser's **real viewport size** — Excalidraw
   computes zoom from the actual canvas. The agent is eyeless and cannot guess
   it server-side without re-hitting the "no eyes" problem.
2. View state (`scroll*`/`zoom`) is deliberately kept **out** of the file and
   the appState whitelist (`writeback.ts`), because it is transient and per-tab.
   So the agent's natural channel — writing the file — is the wrong place for a
   viewport command.

**Confidence:** anecdotal
**Sources:** `docs/v0.2-improvements.md` (idea #4b; v0.1 noise-test notes that
`scroll*`/`zoom` live in appState and never persist). No telemetry; the gap was
observed in the v0.1 manual session.

## Solution

Treat a [camera command](../../GLOSSARY.md) as an **ephemeral, out-of-band**
instruction that never enters the file (ADR-0005). It flows:

```
agent → `duet camera ...` (CLI) → HTTP POST /camera → server → ws.publish → all tabs
```

The browser receives a distinct `{type:"camera"}` message on a **separate**
`applyCamera()` path that just calls `api.scrollToContent(elements, {
fitToContent: true, animate: true, duration })`. It runs none of the
content-sync machinery — no scene version re-stamp, no remote-apply guard, no
"Agent updated the canvas" flash — because no content changed. The view move is
**silent**. It also needs no save-suppression logic: the client's save-gate keys
on the element version (`sceneVersion`), and a `scrollToContent` only mutates
`scroll*`/`zoom`, so the gate already swallows it. `applyCamera()` never calls
`updateScene`, so there is nothing to guard.

The move is **animated** with a small tween — `animate: true`, `duration` 400ms
(Excalidraw's built-in ease-out; we control on/off and duration, not the curve).
We do **not** pass `maxZoom`: `fitToContent` only zooms out and caps at 100%, so
framing a single small element settles at 1:1 rather than a disorienting zoom.
The agent can request an instant jump with `--no-animate`.

Two operations:

- `duet camera fit` — frame the whole scene.
- `duet camera fit --to id,id` — frame a set of elements; the browser unions
  their bounding boxes and fits that. Addressed **by [deterministic
  id](../../GLOSSARY.md)**, never by raw coordinates, so the agent never does
  viewport math.

The **server validates** requested ids against its `currentScene` before
publishing — the only place that makes the CLI's exit code honest, since tabs
are fire-and-forget after `ws.publish`. Validation is **all-or-nothing**: if any
requested id is missing (after the retry window), nothing is published and no
tab moves, so the agent never gets a *different* viewport than it asked for. The
`framed: N` count is the size of a live `Set` of open WebSockets the server
keeps (`add` on `open`, `delete` on `close`); `ws.publish`'s byte count can't
tell one tab from five, so the set is the honest source.

The CLI gets full signal via a JSON object on stdout (`{ framed, missing? }`)
plus a branchable exit code:

- success (≥1 tab framed) → exit `0`, `{ framed: N }`.
- zero tabs connected → exit `0` with a stderr warning, `{ framed: 0 }`.
- bad request (missing ids, or empty scene on a plain `fit`) → exit `1`, 4xx,
  `{ missing: [...] }`.
- no server reachable → exit `2` with a hint.

Two failure codes so the eyeless agent can branch: `1` = "my ids/scene are
wrong, fix and retry" vs `2` = "no server, start one or give up."

**Write-then-frame race:** the agent's common flow is write the file, then
immediately `fit --to <new-id>`. The server's `currentScene` updates only after
file → watcher → parse, which is async. So on a missing id the server **polls
`currentScene`** (the watcher's value, not a direct file re-read) every ~50ms up
to a **400ms** ceiling before failing; the watcher almost always lands in that
window, so the just-written id resolves, while a genuinely bad id still fails
after it. Polling `currentScene` (rather than re-reading the file in the camera
handler) reuses the watcher pipeline, including its "keep last good scene on a
malformed/partial read" safety, and validates against exactly what tabs are
converging to.

**Dispatch:** `duet camera …` is a subcommand branched in `cli.ts`
(`argv[2] === "camera"`). Unlike `duet <file>`, it boots no server and no
watcher — it is a short-lived client that POSTs to `localhost:${port}` and
exits. Port resolves `--port` flag → `DUET_PORT` env → `3737` default, the same
precedence the server uses, so a human who moved the server passes the same
override. A refused connection is the exit-`2` case.

All tabs follow a camera command (one broadcast, no per-tab targeting), matching
"the agent is framing the work for whoever is watching."

## Scope

### In scope

- As the agent, I can run `duet camera fit` and every connected tab zooms to fit
  the whole scene, computed from each tab's real canvas size.
- As the agent, I can run `duet camera fit --to id,id` and every tab frames the
  union of those elements' bounding boxes.
- As the agent, I get an honest exit code and message: server down (`2`), tabs
  framed (`0`), zero tabs connected (`0` + warning), or unknown/empty ids (`1`) —
  plus a `{ framed, missing? }` JSON object on stdout — so I can branch without
  eyes.
- As the agent, I can frame an element I just wrote without a race failure,
  because the server briefly polls `currentScene` before failing id validation.
- As the agent, my framed set is all-or-nothing: if I name any id that doesn't
  exist, no tab moves and I get told which id was missing, so I never land a tab
  on a viewport I didn't ask for.
- As the human, the view tweens to the new frame (~400ms) instead of jumping, so
  I keep my bearings; the agent can opt into an instant jump with `--no-animate`.

### Out of scope

- **Pan and absolute zoom** (`pan x y` / `zoom <factor>`) — raw viewport math
  the eyeless agent shouldn't do yet; revisit once the snapshot loop (idea #2)
  gives it eyes.
- **Region by raw bbox** (`--region x,y,w,h`) — ids only for this slice.
- **Per-tab follow control** (a "follow agent camera" toggle) — all tabs follow.
- **A visual cue / toast** on view move — deliberately silent (the tween is the
  only feedback).
- **Per-call animation tuning beyond `--no-animate`** (`--duration`, easing
  choice) — duration is a fixed default we tweak in testing, not a CLI flag;
  Excalidraw owns the easing curve.
- **Headless/Playwright test of the browser move** — `applyCamera` is
  manual-tested; only the server contract is unit-tested (see Success Criteria).
  Revisit when the snapshot loop (idea #2) brings a headless renderer.
- **Camera state in the file** — out of band by design (ADR-0005); the whitelist
  exclusion of `scroll*`/`zoom` stands.
- **Multi-server / port discovery** — one server at a time on a fixed default
  port (see Constraints).

## Success Criteria

- With a tab open, `duet camera fit` zooms that tab to frame all elements; the
  file on disk is byte-for-byte unchanged afterward.
- `duet camera fit --to a,b` frames exactly the union of `a` and `b`; other tabs
  move identically.
- `duet camera fit` with no server running exits non-zero and names the cause;
  with a server but zero tabs it exits zero with a "0 tabs" warning.
- `duet camera fit --to bogus` exits `1` and reports `bogus` as missing, and no
  tab moves.
- `duet camera fit --to good,bogus` (one valid, one missing) also exits `1` and
  moves no tab — all-or-nothing, never a partial frame.
- `duet camera fit` on an empty scene exits `1` ("nothing to frame") and no tab
  moves.
- Writing a new element then immediately framing it by id succeeds (the ~400ms
  poll of `currentScene` absorbs the watcher lag).
- The view move is animated by default and instant under `--no-animate`.
- The **server contract** is covered by `bun:test`: id validation against
  `currentScene`, all-or-nothing rejection with the missing list, empty-scene
  rejection, the `framed` count from the live client set (incl. zero tabs), and
  the poll-on-missing window. The browser `applyCamera` move and the
  byte-identical-file guarantee are verified by a documented manual check.

## Constraints

- **Camera never writes the file** (ADR-0005). The file stays the source of
  truth for content only.
- **Server and CLI share a fixed default port `3737`** (override via
  `DUET_PORT`/`--port`), consistent across `server.ts`, `cli.ts`, and this
  feature. One server at a time.
- **Sync invariants must not regress** (CLAUDE.md): the camera message must not
  trip the echo guard, bump scene version, or flash — it is not a content path.
- The fit is computed in the **browser** (`api.scrollToContent`), never
  server-side; the server only validates ids and fans out.
- The server tracks open tabs with a live `Set` of WebSockets so `framed: N` is
  honest; `ws.publish`'s byte count is not a tab count.
- `duet camera …` boots no server/watcher — it is a short-lived POST client.
  Port precedence (`--port` → `DUET_PORT` → `3737`) matches the server's.

## Open Questions / Risks

- **`currentScene` vs a tab's actual scene divergence.** Server validation
  assumes its `currentScene` matches what each tab renders. They are eventually
  consistent, but a tab mid-update could briefly differ; accepted as low-risk
  for this slice.
- **All-tabs-follow can yank a focused human.** If two humans view different
  regions, a camera command moves both. Accepted given Duet's usual one-human
  shape; revisit with per-tab follow if it bites.
- **Poll-window ceiling.** Set at 400ms (50ms interval). Too short reintroduces
  the write-then-frame race; too long delays a real bad-id error. Tune against
  the watcher's observed latency in testing.
- **`maxZoom` cap.** ✅ Resolved in #24 (attended canvas test). Kept the 100%
  cap: the browser relies on `scrollToContent({ fitToContent: true })`, which
  only zooms *out*, and we deliberately do **not** pass `maxZoom`. Framing a
  single small element at 1:1 felt fine on the canvas, so no `maxZoom` knob was
  added. Revisit only if a small-element fit feels too small in practice.
- **Tween duration.** ✅ Resolved in #24: **400ms** (300ms felt a touch fast).
  Set in both `CAMERA_FIT_DURATION_MS` (cli.ts, what the CLI sends) and
  `CAMERA_DEFAULT_DURATION_MS` (camera.ts, the non-CLI fallback).
