import { describe, expect, test } from "bun:test";
import { scene, PALETTE } from "./authoring.ts";

const blue = PALETTE.light.blue;
const green = PALETTE.light.green;

// AC1: binding fields exist and point at the correct element ids
describe("AC1: connect() binding fields exist and reference the box ids", () => {
  test("arrow has startBinding with elementId = fromBox id", () => {
    const s = scene();
    s.labeledRect("box_a", 0, 0, 100, 60, blue, "A", 14);
    s.labeledRect("box_b", 300, 0, 100, 60, green, "B", 14);
    s.connect("arr1", "box_a", "box_b");
    const { elements } = s.build();
    const arrow = elements.find((e) => e.id === "arr1");
    expect(arrow).toBeDefined();
    expect(arrow!.startBinding).not.toBeNull();
    expect(arrow!.startBinding.elementId).toBe("box_a");
  });

  test("arrow has endBinding with elementId = toBox id", () => {
    const s = scene();
    s.labeledRect("box_a", 0, 0, 100, 60, blue, "A", 14);
    s.labeledRect("box_b", 300, 0, 100, 60, green, "B", 14);
    s.connect("arr1", "box_a", "box_b");
    const { elements } = s.build();
    const arrow = elements.find((e) => e.id === "arr1");
    expect(arrow!.endBinding).not.toBeNull();
    expect(arrow!.endBinding.elementId).toBe("box_b");
  });

  test("startBinding contains focus, gap, and fixedPoint fields", () => {
    const s = scene();
    s.labeledRect("box_a", 0, 0, 100, 60, blue, "A", 14);
    s.labeledRect("box_b", 300, 0, 100, 60, green, "B", 14);
    s.connect("arr1", "box_a", "box_b");
    const { elements } = s.build();
    const arrow = elements.find((e) => e.id === "arr1");
    const sb = arrow!.startBinding;
    expect(typeof sb.focus).toBe("number");
    expect(typeof sb.gap).toBe("number");
    expect(Array.isArray(sb.fixedPoint)).toBe(true);
    expect(sb.fixedPoint).toHaveLength(2);
  });

  test("endBinding contains focus, gap, and fixedPoint fields", () => {
    const s = scene();
    s.labeledRect("box_a", 0, 0, 100, 60, blue, "A", 14);
    s.labeledRect("box_b", 300, 0, 100, 60, green, "B", 14);
    s.connect("arr1", "box_a", "box_b");
    const { elements } = s.build();
    const arrow = elements.find((e) => e.id === "arr1");
    const eb = arrow!.endBinding;
    expect(typeof eb.focus).toBe("number");
    expect(typeof eb.gap).toBe("number");
    expect(Array.isArray(eb.fixedPoint)).toBe(true);
    expect(eb.fixedPoint).toHaveLength(2);
  });
});

