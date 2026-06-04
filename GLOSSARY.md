# Glossary

The canonical vocabulary for Duet. One meaning per term.

## Source-of-truth file

The single `.excalidraw` JSON file that both the [agent](#agent) and the human edit. There is exactly one, and it is authoritative. Not two synced copies, and not a database.

Both sides read and write this file directly. A change to it is the only [handoff](#handoff) signal.

## Agent

The AI editor (Claude Code in a terminal). Owns **structure**: element ids, geometry, correctness, anything computable. Reads and writes the [source-of-truth file](#source-of-truth-file) with its normal file tools.

Not the same as Duet (the server). The agent never talks to Duet; they communicate only through the file.

## Human

The person editing in the browser. Owns **taste**: the visual nudge, the final look. The only viewer of the rendered canvas.

## Handoff

The act of passing control from one editor to the other. In Duet there is no explicit "your turn" message: a change to the [source-of-truth file](#source-of-truth-file) *is* the handoff, in both directions.

Relies on [strict alternation](#strict-alternation): only one side edits at a time.

## Strict alternation

The convention that the [agent](#agent) and [human](#human) take turns, never editing at the same moment. It is a convention, not an enforced lock; conflicts are resolved last-writer-wins. This is what lets Duet avoid all merge and conflict logic.

## Deterministic id

A stable, meaningful element id the [agent](#agent) assigns when authoring (a box `api`, its label `api_t`, an arrow `a1`). Excalidraw preserves element ids across an edit round-trip, so the agent re-finds an element by its id after the human has touched it.

Contrast with the random nanoid ids Excalidraw assigns to **human-drawn** elements; the agent treats any unknown id as a human element and preserves it as-is.

## Bound text

A label that survives in Excalidraw JSON only as a **separate text element** linked to its container: the text carries `containerId` = the box's id, and the box carries `boundElements` = `[{type:"text", id}]`. Bare or under-specified `text` elements get dropped by tooling.

A box's label is therefore two elements, not one. Both ids and the binding survive the edit round-trip.

## Camera command

An ephemeral instruction from the [agent](#agent) to move the [human](#human)'s viewport: fit the whole scene, or frame a named set of elements. It changes what the human *sees*, never what the scene *is*.

Deliberately **not** part of the [source-of-truth file](#source-of-truth-file): it is an imperative "do this once" verb, not durable state, so it travels out of band (agent to Duet to the browser) rather than through the file. View is per-tab and transient; scene content is shared and authoritative. See ADR-0005. This is the one channel where the agent talks to Duet, the narrow exception to [handoff](#handoff)-by-file.

## Core

The single scene-edit library both the [agent](#agent) and any future tooling (CLI, MCP) use to touch the [source-of-truth file](#source-of-truth-file): load-or-create, query by id, author elements, and atomically save. One place that owns scene structure, so the logic is never re-hand-rolled per edit.

Distinct from Duet the server: the core reads and writes the *file*, it does not bridge to the browser. It is pure file work and runs with the server down. Camera and rendering are deliberately outside it (see [camera command](#camera-command); rendering is not the core's job, see ADR-0003). See ADR-0006 for why the core is a fluent mutate-in-place object rather than a functional one.

## Geometry check

The pure-geometry validation the [agent](#agent) runs before every write, standing in for the eyes it does not have. Checks: label wider than box, box overlap, arrow endpoint misses target edge, off-canvas, spacing below the minimum. Mechanical violations are auto-fixed; structural ones are reconsidered. The agent never hands over a scene with a known violation.

Not a renderer. It computes problems from coordinates, deterministically, without drawing anything.

## Checkpoint

A saved copy of the scene *state* the [agent](#agent) can compare or roll back against, borrowed from the Excalidraw MCP's terminology. Lets the agent tell its own past edits from the human's after losing context. Two uses:

- **diff** — compare the current [source-of-truth file](#source-of-truth-file) against the checkpoint to see what the human changed, keyed by [deterministic id](#deterministic-id).
- **restore** — return the file to the checkpoint to roll back a bad edit.

A scene state, **not an image** — the agent never renders (see ADR-0003). Restore is last-writer-wins, consistent with [strict alternation](#strict-alternation).
