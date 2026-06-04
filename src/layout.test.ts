// Tests for layout helpers: bbox, centerX, centerY, pipeline
import { describe, expect, test } from "bun:test";
import { bbox, centerX, centerY } from "./layout.ts";
import { scene, PALETTE } from "./authoring.ts";
import type { El } from "./scene-types.ts";

// Helper: build a minimal rectangle element
function rect(id: string, x: number, y: number, w: number, h: number): El {
  return { id, type: "rectangle", x, y, width: w, height: h };
}

// Helper: build a minimal arrow element with points
function arrow(id: string, x: number, y: number, pts: number[][]): El {
  return { id, type: "arrow", x, y, points: pts };
}

// ---- Behavior 1: bbox(els) union bounding box ----

describe("bbox: union bounding box of a set of elements", () => {
  test("single rectangle returns its own bounds", () => {
    const els = [rect("a", 10, 20, 100, 50)];
    expect(bbox(els)).toEqual({ x: 10, y: 20, w: 100, h: 50 });
  });

  test("two side-by-side rectangles span both", () => {
    const els = [rect("a", 0, 0, 100, 60), rect("b", 200, 0, 100, 60)];
    expect(bbox(els)).toEqual({ x: 0, y: 0, w: 300, h: 60 });
  });

  test("overlapping rectangles returns tight union", () => {
    const els = [rect("a", 0, 0, 100, 100), rect("b", 50, 50, 100, 100)];
    expect(bbox(els)).toEqual({ x: 0, y: 0, w: 150, h: 150 });
  });

  test("points-based arrow is included in union", () => {
    // arrow at (0,0) with points to (200, 0) => covers x:0..200, y:0
    const els = [rect("box", 0, 0, 100, 60), arrow("arr", 100, 30, [[0, 0], [100, 0]])];
    // box: x0..100, y0..60  arrow: x100..200, y30..30
    expect(bbox(els)).toEqual({ x: 0, y: 0, w: 200, h: 60 });
  });

  test("mixed set: two rects and an arrow", () => {
    const els = [
      rect("a", 10, 10, 80, 40),
      rect("b", 150, 20, 80, 40),
      arrow("arr", 90, 30, [[0, 0], [60, 0]]),
    ];
    // a: x10..90, y10..50
    // b: x150..230, y20..60
    // arr: x90..150, y30..30
    expect(bbox(els)).toEqual({ x: 10, y: 10, w: 220, h: 50 });
  });
});

// ---- Behavior 2: centerX / centerY ----

describe("centerX: shift set so bbox center-x lands on coord", () => {
  test("single rect: centerX moves it so center is at coord", () => {
    // rect at x=0, w=100 => center=50; centering at 200 => shift by 150
    const els = [rect("a", 0, 0, 100, 60)];
    const result = centerX(els, 200);
    expect(result).toBe(els); // returns same array for chaining
    expect(els[0].x).toBe(150); // center was 50, target 200, shift +150
    expect(bbox(els)).toMatchObject({ x: 150, w: 100 });
    // verify center is now 200
    const b = bbox(els);
    expect(b.x + b.w / 2).toBe(200);
  });

  test("two rects: set center-x is repositioned", () => {
    // two rects: x=0,w=100 and x=200,w=100 => union x=0,w=300, center=150
    const els = [rect("a", 0, 0, 100, 60), rect("b", 200, 0, 100, 60)];
    centerX(els, 0);
    const b = bbox(els);
    expect(b.x + b.w / 2).toBe(0);
    // both moved by same dx
    expect(els[0].x).toBe(-150);
    expect(els[1].x).toBe(50);
  });

  test("centerX does not change y", () => {
    const els = [rect("a", 0, 50, 100, 60)];
    centerX(els, 500);
    expect(els[0].y).toBe(50);
  });
});

describe("centerY: shift set so bbox center-y lands on coord", () => {
  test("single rect: centerY moves it so center is at coord", () => {
    // rect at y=0, h=60 => center=30; centering at 100 => shift by 70
    const els = [rect("a", 0, 0, 100, 60)];
    const result = centerY(els, 100);
    expect(result).toBe(els); // returns same array
    const b = bbox(els);
    expect(b.y + b.h / 2).toBe(100);
    expect(els[0].y).toBe(70);
  });

  test("two rects stacked: set center-y is repositioned", () => {
    const els = [rect("a", 0, 0, 100, 60), rect("b", 0, 100, 100, 60)];
    // union: y=0, h=160, center=80; target=0 => shift by -80
    centerY(els, 0);
    const b = bbox(els);
    expect(b.y + b.h / 2).toBe(0);
    expect(els[0].y).toBe(-80);
    expect(els[1].y).toBe(20);
  });

  test("centerY does not change x", () => {
    const els = [rect("a", 50, 0, 100, 60)];
    centerY(els, 500);
    expect(els[0].x).toBe(50);
  });
});