// AC2: edge-pick algorithm — dominant axis determines which edges face each other
describe("AC2: correct edge picked for common relative positions", () => {
  test("target to the RIGHT: start=right edge [1,0.5], end=left edge [0,0.5]", () => {
    const s = scene();
    // box_a at x=0, box_b at x=300 → horizontal dominates, b is to the right
    s.labeledRect("box_a", 0, 0, 100, 60, blue, "A", 14);
    s.labeledRect("box_b", 300, 0, 100, 60, green, "B", 14);
    s.connect("arr1", "box_a", "box_b");
    const { elements } = s.build();
    const arrow = elements.find((e) => e.id === "arr1");
    expect(arrow!.startBinding.fixedPoint).toEqual([1, 0.5]);
    expect(arrow!.endBinding.fixedPoint).toEqual([0, 0.5]);
  });

  test("target to the LEFT: start=left edge [0,0.5], end=right edge [1,0.5]", () => {
    const s = scene();
    // box_a at x=300, box_b at x=0 → b is to the left
    s.labeledRect("box_a", 300, 0, 100, 60, blue, "A", 14);
    s.labeledRect("box_b", 0, 0, 100, 60, green, "B", 14);
    s.connect("arr1", "box_a", "box_b");
    const { elements } = s.build();
    const arrow = elements.find((e) => e.id === "arr1");
    expect(arrow!.startBinding.fixedPoint).toEqual([0, 0.5]);
    expect(arrow!.endBinding.fixedPoint).toEqual([1, 0.5]);
  });

  test("target BELOW: start=bottom edge [0.5,1], end=top edge [0.5,0]", () => {
    const s = scene();
    // box_a at y=0, box_b at y=300 → vertical dominates, b is below
    s.labeledRect("box_a", 0, 0, 100, 60, blue, "A", 14);
    s.labeledRect("box_b", 0, 300, 100, 60, green, "B", 14);
    s.connect("arr1", "box_a", "box_b");
    const { elements } = s.build();
    const arrow = elements.find((e) => e.id === "arr1");
    expect(arrow!.startBinding.fixedPoint).toEqual([0.5, 1]);
    expect(arrow!.endBinding.fixedPoint).toEqual([0.5, 0]);
  });

  test("target ABOVE: start=top edge [0.5,0], end=bottom edge [0.5,1]", () => {
    const s = scene();
    // box_a at y=300, box_b at y=0 → b is above
    s.labeledRect("box_a", 0, 300, 100, 60, blue, "A", 14);
    s.labeledRect("box_b", 0, 0, 100, 60, green, "B", 14);
    s.connect("arr1", "box_a", "box_b");
    const { elements } = s.build();
    const arrow = elements.find((e) => e.id === "arr1");
    expect(arrow!.startBinding.fixedPoint).toEqual([0.5, 0]);
    expect(arrow!.endBinding.fixedPoint).toEqual([0.5, 1]);
  });
});

// AC3: saved JSON carries startBinding/endBinding with elementId + fixedPoint
describe("AC3: saved JSON structure", () => {
  test("build() includes the arrow with correct binding structure", () => {
    const s = scene();
    s.labeledRect("box_a", 0, 0, 100, 60, blue, "A", 14);
    s.labeledRect("box_b", 300, 0, 100, 60, green, "B", 14);
    s.connect("arr1", "box_a", "box_b");
    const scene_json = s.build();
    const arrow = scene_json.elements.find((e) => e.id === "arr1");
    expect(arrow).toBeDefined();
    // startBinding
    expect(arrow!.startBinding).toMatchObject({
      elementId: "box_a",
      fixedPoint: expect.arrayContaining([expect.any(Number), expect.any(Number)]),
      focus: expect.any(Number),
      gap: expect.any(Number),
    });
    // endBinding
    expect(arrow!.endBinding).toMatchObject({
      elementId: "box_b",
      fixedPoint: expect.arrayContaining([expect.any(Number), expect.any(Number)]),
      focus: expect.any(Number),
      gap: expect.any(Number),
    });
  });

  test("arrow element carries required base fields (type, x, y, width, height, points)", () => {
    const s = scene();
    s.labeledRect("box_a", 0, 0, 100, 60, blue, "A", 14);
    s.labeledRect("box_b", 300, 0, 100, 60, green, "B", 14);
    s.connect("arr1", "box_a", "box_b");
    const { elements } = s.build();
    const arrow = elements.find((e) => e.id === "arr1");
    expect(arrow!.type).toBe("arrow");
    expect(typeof arrow!.x).toBe("number");
    expect(typeof arrow!.y).toBe("number");
    expect(typeof arrow!.width).toBe("number");
    expect(typeof arrow!.height).toBe("number");
    expect(Array.isArray(arrow!.points)).toBe(true);
  });
});

