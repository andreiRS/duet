# ADR-0006: The scene-edit core is a fluent mutate-in-place object, not a functional `resolveScene`

**Status:** Accepted
**Date:** 2026-06-04

## Context

v0.2 wants one reusable scene-edit core so the agent stops hand-rolling a
`bun -e` script per edit (envelope, ids, atomic write, layout math all redone
each time). Two shapes were already half-built and pulling in different
directions:

- `authoring.ts` `scene()` — *creates* a new scene by mutating an internal
  element list, then `build()` returns a plain object the caller serializes.
- `load.ts` `load(path)` — *reads* an existing scene, hands back the **live**
  element array to mutate in place, and `save()` flushes it.

Both are mutate-in-place. But idea #1's own title in
`docs/v0.2-improvements.md` proposed the opposite: `resolveScene(base, ops) ->
flat JSON` — a **functional** core where edits are plain data (`{op:"addBox",
...}`) folded over a base scene to compute a new one.

The genuine alternatives:

- **Functional `resolveScene(base, ops)`.** Edits are serializable data.
  Buys replayable/undoable history, trivial "ops -> scene" testing, and a clean
  path to an MCP tool (idea #9) that ships ops as JSON. Cost: a larger rewrite,
  and the agent writes ops-as-data instead of calling methods — more ceremony
  for the common case.
- **Fluent mutate-in-place object.** `open()` returns a stateful handle;
  `addBox`/`connect`/`setLabel` mutate its element list; `save()` flushes. Reads
  naturally for the agent's short imperative scripts. Cost: no free
  undo/replay — the object *is* the state.

The agent's real workload is short, one-shot scripts: open, author a few
elements, save. That is the case to optimize.

## Decision

We will build the core as a single **fluent, mutate-in-place** object.
`open(path)` loads-or-creates and returns one handle carrying query (`byId`,
`list`), authoring verbs (`addBox`, `connect`, `setLabel`, layout helpers), and
`save()`. Verbs mutate the handle's internal element list; `save()` writes it
atomically. We explicitly do **not** build the functional `resolveScene(base,
ops)` core, despite idea #1's title proposing it.

## Consequences

- **Easier:** least new code — both existing halves (`scene()`, `load()`)
  already mutate in place; this merges them rather than rewriting to a fold.
- **Easier:** the call site matches how the agent thinks for a one-shot edit:
  `const s = open(f); s.addBox(...); s.connect(...); s.save()`.
- **Harder / accepted cost:** no replayable or serializable edit history. There
  is no `ops` array to log, diff, or undo; the handle's current state is the
  only truth. We already get cross-turn "what changed" from stable ids +
  checkpoints (ADR-0002, ADR-0004), so we don't need ops-replay for that.
- **Accepted cost:** an eventual MCP tool (idea #9) cannot ship edits as
  ops-as-data for free; it would wrap the same fluent verbs, or we would add an
  op layer then. We are not paying for that abstraction now, before the MCP
  exists.
- **Reversal cost:** moving to a functional core later means re-expressing every
  verb as an op and rewriting call sites — meaningful, which is why this is
  recorded rather than left implicit. A future contributor should not "restore"
  the functional core assuming it was merely never built; it was considered and
  declined for the one-shot-script workload.
