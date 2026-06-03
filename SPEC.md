# Duet

A local web app where a human and an AI agent co-edit one Excalidraw diagram through a shared `.excalidraw` JSON file, with zero-click live handoff both ways. Two editors, one canvas, taking turns.

## Problem

We want an AI agent (Claude Code in a terminal) and a human to build the same Excalidraw diagram together, each doing what they're good at: the agent owns structure (ids, geometry, correctness), the human owns taste (the final visual nudge). Today neither side can both edit and see the same diagram with low friction:

- An agent in the terminal **cannot see a rendered canvas**. It can only read and write JSON.
- A human **cannot comfortably hand-tune positions in JSON** (drag a box, move a label).
- `excalidraw.com` is **end-to-end encrypted** (key in the URL fragment), so an agent can never read back what the human edited there.
- The Excalidraw MCP `export_to_excalidraw` path **silently drops labels** and bare text.

So the loop "agent drafts → human refines → agent continues → repeat until the human is satisfied" has no low-friction medium. Duet is that medium: one shared local file plus a live bridge.

**Confidence:** anecdotal
**Sources:** prior attempts to make Claude Code draw Excalidraw diagrams hit each wall above; the label-drop bug and the encryption barrier were observed directly.

## Solution

One artifact, one `.excalidraw` JSON file, is the single source of truth. Not two synced copies. A tiny local **bun** server (Duet) bridges that file to a browser:

1. It serves the official `@excalidraw/excalidraw` React component in a browser tab.
2. It **watches** the file. When the agent writes it, Duet pushes the new scene to the browser over a websocket and the canvas updates **with no click**.
3. On human edit (the component's `onChange`, debounced), Duet writes the scene **back to the same file**.

Duet never talks to the agent. The agent uses its normal file read/write tools on the same path; **the file changing is the only handoff signal**, both directions. This keeps the two sides fully decoupled: no protocol, no merge logic, no turn-state machine.

Two design pillars make the round-trip safe:

- **Stable element ids.** Every element the agent authors gets a deterministic id (a box `api`, its label `api_t`, an arrow `a1`). Excalidraw preserves element ids and bound-text bindings across an edit round-trip, so when control returns the agent matches elements by id and diffs the geometry/text fields (never `version`/`versionNonce`). Human nudges survive the next programmatic edit because the agent patches **by id**.
- **Geometry check replaces the agent's eyes.** The agent does not render. Before every write it runs a pure-geometry check (label wider than box, box overlap, arrow endpoint misses target edge, off-canvas, spacing < 20px). Mechanical violations it auto-fixes; structural ones it rethinks. It never hands over a scene with a known violation. The human is the only viewer.

We deliberately **dropped "agent views"** (no rendering in the loop) and **strict alternation** (one side edits at a time), which removes the only slow step and all conflict logic.

## Scope

### In scope

- As a developer, I can run `duet ./scene.excalidraw`; if the file is missing Duet creates an empty valid scene and opens the browser tab.
- As an agent, I can write/patch the `.excalidraw` file directly with my own file tools and have the browser canvas update live, with no click and no call to Duet.
- As a human, I can drag, retype, and draw in the browser, and have my changes written back to the same file (debounced ~300–500ms, gated on scene version so mouse-move noise never writes).
- As an agent, I can match elements by deterministic id and diff geometry/text to tell what the human moved, retyped, added, or deleted, and patch by id so human nudges survive.
- As an agent, I can adopt human-drawn elements (which arrive with random ids): I keep them as-is, may reposition them for geometry, and never rewrite their content.
- As an agent, I can run a geometry check before every write that blocks handoff on a known violation, auto-fixing mechanical issues and rethinking structural ones.
- As a human, I see an **"Agent updated the canvas"** flash whenever an external change arrives, so I know the agent is working.
- As a human, I can open/refresh a tab or wake my laptop and get the current scene immediately (replay on connect); multiple tabs all stay live.
- The system runs **fully offline**: the Excalidraw component is bundled locally with Vite, fonts copied locally and `EXCALIDRAW_ASSET_PATH` set; no CDN at runtime.

### Out of scope

- **Agent rendering / "agent views"** — the agent works from JSON + geometry check only.
- **Checkpoints / persistent diff baseline** — v1 relies on the agent's context plus stable ids. (v2.)
- **Live element-by-element streaming** and **highlight-what-changed** — v1 ships only the post-hoc "updated" flash. (v2.)
- **Simultaneous editing / merge / conflict resolution / turn-locking** — strict alternation by convention; last-writer-wins.
- **excalidraw.com, any export step, any encryption path** — all local.
- **Embedded image files** in the scene — not handled in v1.
- **Three extra geometry checks** (text overflow within a box, arrow crossing an unrelated box, neighbor label collision) — v2 candidates.
- **Rebuilding the `to-excalidraw` skill** around Duet — follows once Duet works.

## Success Criteria

- Agent writes the file → the browser canvas reflects it within a moment, no click.
- Human nudges a box → the file is updated, and on the agent's next read the change is visible as a clean id-matched diff (only the fields the human touched differ).
- A human nudge survives a subsequent agent patch: the moved/renamed element keeps the human's value.
- A human-drawn shape (random id) is preserved verbatim across agent turns.
- The agent never hands over a scene that fails the geometry check.
- Duet's own write-back never re-triggers a push (echo guard holds).
- A malformed/partial file read leaves the last good scene on screen; the next valid write recovers.
- The whole loop runs with the network off.

## Constraints

- **bun** runtime, minimal server; `Bun.serve` native for static + websocket pub/sub (no hono, no ws lib).
- `@excalidraw/excalidraw` 0.18.1, React 19, Vite 8 local bundle, chokidar 4 for file watch.
- Diff on `id` + geometry/text fields only — **never** on `version`/`versionNonce`.
- Write-back contains `elements` + a whitelisted persistent `appState` slice (background, grid, theme); drop scroll/zoom/selection/pointer/collaborators. Atomic write (tmp + rename).
- Echo guard = content-hash self-write guard (compare hash of bytes Duet just wrote; ignore the matching watcher event). Combine with `getSceneVersion` gate on the browser side.
- Offline is a hard bar: fonts served locally, `EXCALIDRAW_ASSET_PATH` set before the component mounts.

## Open Questions / Risks

- **Write/read echo loop** is the most likely thing to break (disk write → watcher → push → onChange → disk write). Mitigated by the content-hash guard + version gate, but budget real testing here.
- **`appState` round-trip pollution** — passing raw on-disk `appState` into `initialData` can crash (read-only `initialData` bug) or cause spurious diffs. Mitigated by whitelisting persistent fields and cloning.
- **`updateScene` arg shape** in 0.18 (`{ elements, appState, captureUpdate }`) not deep-verified; confirm before wiring live updates.
- **Stable-id diff contract** is load-bearing and hard to reverse. Worth recording as an ADR (see hand-off below).
- Pin versions at install time (`bun pm view @excalidraw/excalidraw version`); a patch may have landed past 0.18.1 / vite 8 / plugin-react 6.
