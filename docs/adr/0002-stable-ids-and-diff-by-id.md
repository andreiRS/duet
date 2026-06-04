# ADR-0002: Stable element ids and diff-by-id as the sync mechanism

**Status:** Accepted (amended by ADR-0007)
**Date:** 2026-06-03

## Context

With the shared file as the only interface (ADR-0001), the agent must, on its turn, figure out what the human changed and continue editing without clobbering those changes. There is no shared diff baseline and no merge engine.

The genuine alternatives:

- **Operational transform / CRDT merge** over a live shared document. Robust for true concurrent editing, but heavy machinery we don't need under turn-taking.
- **Re-author the whole scene each turn** from the agent's intent. Simple, but it destroys every human nudge on every agent edit.
- **Deterministic ids + diff-by-id.** The agent assigns stable, meaningful ids when it authors (`api`, its label `api_t`, an arrow `a1`). Excalidraw preserves element ids and bound-text bindings across an edit round-trip, so on its turn the agent matches elements by id and diffs the geometry/text fields, then patches **by id**.

This rests on a load-bearing fact: Excalidraw does not reassign element ids on load or edit (it bumps only `version`/`versionNonce`), and bound-text bindings (`containerId` / `boundElements`) survive intact. Confirmed against Excalidraw 0.18 source and docs.

## Decision

We will give every agent-authored element a deterministic id and synchronize by diffing elements by id. The agent diffs on `id` plus the geometry/text fields (`x`, `y`, `width`, `height`, `text`, `points`) and **never** on `version`/`versionNonce`. It patches by id so human nudges survive the next programmatic edit. Elements with unknown (random nanoid) ids are treated as human-drawn and preserved as-is.

## Consequences

- **Easier:** no merge engine; the round-trip is a plain id-keyed diff; human nudges survive because positions live on identified elements the agent patches in place.
- **Easier:** the agent can read intent from the diff ("this box moved right → give it room").
- **Harder / accepted cost:** the design is coupled to Excalidraw preserving ids across the round-trip. If a future Excalidraw version reassigned ids or broke bound-text bindings, the sync mechanism would break. This is the single most load-bearing assumption in Duet.
- **Accepted cost:** `version`/`versionNonce` churn on every edit (including no-ops), so diffing on them is forbidden; the agent must diff on meaningful fields only. Human-drawn elements carry random ids the agent cannot rename without risking their bindings, so the agent leaves them alone.

## Amendment (ADR-0007)

The "forbidden to use `version`" rule above applies to **change detection** (the
diff that reads what the human changed). ADR-0007 carves out a second, distinct
job: `version`/`versionNonce` *are* used as the **merge tiebreaker** when two
writers hold the same element id. Diffing on version is still forbidden; resolving
a merge conflict by version is required. See ADR-0007.