// ---- Behavior 3: pipeline() verb ----

const blue = PALETTE.light.blue;

describe("pipeline: N evenly-spaced labeled boxes with bound connecting arrows", () => {
  test("creates N boxes for N labels", () => {
    const s = scene();
    s.pipeline(["A", "B", "C"]);
    const { elements } = s.build();
    const boxes = elements.filter((e) => e.type === "rectangle" && e.id.startsWith("pipe_"));
    expect(boxes).toHaveLength(3);
  });

  test("creates N-1 arrows for N labels", () => {
    const s = scene();
    s.pipeline(["A", "B", "C"]);
    const { elements } = s.build();
    const arrows = elements.filter((e) => e.type === "arrow");
    expect(arrows).toHaveLength(2);
  });

  test("boxes are at evenly-spaced x positions (default: gap=40, w=120)", () => {
    const s = scene();
    // default: startX=0, boxW=120, gap=40 => step=160
    s.pipeline(["A", "B", "C"]);
    const { elements } = s.build();
    const boxes = elements
      .filter((e) => e.type === "rectangle" && e.id.startsWith("pipe_"))
      .sort((a, b) => a.x - b.x);
    expect(boxes[0].x).toBe(0);
    expect(boxes[1].x).toBe(160); // 0 + 120 + 40
    expect(boxes[2].x).toBe(320); // 160 + 120 + 40
  });

  test("each arrow has startBinding and endBinding (bound arrows, not free)", () => {
    const s = scene();
    s.pipeline(["A", "B"]);
    const { elements } = s.build();
    const arrows = elements.filter((e) => e.type === "arrow");
    for (const a of arrows) {
      expect(a.startBinding).not.toBeNull();
      expect(a.endBinding).not.toBeNull();
      expect(a.startBinding.elementId).toBeTruthy();
      expect(a.endBinding.elementId).toBeTruthy();
    }
  });

  test("arrow connects adjacent boxes (startBinding.elementId = box[i], endBinding = box[i+1])", () => {
    const s = scene();
    s.pipeline(["A", "B", "C"]);
    const { elements } = s.build();
    // boxes are named pipe_0, pipe_1, pipe_2
    const arrows = elements.filter((e) => e.type === "arrow").sort((a, b) => a.x - b.x);
    expect(arrows[0].startBinding.elementId).toBe("pipe_0");
    expect(arrows[0].endBinding.elementId).toBe("pipe_1");
    expect(arrows[1].startBinding.elementId).toBe("pipe_1");
    expect(arrows[1].endBinding.elementId).toBe("pipe_2");
  });

  test("boxes carry bidirectional arrow references in boundElements", () => {
    const s = scene();
    s.pipeline(["A", "B"]);
    const { elements } = s.build();
    const box0 = elements.find((e) => e.id === "pipe_0");
    const box1 = elements.find((e) => e.id === "pipe_1");
    // box0 should have the arrow in its boundElements
    expect(box0!.boundElements.some((b: El) => b.type === "arrow")).toBe(true);
    // box1 should have the arrow too
    expect(box1!.boundElements.some((b: El) => b.type === "arrow")).toBe(true);
  });

  test("pipeline accepts custom opts: startX, startY, boxW, boxH, gap", () => {
    const s = scene();
    s.pipeline(["X", "Y"], { startX: 50, startY: 100, boxW: 80, boxH: 40, gap: 20 });
    const { elements } = s.build();
    const boxes = elements
      .filter((e) => e.type === "rectangle" && e.id.startsWith("pipe_"))
      .sort((a, b) => a.x - b.x);
    expect(boxes[0].x).toBe(50);
    expect(boxes[0].y).toBe(100);
    expect(boxes[0].width).toBe(80);
    expect(boxes[0].height).toBe(40);
    expect(boxes[1].x).toBe(150); // 50 + 80 + 20
  });

  test("pipeline accepts custom idPrefix", () => {
    const s = scene();
    s.pipeline(["P", "Q"], { idPrefix: "step" });
    const { elements } = s.build();
    const boxes = elements.filter((e) => e.type === "rectangle" && e.id.startsWith("step_"));
    expect(boxes).toHaveLength(2);
  });

  test("single label: one box, zero arrows", () => {
    const s = scene();
    s.pipeline(["Solo"]);
    const { elements } = s.build();
    const boxes = elements.filter((e) => e.type === "rectangle" && e.id.startsWith("pipe_"));
    const arrows = elements.filter((e) => e.type === "arrow");
    expect(boxes).toHaveLength(1);
    expect(arrows).toHaveLength(0);
  });
});
