# Agent edit core — bindings, checkpoint, query

Scope-limited slice of the v0.2 backlog (`docs/v0.2-improvements.md`). Covers three
capabilities only. Deliberately *not* the full "scene-edit core" rewrite, and
deliberately *not* agent-facing rendering (ADR-0003 stands).

## Problem

The [agent](../../GLOSSARY.md) edits the [source-of-truth file](../../GLOSSARY.md)
through ad-hoc `bun -e` scripts (see the appendix in `docs/v0.2-improvements.md`).
Three concrete gaps, all observed in v0.1 testing:

1. **Arrows stab through boxes.** `authoring.ts` `arrow()` hard-codes
   `startBinding`/`endBinding` to `null`, so arrows are drawn center-to-center and
   their heads land *inside* the target box instead of on its border.
2. **The agent can't tell its own edits from the human's, and can't roll back.**
   After losing context (a long session, compaction, a fresh session) the agent has
   no saved reference point: it cannot reliably diff what the human changed since its
   last edit, and it cannot undo an edit that went wrong. We saw that without a saved
   reference the agent struggles to understand what changed from one version of the
   file to the next.
3. **Editing an existing scene re-derives everything.** To change one element the
   script re-reads the file, hand-finds elements, and redoes bbox math inline,
   because there is no load/query path.

