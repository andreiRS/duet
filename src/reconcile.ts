// Diff-by-id reconciliation: the agent's sync decision (ADR-0002).
//
// Given a BASELINE scene and a CURRENT scene, classify every element by its
// stable `id` so the agent can continue editing without clobbering human
// nudges. Pure, no IO.
//
// v1 reconciliation rule (last-writer-wins by convention):
// - The AGENT's fresh scene decides which elements exist (agent owns structure).
// - The patch overlays the HUMAN's whitelisted field values for elements present
//   in BOTH scenes (human nudges/renames survive).
// - Human-drawn elements (unknown ids) are carried over from the human unchanged.
// - Human deletions are honored: a deleted id is never resurrected.
// Consequence: if the agent's fresh scene omits an element the human had merely
// moved, that human nudge is not re-added. The agent's structural intent wins.
// This is acceptable for v1.

export type El = Record<string, any>;

export interface Diff {
  moved: string[];
  retyped: string[];
  added: string[];
  deleted: string[];
}

function elements(input: { elements?: El[] } | El[]): El[] {
  return Array.isArray(input) ? input : input.elements ?? [];
}

// Heuristic: does an id look like an Excalidraw random nanoid (human-drawn) vs
// the agent's deterministic scheme?
//
// The agent authors SHORT, meaningful ids: `api`, `db`, `a1`, the label suffix
// `api_t`, and the special `darkbg`. Excalidraw assigns random nanoids to
// human-drawn elements: ~21 chars from the alphabet [A-Za-z0-9_-].
//
// We key purely on LENGTH plus alphabet: an id is "human" when it is long
// (>= 16 chars) and made only of nanoid characters. This will never misclassify
// a normal authored id, because those are far shorter than any real nanoid.
const HUMAN_ID_MIN_LEN = 16;
const NANOID_RE = /^[A-Za-z0-9_-]+$/;

export function isHumanId(id: string): boolean {
  return id.length >= HUMAN_ID_MIN_LEN && NANOID_RE.test(id);
}

// The single source of truth for the whitelisted fields the diff compares and
// the patch overlays. NEVER includes version/versionNonce. `points` is compared
// by deep value; all others by strict equality.
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

// Reconcile the agent's fresh scene with the human's edits, so human nudges
// survive the next programmatic edit (human edits win over a stale baseline).
//
// - `agent`: the scene the agent just authored (possibly from a stale baseline).
// - `diff`:  diffById(baseline, human) — what the human changed.
// - `human`: the human's current scene, the source of the surviving values.
//
// For every element the human MOVED or RETYPED, the human's geometry/text
// fields overwrite the agent's. Human-drawn elements (unknown ids, classified
// `added` and recognised by isHumanId) are carried over as-is. Deleted ids are
// not resurrected.
export function applyPatch(
  agent: { elements?: El[] } | El[],
  diff: Diff,
  human: { elements?: El[] } | El[],
): El[] {
  // Honor human deletions: drop any id the human removed, even if the agent
  // re-authored it from a stale baseline.
  const deleted = new Set(diff.deleted);
  const out = elements(agent)
    .filter((e) => !deleted.has(e.id))
    .map((e) => ({ ...e }));
  const outById = new Map(out.map((e) => [e.id, e]));
  const humanById = new Map(elements(human).map((e) => [e.id, e]));

  // Overlay human values onto agent elements for moved/retyped ids.
  for (const id of new Set([...diff.moved, ...diff.retyped])) {
    const target = outById.get(id);
    const src = humanById.get(id);
    if (!target || !src) continue;
    for (const f of PATCH_FIELDS) {
      if (f in src) target[f] = src[f];
    }
  }

  // Carry over human-drawn elements (unknown ids) the agent does not know about.
  for (const id of diff.added) {
    if (outById.has(id) || !isHumanId(id)) continue;
    const src = humanById.get(id);
    if (src) out.push({ ...src });
  }

  return out;
}

// Geometry = every whitelisted field except text. Driven by PATCH_FIELDS so the
// diff and the patch overlay never drift.
const GEOMETRY_FIELDS = PATCH_FIELDS.filter((f) => f !== "text");

function geometryChanged(a: El, b: El): boolean {
  return GEOMETRY_FIELDS.some((f) => fieldChanged(a, b, f));
}
