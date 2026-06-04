// Multiline bound-text geometry. Pure, no IO.
//
// Excalidraw renders a container's bound label from a canvas sized by the text
// element's own `height`. The authoring path only ever stored a single-line
// height (fontSize × lineHeight), so a label with explicit "\n" newlines had a
// canvas half as tall as its content and every line past the first was clipped
// (issue #25). This module measures the real line count, sets the correct text
// height, recenters the label in its container, and grows the container when the
// text would overflow — matching Excalidraw's own redrawTextBoundingBox rules.

import type { El } from "./scene-types";

// Excalidraw's default line height for the hand-drawn font family.
export const LINE_HEIGHT = 1.25;
// Excalidraw's BOUND_TEXT_PADDING: a rectangle's usable inner height is
// container.height − PADDING × 2 (see computeContainerDimensionForBoundText).
export const BOUND_TEXT_PADDING = 5;

/** Number of rendered lines in a label (split on explicit newlines). */
export function lineCount(text: string): number {
  return text.length === 0 ? 1 : text.split("\n").length;
}

/** Rendered height of a label: lines × fontSize × lineHeight. */
export function measuredTextHeight(text: string, fontSize: number, lineHeight = LINE_HEIGHT): number {
  return lineCount(text) * fontSize * lineHeight;
}

/**
 * Return a copy of `elements` in which every container-bound text label has the
 * correct multiline geometry. Pure: the input array and its elements are not
 * mutated. Standalone text and arrow-bound labels are left untouched.
 */
export function normalizeBoundTextHeights(elements: El[]): El[] {
  const byId = new Map(elements.map((e) => [e.id, e]));

  // Pass 1: for each non-arrow container with a bound label, compute the label's
  // measured height and grow the container if its usable inner height (height −
  // padding × 2) cannot hold the text. Records the final container height so the
  // label can be recentered against it in pass 2.
  const containerHeights = new Map<string, number>();
  for (const e of elements) {
    if (e.type !== "text" || e.containerId == null) continue;
    const container = byId.get(e.containerId);
    if (!container || container.type === "arrow") continue;
    const textHeight = measuredTextHeight(e.text ?? "", e.fontSize ?? 16, e.lineHeight ?? LINE_HEIGHT);
    const usable = container.height - BOUND_TEXT_PADDING * 2;
    const grown = textHeight > usable ? textHeight + BOUND_TEXT_PADDING * 2 : container.height;
    containerHeights.set(container.id, grown);
  }

  // Pass 2: apply grown container heights and set each bound label's height and
  // recentered y. Both the input array and its elements stay untouched (pure).
  return elements.map((e) => {
    if (containerHeights.has(e.id)) {
      return { ...e, height: containerHeights.get(e.id)! };
    }
    if (e.type !== "text" || e.containerId == null) return e;
    const container = byId.get(e.containerId);
    if (!container || container.type === "arrow") return e;

    const height = measuredTextHeight(e.text ?? "", e.fontSize ?? 16, e.lineHeight ?? LINE_HEIGHT);
    const containerHeight = containerHeights.get(container.id) ?? container.height;
    const y = container.y + (containerHeight - height) / 2;
    return { ...e, height, y };
  });
}
