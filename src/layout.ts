// Pure geometry layout helpers. No IO, no dependencies.
//
// bbox({ x, y, w, h }) — union bounding box of a SET of elements.
//   Handles rectangles (x/y/width/height) and points-based elements (arrows).
//   Returns { x, y, w, h } where x/y is top-left corner.
//
// centerX(els, coord) — shift every element in els so the set's bbox center-x
//   lands on coord. Returns els for chaining.
//
// centerY(els, coord) — shift every element in els so the set's bbox center-y
//   lands on coord. Returns els for chaining.
//
// Callers must pass EVERY element they want moved (e.g. a box AND its bound
// label together), since these helpers translate whatever they receive.

import type { El } from "./scene-types.ts";

export interface Bbox {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Bounding box of a single element (rect via x/width, arrow via point offsets).
function elBbox(e: El): Bbox {
  if (e.points) {
    const xs = (e.points as number[][]).map((p) => e.x + p[0]);
    const ys = (e.points as number[][]).map((p) => e.y + p[1]);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
  }
  return { x: e.x, y: e.y, w: e.width ?? 0, h: e.height ?? 0 };
}

/** Union bounding box of a set of elements. */
export function bbox(els: El[]): Bbox {
  const boxes = els.map(elBbox);
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.w));
  const maxY = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Shift every element in els along the x-axis so the set's collective bbox
 * center-x lands on coord. Returns els for chaining.
 */
export function centerX(els: El[], coord: number): El[] {
  const b = bbox(els);
  const currentCenterX = b.x + b.w / 2;
  const dx = coord - currentCenterX;
  for (const e of els) {
    e.x += dx;
  }
  return els;
}

/**
 * Shift every element in els along the y-axis so the set's collective bbox
 * center-y lands on coord. Returns els for chaining.
 */
export function centerY(els: El[], coord: number): El[] {
  const b = bbox(els);
  const currentCenterY = b.y + b.h / 2;
  const dy = coord - currentCenterY;
  for (const e of els) {
    e.y += dy;
  }
  return els;
}
