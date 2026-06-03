// Geometry check: the agent's "eyes". Pure, no IO.
//
// Given a scene ({ elements } or an El[]), run five geometry checks, auto-fix
// the MECHANICAL violations and re-check, and FLAG the STRUCTURAL ones for the
// agent to rethink. Never reports ok:true while a known violation still stands.
//
// Element-geometry parsing (bounding box, arrow endpoints) is reused from the
// prior art in reference/local-renderer.ts (buildSvg bounds + arrow points).

export type El = Record<string, any>;

export type ViolationType =
  | "label-wider-than-box"
  | "box-overlap"
  | "arrow-misses-target"
  | "off-canvas"
  | "spacing-too-close";

export interface Violation {
  type: ViolationType;
  ids: string[];
}

export interface GeometryResult {
  ok: boolean;
  violations: Violation[]; // everything detected on the input scene
  fixed: El[]; // scene after mechanical auto-fixes
  remaining: Violation[]; // structural violations still standing after fixing
}

// Tolerances / thresholds
const ARROW_TOL = 5; // px: arrow endpoint must be within this of the target edge
const MIN_SPACING = 20; // px: elements closer than this (and not overlapping) are too tight
// px: an element sitting farther than this from the cluster of all the other
// elements (gap from its bbox to the bounding box of every other real element)
// is treated as off-canvas. Chosen so a moderately-displaced box (~400px+) is
// caught while a normal spread-out layout (boxes a few hundred px apart) is not.
const OFF_CANVAS_GAP = 350;
const STRUCTURAL: ViolationType[] = ["box-overlap", "arrow-misses-target"];

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ---- geometry parsing (reused from local-renderer prior art) ----

function elements(input: { elements?: El[] } | El[]): El[] {
  return Array.isArray(input) ? input : input.elements ?? [];
}

// Axis-aligned bounding box of any element (rectangle/text via x/width, arrow
// via its point offsets). Mirrors buildSvg's xs/ys logic in local-renderer.ts.
function bbox(e: El): Rect {
  if (e.points) {
    const xs = e.points.map((p: number[]) => e.x + p[0]);
    const ys = e.points.map((p: number[]) => e.y + p[1]);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
  }
  return { x: e.x, y: e.y, w: e.width ?? 0, h: e.height ?? 0 };
}

// The arrow's end point in absolute coords (last point offset + origin).
function arrowEnd(e: El): { x: number; y: number } {
  const pts: number[][] = e.points ?? [[0, 0]];
  const last = pts[pts.length - 1];
  return { x: e.x + last[0], y: e.y + last[1] };
}

function isBox(e: El): boolean {
  return e.type === "rectangle" && e.id !== "darkbg";
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// Gap between two non-overlapping rects (0 if they touch/overlap).
function gap(a: Rect, b: Rect): number {
  const dx = Math.max(0, Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w)));
  const dy = Math.max(0, Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h)));
  return Math.hypot(dx, dy);
}

// Distance from a point to the nearest edge of a rect (0 if inside).
function distToRectEdge(p: { x: number; y: number }, r: Rect): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h));
  return Math.hypot(dx, dy);
}

// ---- detection ----

function detect(els: El[]): Violation[] {
  const out: Violation[] = [];
  const boxes = els.filter(isBox);

  // 1. Label wider than box: a bound text whose width exceeds its container box.
  for (const box of boxes) {
    const label = els.find((e) => e.type === "text" && e.containerId === box.id);
    if (label && (label.width ?? 0) > (box.width ?? 0)) {
      out.push({ type: "label-wider-than-box", ids: [box.id] });
    }
  }

  // 2. Box overlap: two box rects whose bounding rects intersect (structural).
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (rectsOverlap(bbox(boxes[i]), bbox(boxes[j]))) {
        out.push({ type: "box-overlap", ids: [boxes[i].id, boxes[j].id] });
      }
    }
  }

  // 3. Arrow endpoint misses target edge: end point farther than tolerance from
  //    the nearest box edge (structural). We check against the closest box.
  //    KNOWN v1 LIMITATION: this measures the arrow end against the NEAREST box,
  //    not a semantically-bound target. Authored arrows aren't bound to a target
  //    yet in v1, so "nearest box" is the best available proxy. Once arrows carry
  //    an explicit endBinding/target id, this should check against that target.
  for (const a of els) {
    if (a.type !== "arrow") continue;
    const end = arrowEnd(a);
    if (boxes.length === 0) continue;
    let nearest = Infinity;
    for (const box of boxes) {
      nearest = Math.min(nearest, distToRectEdge(end, bbox(box)));
    }
    if (nearest > ARROW_TOL) {
      out.push({ type: "arrow-misses-target", ids: [a.id] });
    }
  }

  // 4. Off-canvas: an element flung far from the rest of the diagram (mechanical).
  for (const off of offCanvasIds(els)) {
    out.push({ type: "off-canvas", ids: [off] });
  }

  // 5. Spacing < 20px: two elements closer than the minimum but not overlapping.
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = bbox(boxes[i]);
      const b = bbox(boxes[j]);
      if (rectsOverlap(a, b)) continue;
      const g = gap(a, b);
      if (g < MIN_SPACING) {
        out.push({ type: "spacing-too-close", ids: [boxes[i].id, boxes[j].id] });
      }
    }
  }

  return out;
}

