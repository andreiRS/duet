# ADR-0004: Checkpoint uses custom diff and restore, not git

**Status:** Accepted
**Date:** 2026-06-03

## Context

[Checkpoint](../../GLOSSARY.md#checkpoint) was marked "not part of v1": the loop was
assumed to get by on the agent's live context plus [deterministic
ids](../../GLOSSARY.md#deterministic-id). v0.1 testing showed otherwise. After losing
context (a long session, compaction, a fresh process) the agent could not tell what
the human had changed since its last edit, and could not roll back a bad edit. So
checkpoint enters v0.2 with two uses: **diff** (what changed since the saved state,
keyed by id) and **restore** (roll the file back to the saved state).

The agent is Claude Code and already has git, so the obvious question was whether git
could serve both, instead of writing our own.

- **git for diff.** A `git diff` of the `.excalidraw` JSON is a textual line-diff. It
  doesn't say *which element* changed (the id line is far from the changed field), the
  human's elements carry random ids, and every Excalidraw touch bumps volatile
  metadata (`version`, `versionNonce`, `seed`, `updated`), so a clean move shows up as
  noise. It cannot produce the readable, by-id `Added / Removed / Moved` report.
- **git for restore.** `git checkout` restores only to *commit boundaries*. The agent
  makes many edits between commits and needs to roll back to its own mid-session
  moment, not to the last commit. And the source file may not live in a git repo at
  all.

## Decision

We will implement checkpoint as **custom diff and custom restore** in Duet, not on top
of git. The checkpoint is a saved scene *state* on disk (a gitignored `.duet/` dir).
Diff matches elements by id, compares meaningful fields, and ignores volatile
metadata. Restore is an atomic write of the saved state back over the file, gated on a
diff so the agent never silently overwrites human edits.

Agent-facing rendering stays out (ADR-0003 stands): a checkpoint is a scene state, not
an image, and the agent still does not render.

## Consequences

- **Easier:** the agent gets a readable, by-id account of what the human changed, and
  a mid-session rollback point, neither of which git provides for this file format.
- **Easier:** works whether or not the source file is tracked in git.
- **Harder / accepted cost:** we own a small storage/lifecycle surface (history cap,
  labels, pruning) and the diff logic, instead of leaning on a tool that already
  exists. Accepted because git cannot do the part that matters.
- **Note:** the diff approach is adapted from the Excalidraw MCP's `edit-context.ts`.
- **Note:** ADR-0003 (no agent rendering) may be revisited later for a different
  reason than it was decided on. It rejected rendering partly because a *faithful
  headless* render is unreliable in Bun; but the already-open browser tab is the real
  Excalidraw engine and could `exportToBlob` a faithful PNG over Duet's existing WS
  channel. That path is deferred to its own spec and does not change this decision.