// AC4: bidirectional references — boxes get the arrow in their boundElements
describe("AC4: boxes reference the arrow in their boundElements", () => {
  test("source box boundElements includes the arrow id with type 'arrow'", () => {
    const s = scene();
    s.labeledRect("box_a", 0, 0, 100, 60, blue, "A", 14);
    s.labeledRect("box_b", 300, 0, 100, 60, green, "B", 14);
    s.connect("arr1", "box_a", "box_b");
    const { elements } = s.build();
    const boxA = elements.find((e) => e.id === "box_a");
    const bounds = boxA!.boundElements as Array<{ type: string; id: string }>;
    expect(bounds.some((b) => b.type === "arrow" && b.id === "arr1")).toBe(true);
  });

  test("target box boundElements includes the arrow id with type 'arrow'", () => {
    const s = scene();
    s.labeledRect("box_a", 0, 0, 100, 60, blue, "A", 14);
    s.labeledRect("box_b", 300, 0, 100, 60, green, "B", 14);
    s.connect("arr1", "box_a", "box_b");
    const { elements } = s.build();
    const boxB = elements.find((e) => e.id === "box_b");
    const bounds = boxB!.boundElements as Array<{ type: string; id: string }>;
    expect(bounds.some((b) => b.type === "arrow" && b.id === "arr1")).toBe(true);
  });

  test("source box still has its original text boundElement after connect()", () => {
    const s = scene();
    s.labeledRect("box_a", 0, 0, 100, 60, blue, "A", 14);
    s.labeledRect("box_b", 300, 0, 100, 60, green, "B", 14);
    s.connect("arr1", "box_a", "box_b");
    const { elements } = s.build();
    const boxA = elements.find((e) => e.id === "box_a");
    const bounds = boxA!.boundElements as Array<{ type: string; id: string }>;
    // the text binding must still be there
    expect(bounds.some((b) => b.type === "text" && b.id === "box_a_t")).toBe(true);
  });

  test("existing arrow() call with null bindings still works (no regression)", () => {
    const s = scene();
    s.arrow("a1", 0, 0, [[0, 0], [50, 0]]);
    const { elements } = s.build();
    const arrow = elements.find((e) => e.id === "a1");
    expect(arrow!.startBinding).toBeNull();
    expect(arrow!.endBinding).toBeNull();
  });

  test("optional label on connect() arrow works", () => {
    const s = scene();
    s.labeledRect("box_a", 0, 0, 100, 60, blue, "A", 14);
    s.labeledRect("box_b", 300, 0, 100, 60, green, "B", 14);
    s.connect("arr1", "box_a", "box_b", { label: "calls" });
    const { elements } = s.build();
    const label = elements.find((e) => e.id === "arr1_t");
    expect(label).toBeDefined();
    expect(label!.type).toBe("text");
  });
});

// AC5: error path — missing box
describe("AC5: connect() throws when a box id is not found", () => {
  test("throws when fromBoxId does not exist", () => {
    const s = scene();
    s.labeledRect("box_b", 300, 0, 100, 60, green, "B", 14);
    expect(() => s.connect("arr1", "no_such_box", "box_b")).toThrow(
      "connect: box not found",
    );
  });

  test("throws when toBoxId does not exist", () => {
    const s = scene();
    s.labeledRect("box_a", 0, 0, 100, 60, blue, "A", 14);
    expect(() => s.connect("arr1", "box_a", "no_such_box")).toThrow(
      "connect: box not found",
    );
  });
});

// AC6: tie-break — dx == dy uses horizontal branch
describe("AC6: diagonal tie-break (dx == dy) uses horizontal branch", () => {
  test("equal diagonal offset → start=[1,0.5], end=[0,0.5]", () => {
    const s = scene();
    // box_a center at (50, 30), box_b center at (350, 330) → dx=300, dy=300
    s.labeledRect("box_a", 0, 0, 100, 60, blue, "A", 14);
    s.labeledRect("box_b", 300, 300, 100, 60, green, "B", 14);
    s.connect("arr1", "box_a", "box_b");
    const { elements } = s.build();
    const arrow = elements.find((e) => e.id === "arr1");
    expect(arrow!.startBinding.fixedPoint).toEqual([1, 0.5]);
    expect(arrow!.endBinding.fixedPoint).toEqual([0, 0.5]);
  });
});
