# ADR-0007: Conflict resolution is re-read + union-by-id merge, with `version` as the merge tiebreaker

**Status:** Accepted
**Date:** 2026-06-04

## Context

Both write paths overwrite the whole file from a snapshot taken earlier, so any
element created in the gap between snapshot and write is silently dropped. QA
reproduced this in both directions (`docs/qa/2026-06-04-feat-scene-edit-core.md`):

- **Forward race (#16):** the agent's `open()` snapshots the file, a human draws
  in the `open()`→`save()` window, then `save()` writes the old snapshot back and
  the human's element is lost.
- **Reverse race (#17):** the browser's 400ms-debounced `save` sends a full-scene
  snapshot captured at edit time; the server writes it wholesale
  (`writeback.writeSceneFile`), dropping any element the agent wrote in that
  window.

The root cause in both is the same: a **blind full-file overwrite from a stale
snapshot**. This ADR records the strategy that #16, #17, and #18 implement
(issue #15 is decision-only, no production code).

A load-bearing fact unlocks the simple answer: **Excalidraw soft-deletes.** A
deleted element is not removed from the array — it stays with `isDeleted: true`
(see `diff.ts`, `authoring.ts`). So a delete is never an *absence*; it is a
present element with a newer version. That removes the only hard ambiguity a
merge would otherwise face ("is this id missing because it was deleted, or
because my snapshot is stale?"), and means no per-element baseline or version
*protocol* is needed to handle deletes.

The genuine alternatives weighed:

- **Lock the canvas while the agent works.** Prevent concurrent edits instead of
  reconciling them. Rejected: the agent has no turn boundaries today (an edit is
  a one-shot file write, ADR-0001), so this needs a new acquire/release protocol;
  it introduces stuck-lock and timeout-race failure modes; it does not by itself
  close the reverse race (a debounced save scheduled *before* the lock still
  fires with stale data); and it changes the product from "live two-way" to
  "turn-based with the human locked out." Strictly more code and more failure
  modes than merging.
- **Optimistic version guard / scene-version protocol.** Have the browser send
  the base version it edited from; reject and force a rebase on a stale base.
  Rejected for v1: needs a WS protocol change and client rebase logic, and buys
  correctness only for a case soft-delete tombstones already make unambiguous.
- **Per-element `version`/`versionNonce` LWW over a re-read union.** Re-read the
  current file at write time and merge by id, resolving each shared id by
  Excalidraw's own `version`/`versionNonce` rule. No protocol change, reuses data
  already in every element.

## Decision

We will resolve concurrent edits by **re-reading the file at write time and
merging the incoming elements into the current on-disk elements, keyed by element
id**, on **both** write paths — the agent `save()` (`src/open.ts`) and the server
browser-save (`src/server.ts` / `writeback.writeSceneFile`). The write stays
atomic (temp + rename, unchanged).

**Union rule, per element id:**

- in both → the element with the higher Excalidraw `version` wins; on a tie, a
  deterministic `versionNonce` comparison decides (mirroring Excalidraw's own
  collaboration reconciler, so all writers converge to the same winner).
- only on disk → **keep it** (missing ≠ deleted — this is the fix for the
  silently-dropped element).
- only incoming → **add it**.

Deletes need no special case: an `isDeleted: true` tombstone is just the
higher-version state of that id, so the tiebreak carries it like any other field.

**`version` has two distinct jobs, and this ADR governs only the first:**

- **Job A — merge tiebreaker (this ADR):** `version`/`versionNonce` decide which
  copy of a shared id wins. Required.
- **Job B — change detection / intent diffing (ADR-0002):** still **forbidden**
  to diff on `version`, because it churns on no-ops. The agent reads what the
  human changed from meaningful fields (`x`, `y`, `width`, `height`, `text`,
  `points`). This ADR amends ADR-0002 to carve out Job A; ADR-0002 stays Accepted.

**Agent version stamping.** Today nothing bumps `version` (`baseEl` hard-codes
`version: 1`/`versionNonce: 1`; `geometry.moveElement` does not bump). So the
agent must stamp its own changes for Job A to be fair:

1. `open()` snapshots the loaded scene as a baseline.
2. At `save()`, `diffById(baseline, current)` yields exactly the ids the *agent*
   changed or added (catching edits from verbs, geometry auto-fix, and direct
   `byId` mutation alike).
3. For those ids only, set `version = max(loadedVersion, currentDiskVersion) + 1`
   with a fresh `versionNonce`. Untouched elements keep their loaded version, so
   a concurrent human edit to them wins on its higher disk version.

This keeps `diffById` (now dual-use: the agent's dirty-set here, plus Job B intent
reading) and **drops `reconcile.applyPatch`** — the old baseline-merge is
superseded by this union merge.

**Broadcast.** The server broadcasts the **merged** scene to **all** tabs,
including the sender. The merged result can differ from what the sender sent (it
gains the agent's concurrent element); the client's `isApplyingRemote` guard
already absorbs the resulting `onChange`, so there is no save-loop. This amends
the echo-guard invariant in `CLAUDE.md`: loop-prevention is `isApplyingRemote`,
not withholding data from the sender.

**Client merge (#18) follows the same principle.** When the client applies a
remote scene, it keeps its not-yet-saved local elements layered over the incoming
scene by the same id + `version` rule, so an in-progress human element does not
flicker out. Stated here; implemented in #18.

Settled by convention: the merge preserves the on-disk element array order
(z-order) and appends genuinely-new elements; `appState` stays whole-value
last-writer-wins on the existing whitelist (`theme`, `gridSize`,
`viewBackgroundColor`), not merged; tombstones are kept forever in v1.

## Consequences

- **Easier:** the merge needs no per-element baseline protocol and no
  `isHumanId` heuristic for *safety* — union + `version` suffices. Soft-delete
  tombstones make "missing means stale, keep it" always correct.
- **Easier:** the deterministic `version`/`versionNonce` tiebreak makes
  interleaved writes **converge** for any shared id, regardless of write order.
- **Harder / accepted cost:** the agent now carries a real responsibility — it
  must stamp `version` on its own changes (via the baseline diff). Skip it and
  the agent's edits silently lose to the stale on-disk copy.
- **Accepted cost — same-element concurrent edit:** if the agent and a human edit
  the *same* element in the window, it is whole-element last-writer-wins (not
  field-level), and silent — no notification, no undo. Rare; acceptable for v1.
- **Accepted cost — residual race:** the agent process and the server can still
  interleave a read→write on the shared file. The atomic rename keeps each write
  clean, and `version` makes shared-id outcomes converge, but an element a writer
  *never read* (a brand-new id created after that writer's re-read) can still be
  dropped. The window shrinks from "a whole turn / 400ms" to microseconds. Truly
  closing it would need a single writer or a file lock, which we decline (see
  the rejected lock alternative).
- **Accepted cost — tombstone growth:** kept-forever `isDeleted` elements grow
  the file slowly. Pruning is unsafe under LWW (it would let a writer holding a
  stale *alive* copy resurrect a deleted id), so compaction is deferred to a
  future ADR.
- **Invariants preserved:** atomic write (temp + rename), the echo guard still
  records the written bytes so the watcher skips our own write, and the fan-out
  still reaches the other tabs — now also the sender, with the merged result.
- **Reversal cost:** the `version`-as-tiebreaker contract is shared by the agent
  path, the server path, and the client. Changing the merge rule means changing
  all three in lockstep, which is why it is recorded here rather than left
  implicit.
