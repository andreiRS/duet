# ADR format

An Architecture Decision Record captures a single hard-to-reverse decision and the reasoning behind it. Lightweight Nygard style. One file per decision, numbered sequentially: `docs/adr/0001-short-title.md`.

Only write one when the decision is hard to reverse, surprising without context, and the result of a real trade-off. If any of those is missing, don't.

## Template

```markdown
# ADR-0001: Short, decision-shaped title

**Status:** Accepted
**Date:** 2026-05-29

## Context

The forces at play: the problem, the constraints, and what made this a real
decision. What would a future reader need to know to understand why this even
came up? State the genuine alternatives that were on the table.

## Decision

The choice that was made, stated plainly in active voice: "We will …".
One decision per ADR.

## Consequences

What becomes easier and what becomes harder as a result. Include the costs you
knowingly accepted, not just the benefits — that's what makes the record honest
and useful later.
```

## Status values

- `Proposed` — under discussion, not yet committed.
- `Accepted` — the decision is in force.
- `Superseded by ADR-NNNN` — replaced by a later decision. Do not delete the old ADR; flip its status and point forward.
- `Deprecated` — no longer relevant, but kept for the historical record.

## Rules

- **One decision per ADR.** If you're recording two, write two files.
- **Never rewrite history.** A reversed decision becomes `Superseded by …`; the original stays so the trail of reasoning survives.
- **Title is the decision**, not the topic: "Use Postgres for the event store", not "Database choice".
- **Record the trade-off.** An ADR with no alternatives and no accepted cost probably didn't need to exist.
