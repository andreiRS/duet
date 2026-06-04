import { describe, it, expect } from "bun:test";
import { measuredTextHeight, normalizeBoundTextHeights } from "./bound-text";
import type { El } from "./scene-types";

describe("measuredTextHeight", () => {
  it("measures a two-line label as two lines tall", () => {
    // fontSize 18, lineHeight 1.25 → one line is 22.5, two lines is 45.
    expect(measuredTextHeight("Your App\n(REST calls)", 18)).toBe(45);
  });
});

// A rectangle container + its bound two-line label, mirroring the clipped
// geometry seen in messaging-architecture.excalidraw: text height stored as a
// single line (22.5) while the label has two lines.
function clippedScene(): El[] {
  return [
    { id: "box", type: "rectangle", x: 100, y: 120, width: 200, height: 80 },
    {
      id: "box_t",
      type: "text",
      x: 110,
      y: 151,
      width: 180,
      height: 22.5,
      text: "Your App\n(REST calls)",
      fontSize: 18,
      lineHeight: 1.25,
      verticalAlign: "middle",
      containerId: "box",
    },
  ];
}

describe("normalizeBoundTextHeights", () => {
  it("sets a two-line bound label's height to the measured multiline height", () => {
    const out = normalizeBoundTextHeights(clippedScene());
    const label = out.find((e: El) => e.id === "box_t")!;
    expect(label.height).toBe(45);
  });

  it("recenters the label vertically within its container", () => {
    const out = normalizeBoundTextHeights(clippedScene());
    const label = out.find((e: El) => e.id === "box_t")!;
    // box y=120 h=80, text h=45 → centered y = 120 + (80 − 45) / 2 = 137.5
    expect(label.y).toBe(137.5);
  });

  it("grows a too-short container so the label fits with padding", () => {
    const els: El[] = [
      { id: "box", type: "rectangle", x: 0, y: 0, width: 200, height: 40 },
      {
        id: "box_t",
        type: "text",
        x: 10,
        y: 9,
        width: 180,
        height: 22.5,
        text: "Line one\nLine two",
        fontSize: 18,
        lineHeight: 1.25,
        verticalAlign: "middle",
        containerId: "box",
      },
    ];
    const out = normalizeBoundTextHeights(els);
    const box = out.find((e: El) => e.id === "box")!;
    // usable inner height was 40 − 10 = 30 < 45, so grow to 45 + padding(10) = 55
    expect(box.height).toBe(55);
  });

  it("leaves an already-correct single-line label unchanged", () => {
    const els: El[] = [
      { id: "box", type: "rectangle", x: 0, y: 0, width: 200, height: 80 },
      {
        id: "box_t",
        type: "text",
        x: 10,
        y: 28.75, // already centered: 0 + (80 − 22.5) / 2
        width: 180,
        height: 22.5, // already one line: 18 × 1.25
        text: "One line",
        fontSize: 18,
        lineHeight: 1.25,
        verticalAlign: "middle",
        containerId: "box",
      },
    ];
    const out = normalizeBoundTextHeights(els);
    expect(out.find((e: El) => e.id === "box_t")).toEqual(els[1]);
  });

  it("leaves a standalone (non-bound) text element untouched", () => {
    const els: El[] = [
      { id: "t1", type: "text", x: 5, y: 5, width: 100, height: 22.5, text: "free\nstanding", fontSize: 18 },
    ];
    const out = normalizeBoundTextHeights(els);
    expect(out[0]).toEqual(els[0]);
  });

  it("does not mutate the input elements", () => {
    const els = clippedScene();
    const before = JSON.parse(JSON.stringify(els));
    normalizeBoundTextHeights(els);
    expect(els).toEqual(before);
  });
});
