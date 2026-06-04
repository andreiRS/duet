// Reconciliation primitives (ADR-0002 + ADR-0007). Pure, no IO.
//
// - `diffById(baseline, current)`: classify every element by its stable `id`.
//   Dual-use — the agent's dirty-set at save time (which ids it changed/added/
//   deleted), and Job B intent reading (what the human changed, by meaningful
//   fields, never by `version`).
// - `mergeById(current, incoming)`: union the two element sets by id, resolving
//   a shared id by Excalidraw's `version`/`versionNonce` rule. The forward/
//   reverse-race fix: an element only on disk is KEPT (missing != deleted).

import type { El } from "./scene-types";
export type { El } from "./scene-types";

export interface Diff {
  moved: string[];
  retyped: string[];
  added: string[];
  deleted: string[];
}

function elements(input: { elements?: El[] } | El[]): El[] {
  return Array.isArray(input) ? input : input.elements ?? [];
}

// The single source of truth for the whitelisted fields the diff compares.
// NEVER includes version/versionNonce. `points` is compared by deep value; all
// others by strict equality.
const PATCH_FIELDS = ["x", "y", "width", "height", "text", "points"] as const;
const DEEP_FIELDS = new Set<string>(["points"]);

function fieldChanged(a: El, b: El, field: string): boolean {
  if (DEEP_FIELDS.has(field)) {
    return JSON.stringify(a[field] ?? null) !== JSON.stringify(b[field] ?? null);
  }
  return a[field] !== b[field];
}

export function diffById(
  baseline: { elements?: El[] } | El[],
  current: { elements?: El[] } | El[],
): Diff {
  const base = elements(baseline);
  const curr = elements(current);
  const baseById = new Map(base.map((e) => [e.id, e]));
  const currById = new Map(curr.map((e) => [e.id, e]));

  const moved: string[] = [];
  const retyped: string[] = [];
  const added: string[] = [];
  for (const c of curr) {
    const b = baseById.get(c.id);
    if (!b) {
      added.push(c.id);
      continue;
    }
    if (geometryChanged(b, c)) moved.push(c.id);
    if (fieldChanged(b, c, "text")) retyped.push(c.id);
  }

  const deleted: string[] = [];
  for (const b of base) {
    if (!currById.has(b.id)) deleted.push(b.id);
  }

  return { moved, retyped, added, deleted };
}

// Union-by-id merge (ADR-0007). `current` = elements just re-read from disk;
// `incoming` = the agent's (or a client's) elements. Resolve each id:
//   - in BOTH  -> the higher Excalidraw `version` wins; on a tie the LOWER
//                 `versionNonce` wins (mirrors Excalidraw's collab reconciler,
//                 so all writers converge to the same deterministic winner).
//   - on disk only  -> KEEP it (missing != deleted — the core forward-race fix).
//   - incoming only -> ADD it, appended after the on-disk elements.
// Preserves the on-disk array order (z-order); appends genuinely-new incoming
// elements at the end in incoming order. Pure, no IO. Reused by the agent save
// path (#16) and the server browser-save path (#17).
export function mergeById(
  current: { elements?: El[] } | El[],
  incoming: { elements?: El[] } | El[],
): El[] {
  const disk = elements(current);
  const inc = elements(incoming);
  const incById = new Map(inc.map((e) => [e.id, e]));

  const out: El[] = [];
  const seen = new Set<string>();
  for (const d of disk) {
    seen.add(d.id);
    const i = incById.get(d.id);
    out.push(i ? pickWinner(d, i) : d);
  }
  for (const i of inc) {
    if (!seen.has(i.id)) out.push(i);
  }
  return out;
}

// Excalidraw's reconciliation rule: higher `version` wins; on a tie the element
// with the LOWER `versionNonce` wins. A missing field is treated as 0 (lowest),
// conservatively. `a` is the on-disk copy, `b` the incoming copy.
//
// When version AND versionNonce are both equal we still need a deterministic,
// argument-order-independent winner so all writers converge regardless of which
// side a copy arrives on (the agent path and #17 call mergeById with swapped
// args). We break that final tie on a stable, symmetric key — the canonical
// JSON of each copy — so pickWinner(a,b) and pickWinner(b,a) pick the same one.
function pickWinner(a: El, b: El): El {
  const va = (a.version as number) ?? 0;
  const vb = (b.version as number) ?? 0;
  if (vb > va) return b;
  if (va > vb) return a;
  const na = (a.versionNonce as number) ?? 0;
  const nb = (b.versionNonce as number) ?? 0;
  if (nb < na) return b;
  if (na < nb) return a;
  // version and versionNonce both equal — deterministic symmetric tiebreak.
  return JSON.stringify(b) < JSON.stringify(a) ? b : a;
}

// Geometry = every whitelisted field except text. Driven by PATCH_FIELDS so the
// diff and the patch overlay never drift.
const GEOMETRY_FIELDS = PATCH_FIELDS.filter((f) => f !== "text");

function geometryChanged(a: El, b: El): boolean {
  return GEOMETRY_FIELDS.some((f) => fieldChanged(a, b, f));
}
