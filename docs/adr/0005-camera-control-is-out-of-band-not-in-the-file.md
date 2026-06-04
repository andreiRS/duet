# ADR-0005: Camera control is an out-of-band command, not scene-file state

**Status:** Accepted
**Date:** 2026-06-04

## Context

v0.2 wants the agent to frame the canvas for the human: "zoom to fit" after an
edit, or "frame these boxes." The agent has no eyes, so a fit must be computed
from the browser's real viewport size, not guessed server-side.

ADR-0001 made the shared `.excalidraw` file the *only* interface, and the
`APP_STATE_WHITELIST` (`writeback.ts`) deliberately keeps `scroll*`/`zoom` out
of the file because view state is transient and per-tab. Camera control sits
exactly on that fault line, which forces a real decision.

The genuine alternatives:

- **In the file, as element/appState data.** A `cameraUpdate` pseudo-element in
  the `elements` array (the Excalidraw MCP's approach), or `scrollX/scrollY/zoom`
  added to the appState whitelist. The agent keeps a single write-the-file
  mechanism. But it writes a "do this once" *verb* into a "this is what *is*"
  document: the command then needs echo-guard handling to stop it re-firing,
  write-back stripping to stop it accumulating, and per-tab divergence handling
  because view is not shared state. All of that complexity is a symptom of
  putting an imperative command in the source-of-truth file. It also cannot
  express "fit to content," which needs the browser's viewport.
- **Out of band, via the CLI and the running server.** A camera command never
  touches the file. It flows `agent -> CLI -> HTTP POST -> server -> ws.publish
  -> tabs`, where the browser computes the fit with `api.scrollToContent`.

## Decision

We will treat camera control as an **ephemeral, out-of-band command that never
enters the scene file.** `duet camera fit [--to id,id]` does an HTTP `POST
/camera` to the already-running server (fixed default port `3737`); the server
validates the ids against its `currentScene`, then `ws.publish`es a distinct
`{type:"camera"}` message to all tabs. The browser handles it on a separate
`applyCamera()` path that calls `api.scrollToContent(...)` and does **not** run
the content-sync machinery (no version re-stamp, no remote-apply guard, no
flash). The file stays the pure source of truth for content only.

This does **not** supersede ADR-0001. The file remains the only interface for
durable *content/state*. This carves a narrow second channel for *imperative
view commands*, which are by definition not content and must not be durable.

## Consequences

- **Easier:** the file stays clean. No echo-guard, write-back-stripping, or
  pseudo-element-stripping logic for a thing that was never content. The
  `scroll*`/`zoom` whitelist exclusion stands unchallenged.
- **Easier:** "fit" is computed where the viewport actually exists (the
  browser). The agent never does viewport math, which is the "no eyes" problem
  ADR-0003 also dodges.
- **Easier:** the CLI gets an honest exit code. The server validates ids against
  `currentScene` before publishing, so missing ids / no tabs / no server are
  reported synchronously over HTTP, before any tab moves.
- **Harder / accepted cost:** the agent now has *two* mechanisms — file writes
  for content, a CLI command for camera — instead of ADR-0001's single
  write-the-file model. We accept this because the project is already moving to a
  CLI/core (v0.2 ideas #1, #8), and camera genuinely is a different kind of
  operation.
- **Accepted cost:** a camera command only works while the server is up and a tab
  is connected; unlike a file write, it does nothing on its own. The exit-code
  signal makes that visible to the agent rather than silent.
- **Accepted cost:** an inherent async gap between an agent's file write and an
  immediately-following `fit --to <new-id>` (the watcher may not have updated
  `currentScene` yet). The server absorbs it by briefly retrying id-validation
  (~300-500ms) before failing, rather than pushing the timing footgun onto the
  eyeless agent.