**Confidence:** anecdotal
**Sources:** `docs/v0.2-improvements.md` (ideas #3, #5/#6, #7; appendix) and the v0.1
manual test session (2026-06-03). All three gaps were observed in that session.

## Solution

Keep the agent computing coordinates by hand. Placement was never the hard part;
**bindings, round-trip safety, and surgical editing** are. Extend the existing
authoring/write-back code with three capabilities:

1. **Real arrow bindings.** Write `startBinding`/`endBinding` (with `elementId` and a
   normalized `fixedPoint`) into the arrow JSON. The binding helper **auto-picks the
   nearest facing edge** of each box from the two boxes' relative positions — pure
   geometry, the agent's job — so the agent names two boxes and gets a sensible side,
   not a guess. The **browser tab — the live Excalidraw engine** — then clips the
   arrow to the box border and reroutes it on move/load.
2. **Checkpoint** (scene-*state*, not an image). One [checkpoint](../../GLOSSARY.md)
   is a saved copy of the scene on disk at a chosen moment. Diff and restore are two
   reads of that one saved state:
   - **diff** the current file against a checkpoint to see what the human changed —
     a compact `Added / Removed / Moved` report keyed by [deterministic
     id](../../GLOSSARY.md). git can't do this: a textual line-diff of the JSON
     doesn't tell you *which element* changed, human elements carry random ids, and
     every touch bumps volatile metadata, so the readable, by-id diff must be custom.
   - **restore** a checkpoint to roll back a bad edit — an atomic write of the saved
     state back over the file. This is also custom, not `git checkout`: git restores
     only to *commit boundaries*, but the agent makes many edits between commits and
     needs to roll back to its own mid-session moment; and the file may not live in a
     repo at all.
   Restore is **gated on a diff**: before restoring, the agent diffs the checkpoint
   against the current file. If the human changed nothing, it restores freely. If the
   human did change something, the agent reads *what* (the diff is semantic, by id)
   and uses judgment — continue if the change is within the work the human asked for,
   ask for confirmation if it would throw away meaningful human work.
3. **Load / query helpers.** `load(path)`, `.byId(id)`, `.list()` so the agent
   re-finds elements by id and edits surgically instead of re-deriving the scene,
   preserving human-drawn elements untouched.

No agent-facing rendering. ADR-0003 stands: the agent's only "eyes" remain the
deterministic [geometry check](../../GLOSSARY.md); the human stays the sole viewer of
the rendered canvas. (One new insight is parked for a future spec: a *faithful* render
is reachable not via headless Bun, but by asking the already-open browser tab to
export a PNG over the existing WS channel. See Open Questions.)

### Checkpoint storage & lifecycle

- **Where:** a gitignored `.duet/` directory beside the source file. The source
  `.excalidraw` may or may not be tracked in the user's git, so `.duet/` must not
  depend on or pollute it.
- **History:** a short history (about 10 entries), not a single slot.
- **Identity:** each checkpoint is auto-stamped (sequence / timestamp) and may carry
  an agent-supplied **label** ("before-refactor"). Operations default to the latest.
- **When saved:** automatically after every agent edit (so a diff reference always
  exists, even after context loss), plus explicit labeled checkpoints the agent
  creates before risky edits.
- **Pruning:** manual-sticky — prune the oldest *auto* checkpoints past the cap, but
  never auto-evict a *labeled* checkpoint; labeled ones are removed only when the
  agent deletes them.

### Diff key

Match elements **by id**. Compare only meaningful fields (`x`, `y`, `width`,
`height`, `points`, `text`, bindings). Ignore volatile metadata (`version`,
`versionNonce`, `seed`, `updated`). "Moved" = position changed. (The Excalidraw MCP
`edit-context.ts` is the reference for this approach.)

## Scope

### In scope

- As the agent, I can connect two boxes with an arrow that clips to their borders
  (real `startBinding`/`endBinding`), with the **nearest facing edge auto-picked**,
  so arrows no longer stab through boxes and don't route from the wrong side.
- As the agent, I can save a checkpoint of the scene (auto after each edit, or an
  explicit labeled one) and later — even after losing context — diff the current file
  against it to see what the human changed, keyed by id.
- As the agent, I can restore a checkpoint to roll back a bad edit, with the restore
  gated on a diff so I never silently overwrite the human's work.
- As the agent, I can load an existing scene and query elements by id / list them,
  so I can edit one element without re-deriving the whole scene and without
  disturbing human-drawn elements.

### Out of scope

- **Any agent-facing rendering** — no PNG/SVG image for the agent. ADR-0003 stands;
  the browser-export render idea is deferred to its own spec (see Open Questions).
- **Layout helpers** (`layoutRow`/grid/tree) — the agent keeps computing coordinates.
- **Graph auto-layout** (dagre / elk / mermaid-to-excalidraw).
- **Headless text measurement** (`setCustomTextMetricsProvider`) — the browser
  measures on load.
- **MCP server and CLI skins** — short scripts on the helpers remain the interface.
- **A from-scratch core rewrite / `resolveScene(base, ops)`** — extend the existing
  `authoring.ts` / `writeback.ts`, don't replace them.

## Success Criteria

- An arrow authored via the binding helper renders with its head touching the target
  box border, not inside it, and attaches to the nearest facing edge; the saved JSON
  carries `startBinding`/`endBinding` with `elementId` + `fixedPoint`.
- The agent saves a checkpoint; the human then moves/adds/deletes elements in the
  browser; the agent (in a fresh context) diffs the file against the checkpoint and
  correctly reports the changes as `Added / Removed / Moved` by id.
- The agent restores a checkpoint and the file returns to the saved state; when the
  human has edited since the checkpoint, the agent surfaces those changes rather than
  silently overwriting them.
- Checkpoints live in `.duet/`, survive a new process, keep a labeled checkpoint past
  the auto-prune cap, and default to the latest when unspecified.
- The agent can open an existing `.excalidraw`, get an element by id, change one
  property, save, and leave every other element — including human-drawn ones —
  untouched.
- Bindings (with auto-edge), checkpoint save/diff/restore + lifecycle, and
  `byId`/`list` are covered by `bun:test`.

## Constraints

- **Sync invariants must not regress** (CLAUDE.md): atomic write (temp + rename),
  echo guard (a browser save fans out to other tabs but not the sender), appState
  whitelist as the single source of truth.
- Checkpoints persist **on disk** in a gitignored `.duet/` dir; they must not assume
  the source file is in a git repo.
- Preserve [deterministic ids](../../GLOSSARY.md); the diff is keyed by id; never reuse
  a deleted id; treat any unknown id as a human element and preserve it as-is.
- Restore is custom (not `git checkout`) and gated on a diff; it is otherwise
  last-writer-wins, consistent with [strict alternation](../../GLOSSARY.md).
- Use `bun`, never `npm`. Reuse `writeback.ts`'s atomic write + scene envelope.

## Open Questions / Risks

- **Agent-facing rendering, reopened but deferred.** ADR-0003 rejected agent
  rendering partly because a *faithful headless* render proved unreliable in Bun. A
  new path sidesteps that: the already-open browser tab is the real Excalidraw engine
  and can `exportToBlob`, returning a faithful PNG over Duet's existing WS channel.
  The bind: a faithful render needs a live tab, so it's unavailable exactly in a
  headless agent-only session. **Deferred to its own spec** (request/response design,
  what triggers it, tab-present fallback, stale-PNG-vs-live-file reconciliation);
  ADR-0003 stands until then. The geometry check remains the agent's only eyes and may
  miss aesthetic problems.
- **Checkpoint promoted from "Not part of v1."** This slice promotes it to v0.2.
  **→ Update the glossary via `domain-docs`**: drop the "not part of v1" note, confirm
  the definition covers both **diff** and **restore**, and replace the loose
  "snapshot" wording (snapshot was the rejected PNG idea).
- **`fixedPoint` auto-edge quality.** Auto-picking the nearest facing edge handles the
  common case; unusual layouts (boxes diagonally offset, overlapping) may still pick a
  side that routes awkwardly even though it clips. Acceptable for this slice; revisit
  if it bites.
