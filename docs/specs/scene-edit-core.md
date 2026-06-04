# Scene-edit core — one fluent object for load, author, save

Slice of the v0.2 backlog (`docs/v0.2-improvements.md`, idea #1). The full
scene-edit [core](../../GLOSSARY.md) the agent-edit-core slice deliberately
deferred. Builds on what that slice shipped (bindings, checkpoint, `byId`/`list`)
and promotes several items it listed as out-of-scope.

## Problem

The [agent](../../GLOSSARY.md) touches the [source-of-truth
file](../../GLOSSARY.md) through two libraries that **don't compose**, plus a pile
of per-edit hand-rolling:

1. **Author vs mutate are split.** `authoring.ts` `scene()` *creates* a new scene
   (has the authoring verbs, `build()` returns a plain object the caller
   serializes). `load.ts` `load(path)` *reads* an existing scene (`list`/`byId`/
   `save`) but has **no authoring verbs** — to change a loaded scene the agent
   hand-edits raw element objects. There is no single way to touch a scene.
2. **`save()` demands a server-only `EchoGuard`.** The guard lives in the server
   process (`cli.ts bootstrap`); the agent runs in a separate process with none.
   The signature leaks a server concept into the agent's API, and a guard passed
   by mistake would suppress the agent's own broadcast.
3. **Naive text sizing.** `authoring.ts` still measures width as
   `length * fontSize * 0.55`, summed across lines — the estimate that produced a
   1592px label and broke multi-line centering in v0.1.
4. **The geometry check is opt-in per script.** Nothing forces it before a write,
   so one forgotten call lands a broken scene on the human.
5. **Layout is hand-rolled.** The verbatim `bun -e` appendix is ~30 lines of gap
   math to place a row of boxes and route arrows in the gaps — redone every edit.

**Confidence:** anecdotal
**Sources:** `docs/v0.2-improvements.md` (idea #1 and appendix; ideas #4, #7,
#8), the v0.1 manual session (2026-06-03, the 1592px label), and the current
`authoring.ts` / `load.ts` / `writeback.ts` code.

## Solution

One **fluent, mutate-in-place** object that loads-or-creates, queries, authors,
and saves — merging today's split `scene()` / `load()`. The core is **pure file
work**: it runs with the server down, and camera and rendering stay outside it
(ADR-0006 for the fluent-vs-functional choice; ADR-0005 for camera; ADR-0003 for
rendering).

This **extends** the code shipped by `agent-edit-core.md` (bindings, checkpoint,
`byId`/`list`); it does **not** duplicate or replace it. `open()` is built by
growing today's `load()` handle with the authoring verbs and the unified
`save()`, so the checkpoint/diff paths that already sit on `load()`/`writeback.ts`
keep working unchanged.

- **`open(path)`** loads the file if it exists, else starts empty (today's
  `ensureScene`). It returns one handle carrying query (`byId`, `list`),
  authoring verbs (`addBox`/`connect`/`setLabel`/…, moved off `scene()`), and
  `save()`. Creating a new scene is just `open()` on a missing path, then
  authoring into it.
- **Mutate-in-place**, not the functional `resolveScene(base, ops)` that idea
  #1's title proposed (ADR-0006). Verbs mutate the handle's internal element
  list; `save()` flushes. Optimized for the agent's short one-shot scripts.
- **`save({ source? })`, no guard, atomic always.** Temp+rename stays. Default
  `source` to the agent tag so the client flashes the human. The `EchoGuard`
  stays purely on the server's human-save path. Extract the atomic writer so both
  `save({source})` (agent) and `writeSceneFile(...,guard)` (server) share it.
- **Bound labels measured by Excalidraw.** Drop the `0.55` width math for any
  container label; attach the text as a bound child (`containerId` +
  `boundElements`, which `labeledRect` already does) and let Excalidraw measure
  and center on load. Standalone `text()` keeps an estimate and is single-line by
  contract.
- **`save()` runs the [geometry check](../../GLOSSARY.md).** It **auto-fixes**
  mechanical violations in place, **throws** on structural ones before the write
  (so a broken scene never reaches disk), and **returns a report** of what was
  fixed. `save({ check: false })` opts out.
- **Last-writer-wins**, no stale check — consistent with [strict
  alternation](../../GLOSSARY.md) and `restore`. The agent reloads and re-diffs
  (it has ids + checkpoints) if it suspects the human edited.
- **Fail-fast on a malformed read.** `open()` throws a clear error on bad JSON;
  since all writers are atomic (temp+rename), a malformed file is genuinely
  broken, not a transient swap — so the "retry-read past atomic swap" idea is
  dropped.
- **Small layout helper set.** `bbox(els)`, `centerX/centerY(els, coord)`, and one
  composite `pipeline(labels, opts)` that places evenly-spaced boxes and
  `connect`s neighbors (reusing the existing edge-binding `connect`, so arrows are
  bound, not gap-routed). Pure geometry, no new dependency. Not full auto-layout.

## Scope

### In scope

- As the agent, I can `open(path)` one object that loads an existing scene or
  starts a new one, and use the same verbs either way.
- As the agent, I can author into a loaded scene (`addBox`/`connect`/`setLabel`)
  without hand-editing raw element objects.
- As the agent, I can `save({ source })` with an atomic write and no echo guard,
  and my write reaches the watcher and broadcasts.
- As the agent, container labels size and center correctly because Excalidraw
  measures them — no more 1592px labels.
- As the agent, `save()` validates geometry for me: mechanical issues auto-fixed
  and reported, structural ones throw before anything hits disk.
- As the agent, I get a clear error if the file is malformed, instead of writing
  on top of a corrupt base.
- As the agent, I can lay out a row of bound boxes+arrows with one `pipeline()`
  call instead of hand gap-math.

### Out of scope

- **Camera (`fitView`) and rendering (`snapshot`)** — separate, independently
  shippable pieces. Camera is out-of-band (ADR-0005, `agent-camera.md`); render
  is its own future spec (ADR-0003 stands).
- **Functional `resolveScene(base, ops)` / op-replay history** — declined
  (ADR-0006).
- **Stale-write detection / auto-merge on save** — last-writer-wins.
- **Headless / node-canvas text measurement** — bound labels make it
  unnecessary; standalone text stays single-line.
- **Full auto-layout** (grid/tree/graph, dagre/elk) — only `bbox`/`center`/
  `pipeline`.
- **CLI `duet edit ...` and MCP skins** (ideas #8, #9) — the library is the
  agent's primary surface; thin skins come later.
- **Re-specifying bindings / checkpoint / `byId`-`list`** — already delivered by
  `agent-edit-core.md`; this slice consumes them.

## Success Criteria

- `open()` on a missing path then authoring + `save()` produces a valid
  `.excalidraw`; `open()` on an existing file exposes the same authoring verbs and
  preserves human-drawn elements untouched.
- A multi-line bound label renders centered with an Excalidraw-measured width;
  the saved JSON carries no hand-computed container-label width.
- `save()` on a scene with a fixable spacing issue writes a corrected file and
  returns a report naming the fix; `save()` on a label-wider-than-box scene throws
  and writes nothing.
- `save({ source })` writes atomically with no guard argument, and the running
  server's watcher broadcasts the change to tabs (no echo suppression of the
  agent's own write).
- `open()` on a truncated/invalid file throws a clear error and does not write.
- One `pipeline([...])` call lays out N spaced boxes with bound connecting arrows
  whose heads touch box borders.
- The core (`open`/verbs/`save`, bound-label sizing, geometry-on-save, layout
  helpers) is covered by `bun:test`.

## Constraints

- **Sync invariants must not regress** (CLAUDE.md): atomic write (temp+rename),
  echo guard remains the server's human-save concern, appState whitelist as the
  single source of truth.
- The core is **pure file work** — no dependency on the server being up, no
  renderer. Camera/snapshot must not be folded into it.
- Preserve [deterministic ids](../../GLOSSARY.md); treat unknown ids as human
  elements and preserve them.
- Reuse the existing atomic writer (`writeback.ts`) and the edge-binding
  `connect` from `authoring.ts`; extend, don't fork.
- **Extend `agent-edit-core.md`'s code, don't duplicate it.** `open()` grows the
  existing `load()` handle; the checkpoint/diff/`byId`/`list`/bindings work it
  delivered must keep functioning, not be reimplemented.
- Use `bun`, never `npm`.

## Open Questions / Risks

- **Don't break the checkpoint/diff paths when merging `scene()` into
  `open()`.** Extending (not duplicating) `agent-edit-core.md`'s code is settled;
  the residual risk is that growing the `load()` handle disturbs the
  checkpoint/diff machinery built on its current shape. Cover it with the existing
  checkpoint tests before and after the merge.
- **Geometry-on-save throwing mid-script.** Auto-throw on structural violations
  is a guardrail, but a partially-built scene that is briefly invalid would throw
  on an interim `save()`. Mitigation: the agent saves once at the end;
  `save({check:false})` exists for deliberate interim writes.
- **`pipeline()` scope creep.** One composite helper is the line; resist growing
  it toward a layout engine (the doc warns against connecting non-neighbors →
  crossing diagonals).
