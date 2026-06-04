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
fitToContent: true })`. It runs none of the content-sync machinery — no scene
version re-stamp, no remote-apply guard, no "Agent updated the canvas" flash —
because no content changed. The view move is **silent**.

Two operations:

- `duet camera fit` — frame the whole scene.
- `duet camera fit --to id,id` — frame a set of elements; the browser unions
  their bounding boxes and fits that. Addressed **by [deterministic
  id](../../GLOSSARY.md)**, never by raw coordinates, so the agent never does
  viewport math.

The **server validates** requested ids against its `currentScene` before
publishing — the only place that makes the CLI's exit code honest, since tabs
are fire-and-forget after `ws.publish`. The CLI gets full signal: no server →
non-zero exit with a hint; success → `{ framed: N }` tab count; zero tabs →
succeed with a warning; missing ids / empty scene → 4xx + the missing ids +
non-zero exit.

**Write-then-frame race:** the agent's common flow is write the file, then
immediately `fit --to <new-id>`. The server's `currentScene` updates only after
file → watcher → parse, which is async. So on a missing id the server **retries
validation for a short window (~300–500ms)** before failing; the watcher almost
always lands in that window, so the just-written id resolves, while a genuinely
bad id still fails after it.

All tabs follow a camera command (one broadcast, no per-tab targeting), matching
"the agent is framing the work for whoever is watching."

## Scope

### In scope

- As the agent, I can run `duet camera fit` and every connected tab zooms to fit
  the whole scene, computed from each tab's real canvas size.
- As the agent, I can run `duet camera fit --to id,id` and every tab frames the
  union of those elements' bounding boxes.
- As the agent, I get an honest exit code and message: server down, tabs framed,
  zero tabs connected, or unknown/empty ids — so I can branch without eyes.
- As the agent, I can frame an element I just wrote without a race failure,
  because the server briefly retries id validation.

### Out of scope

- **Pan and absolute zoom** (`pan x y` / `zoom <factor>`) — raw viewport math
  the eyeless agent shouldn't do yet; revisit once the snapshot loop (idea #2)
  gives it eyes.
- **Region by raw bbox** (`--region x,y,w,h`) — ids only for this slice.
- **Per-tab follow control** (a "follow agent camera" toggle) — all tabs follow.
- **A visual cue / toast** on view move — deliberately silent.
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
- `duet camera fit --to bogus` exits non-zero and reports `bogus` as missing,
  and no tab moves.
- Writing a new element then immediately framing it by id succeeds (the retry
  window absorbs the watcher lag).
- The camera path is covered by `bun:test`: server-side id validation against
  `currentScene`, the framed-count response, and the retry-on-missing window.

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

## Open Questions / Risks

- **`currentScene` vs a tab's actual scene divergence.** Server validation
  assumes its `currentScene` matches what each tab renders. They are eventually
  consistent, but a tab mid-update could briefly differ; accepted as low-risk
  for this slice.
- **All-tabs-follow can yank a focused human.** If two humans view different
  regions, a camera command moves both. Accepted given Duet's usual one-human
  shape; revisit with per-tab follow if it bites.
- **Retry window tuning.** ~300–500ms is a guess; too short reintroduces the
  race, too long delays a real bad-id error. Tune against the watcher's observed
  latency.