// Center of an element's bounding box.
function center(e: El): { x: number; y: number } {
  const r = bbox(e);
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

// Bounding box enclosing a set of elements.
function unionBbox(els: El[]): Rect {
  const rs = els.map(bbox);
  const minX = Math.min(...rs.map((r) => r.x));
  const minY = Math.min(...rs.map((r) => r.y));
  const maxX = Math.max(...rs.map((r) => r.x + r.w));
  const maxY = Math.max(...rs.map((r) => r.y + r.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// Ids of elements that sit off-canvas. The rule is cluster-anchored and
// asymmetric: instead of a symmetric nearest-neighbour gap (which mis-fires on
// a 2-element scene by flagging BOTH boxes, and only catches extreme outliers),
// we pick a SINGLE outlier candidate and measure it against the cluster of all
// the OTHER elements. The candidate is the element farthest from the centroid
// of the rest (so removing it leaves the others tightest); ties (e.g. a
// 2-element scene) break toward the element farther from the origin, since
// diagrams are authored starting near (0,0). The candidate is flagged only when
// its bbox sits more than OFF_CANVAS_GAP from the bounding box of the rest, so
// the fix pulls only the outlier back and never drags the in-bounds elements.
function offCanvasIds(els: El[]): string[] {
  const real = els.filter((e) => e.id !== "darkbg" && e.type !== "text");
  if (real.length < 2) return [];

  // distance from each element to the centroid of all the OTHER real elements
  const distToRest = (e: El): number => {
    const rest = real.filter((o) => o.id !== e.id);
    const sx = rest.reduce((s, o) => s + center(o).x, 0) / rest.length;
    const sy = rest.reduce((s, o) => s + center(o).y, 0) / rest.length;
    const c = center(e);
    return Math.hypot(c.x - sx, c.y - sy);
  };
  const fromOrigin = (e: El): number => {
    const c = center(e);
    return Math.hypot(c.x, c.y);
  };

  // Pick the single outlier candidate; break ties by distance from origin.
  let candidate = real[0];
  let worst = -Infinity;
  for (const e of real) {
    const d = distToRest(e);
    if (d > worst || (d === worst && fromOrigin(e) > fromOrigin(candidate))) {
      worst = d;
      candidate = e;
    }
  }

  // Flag it only if it is genuinely detached from the rest of the diagram.
  const rest = real.filter((e) => e.id !== candidate.id);
  if (gap(bbox(candidate), unionBbox(rest)) > OFF_CANVAS_GAP) {
    return [candidate.id];
  }
  return [];
}

// Center of an element's nearest neighbour, used to pull an off-canvas element
// back beside the rest of the diagram.
function nearestNeighbour(els: El[], e: El): El | null {
  const real = els.filter((o) => o.id !== "darkbg" && o.type !== "text" && o.id !== e.id);
  let best: El | null = null;
  let bestGap = Infinity;
  for (const o of real) {
    const g = gap(bbox(e), bbox(o));
    if (g < bestGap) {
      bestGap = g;
      best = o;
    }
  }
  return best;
}

// ---- mechanical auto-fix ----

const isMechanical = (v: Violation) => !STRUCTURAL.includes(v.type);

// Apply one mechanical fix in place on a cloned element list. Returns true if a
// fix was applied. Each fix targets the geometry the corresponding check reads.
function applyFix(els: El[], v: Violation): boolean {
  const byId = (id: string) => els.find((e) => e.id === id);
  switch (v.type) {
    case "label-wider-than-box": {
      // widen the box (and re-center its label) to fit the label
      const box = byId(v.ids[0]);
      if (!box) return false;
      const label = els.find((e) => e.type === "text" && e.containerId === box.id);
      if (!label) return false;
      const pad = 10;
      const newW = (label.width ?? 0) + pad * 2;
      box.x = box.x - (newW - (box.width ?? 0)) / 2; // grow around the center
      box.width = newW;
      label.x = box.x + (box.width - (label.width ?? 0)) / 2;
      return true;
    }
    case "off-canvas": {
      // pull the flung-away element back to sit just to the right of its
      // nearest neighbour, with the minimum spacing gap.
      const e = byId(v.ids[0]);
      if (!e) return false;
      const nb = nearestNeighbour(els, e);
      if (!nb) return false;
      const rn = bbox(nb);
      const re = bbox(e);
      const targetX = rn.x + rn.w + MIN_SPACING + 1;
      const targetY = rn.y;
      moveElement(els, e, targetX - re.x, targetY - re.y);
      return true;
    }
    case "spacing-too-close": {
      // push the second box away from the first to restore minimum spacing
      const a = byId(v.ids[0]);
      const b = byId(v.ids[1]);
      if (!a || !b) return false;
      const ra = bbox(a);
      const rb = bbox(b);
      const ca = { x: ra.x + ra.w / 2, y: ra.y + ra.h / 2 };
      const cb = { x: rb.x + rb.w / 2, y: rb.y + rb.h / 2 };
      // push along the dominant axis of separation
      if (Math.abs(cb.x - ca.x) >= Math.abs(cb.y - ca.y)) {
        const dir = cb.x >= ca.x ? 1 : -1;
        const overlapGap = MIN_SPACING - gap(ra, rb);
        moveElement(els, b, dir * (overlapGap + 1), 0);
      } else {
        const dir = cb.y >= ca.y ? 1 : -1;
        const overlapGap = MIN_SPACING - gap(ra, rb);
        moveElement(els, b, 0, dir * (overlapGap + 1));
      }
      return true;
    }
    default:
      return false;
  }
}

// Move an element by (dx,dy), carrying its bound label along.
function moveElement(els: El[], e: El, dx: number, dy: number): void {
  e.x += dx;
  e.y += dy;
  const label = els.find((o) => o.type === "text" && o.containerId === e.id);
  if (label) {
    label.x += dx;
    label.y += dy;
  }
}

function clone(els: El[]): El[] {
  return els.map((e) => ({ ...e, points: e.points ? e.points.map((p: number[]) => [...p]) : e.points }));
}

// Iteratively fix mechanical violations until none remain or we stop making
// progress. Structural violations are left untouched.
function autoFix(original: El[]): El[] {
  let els = clone(original);
  for (let pass = 0; pass < 50; pass++) {
    const mech = detect(els).filter(isMechanical);
    if (mech.length === 0) break;
    let progressed = false;
    for (const v of mech) progressed = applyFix(els, v) || progressed;
    if (!progressed) break;
  }
  return els;
}

// ---- public API ----

export function checkGeometry(input: { elements?: El[] } | El[]): GeometryResult {
  const original = elements(input);
  const violations = detect(original);

  const fixed = autoFix(original);
  const afterFix = detect(fixed);

  // `remaining` lists EVERY violation still standing after the auto-fix, not
  // just structural ones. Structural violations are never auto-fixed so they
  // always appear here (that invariant is relied on by AC3/AC4). A mechanical
  // violation only survives if the fix loop could not clear it (e.g. it hit the
  // 50-pass cap); surfacing it too means `remaining` always explains why `ok`
  // is false, instead of silently dropping an unresolved mechanical issue.
  const remaining = afterFix;

  // ok only when the fixed scene has NO violation of any kind left standing.
  return {
    ok: afterFix.length === 0,
    violations,
    fixed,
    remaining,
  };
}
