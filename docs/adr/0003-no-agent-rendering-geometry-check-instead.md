# ADR-0003: No agent rendering; a geometry check is the agent's eyes

**Status:** Accepted
**Date:** 2026-06-03

## Context

Of the four capabilities the loop seems to need (human edits, human views, agent edits, agent views), "agent views" is the expensive one: an agent in a terminal cannot see a rendered canvas, and rendering one is slow and adds a step to every turn.

The genuine alternatives:

- **Build a local renderer** (scene JSON → SVG → PNG) and feed the image back to the agent, so it can "see" what it drew. Prior art exists (`reference/local-renderer.ts`). But it adds a render-and-look step to every agent turn, and an agent reading a rasterized image is a weak, slow form of "seeing."
- **Drop agent viewing entirely** and replace it with a geometry check: the visual problems that actually matter (label wider than box, box overlap, arrow missing its target edge, off-canvas, too-tight spacing) are pure geometry, computable instantly and deterministically from coordinates.

## Decision

We will not render for the agent. The agent works from JSON plus a geometry check it runs before every write. Mechanical violations it auto-fixes; structural ones it reconsiders; it never hands over a scene with a known violation. The human is the only viewer of the rendered canvas.

## Consequences

- **Easier:** the loop loses its only slow step; checks are instant and deterministic; no renderer to maintain in the hot path.
- **Easier:** "the visual is wrong" becomes a concrete, testable predicate instead of a judgment call.
- **Harder / accepted cost:** the geometry check only catches what we encode as a rule. Aesthetic or semantic problems a human would catch by looking (ugly layout, wrong emphasis, a misleading shape) are invisible to the agent. We rely on the human, as the sole viewer, to catch those during their turn.
- **Note:** `reference/local-renderer.ts` is kept out of the loop, but its element-geometry parsing is reused as prior art for the geometry check.
