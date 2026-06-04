import { describe, expect, test } from "bun:test";
import { scene, PALETTE } from "./authoring.ts";

// AC2: labeledRect produces two bound elements
describe("labeledRect produces two bound elements", () => {
  test("produces exactly two elements", () => {
    const s = scene();
    s.labeledRect("box1", 0, 0, 100, 50, PALETTE.light.blue, "Label", 14);
    const { elements } = s.build();
    expect(elements.length).toBe(2);
  });

  test("first element is a rectangle with boundElements referencing the text", () => {
    const s = scene();
    s.labeledRect("box1", 0, 0, 100, 50, PALETTE.light.blue, "Label", 14);
    const { elements } = s.build();
    const rect = elements.find((e) => e.id === "box1");
    expect(rect).toBeDefined();
    expect(rect!.type).toBe("rectangle");
    expect(Array.isArray(rect!.boundElements)).toBe(true);
    const bounds = rect!.boundElements as Array<{ type: string; id: string }>;
    expect(bounds.length).toBe(1);
    expect(bounds[0].type).toBe("text");
    expect(bounds[0].id).toBe("box1_t");
  });

  test("second element is a text with containerId equal to the rect id", () => {
    const s = scene();
    s.labeledRect("box1", 0, 0, 100, 50, PALETTE.light.blue, "Label", 14);
    const { elements } = s.build();
    const textEl = elements.find((e) => e.id === "box1_t");
    expect(textEl).toBeDefined();
    expect(textEl!.type).toBe("text");
    expect(textEl!.containerId).toBe("box1");
  });
});

// AC3: element ids are deterministic — same inputs produce same ids every time
describe("element ids are deterministic", () => {
  test("box id matches what was passed in", () => {
    const s = scene();
    s.labeledRect("mybox", 0, 0, 100, 50, PALETTE.light.blue, "Label", 14);
    const { elements } = s.build();
    expect(elements.some((e) => e.id === "mybox")).toBe(true);
  });

  test("box label id is box id + '_t'", () => {
    const s = scene();
    s.labeledRect("mybox", 0, 0, 100, 50, PALETTE.light.blue, "Label", 14);
    const { elements } = s.build();
    expect(elements.some((e) => e.id === "mybox_t")).toBe(true);
  });

  test("arrow id matches what was passed in", () => {
    const s = scene();
    s.arrow("a1", 0, 0, [[0, 0], [50, 0]]);
    const { elements } = s.build();
    expect(elements.some((e) => e.id === "a1")).toBe(true);
  });

  test("arrow label id is arrow id + '_t' when label is provided", () => {
    const s = scene();
    s.arrow("a1", 0, 0, [[0, 0], [50, 0]], "#000000", "goes here");
    const { elements } = s.build();
    expect(elements.some((e) => e.id === "a1_t")).toBe(true);
  });

  test("same inputs produce identical ids on separate builds", () => {
    const build1 = () => {
      const s = scene();
      s.labeledRect("api", 10, 20, 120, 60, PALETTE.light.green, "API", 16);
      s.arrow("a1", 140, 50, [[0, 0], [60, 0]]);
      return s.build().elements.map((e) => e.id);
    };
    expect(build1()).toEqual(build1());
  });
});

// AC1: build() returns valid Excalidraw JSON with required fields
describe("build() returns valid Excalidraw JSON", () => {
  test("top-level shape is correct", () => {
    const s = scene();
    const out = s.build();
    expect(out.type).toBe("excalidraw");
    expect(typeof out.version).toBe("number");
    expect(typeof out.source).toBe("string");
    expect(Array.isArray(out.elements)).toBe(true);
    expect(out.appState).toBeDefined();
  });

  test("every element carries required Excalidraw fields", () => {
    const s = scene();
    s.labeledRect("box1", 0, 0, 100, 50, PALETTE.light.blue, "Hello", 14);
    const { elements } = s.build();
    const requiredFields = ["id", "type", "x", "y", "width", "height", "angle", "strokeColor", "fillStyle", "strokeWidth", "strokeStyle", "roughness", "opacity", "isDeleted", "version"];
    for (const el of elements) {
      for (const field of requiredFields) {
        expect(el).toHaveProperty(field);
      }
    }
  });
});

// Issue #14: bound labels must carry a non-zero width estimate (0.55 factor)
// so Excalidraw renders them as legible text instead of scrambled tiny glyphs.
describe("bound-label width uses 0.55 estimate (issue #14)", () => {
  test("labeledRect bound text width equals label.length * fontSize * 0.55", () => {
    const s = scene();
    const label = "Hello World";
    const fontSize = 16;
    s.labeledRect("box1", 0, 0, 200, 80, PALETTE.light.blue, label, fontSize);
    const { elements } = s.build();
    const textEl = elements.find((e) => e.id === "box1_t");
    expect(textEl).toBeDefined();
    const expectedWidth = label.length * fontSize * 0.55;
    expect(textEl!.width).toBeCloseTo(expectedWidth, 5);
  });

  test("labeledRect bound text x is centered in the box: x + (boxWidth - labelWidth) / 2", () => {
    const s = scene();
    const label = "Hello World";
    const fontSize = 16;
    const boxX = 50;
    const boxWidth = 200;
    s.labeledRect("box1", boxX, 0, boxWidth, 80, PALETTE.light.blue, label, fontSize);
    const { elements } = s.build();
    const textEl = elements.find((e) => e.id === "box1_t");
    expect(textEl).toBeDefined();
    const labelWidth = label.length * fontSize * 0.55;
    const expectedX = boxX + (boxWidth - labelWidth) / 2;
    expect(textEl!.x).toBeCloseTo(expectedX, 5);
  });

  test("arrow label bound text width equals label.length * 14 * 0.55", () => {
    const s = scene();
    const label = "calls";
    s.arrow("a1", 0, 0, [[0, 0], [100, 0]], "#000000", label);
    const { elements } = s.build();
    const textEl = elements.find((e) => e.id === "a1_t");
    expect(textEl).toBeDefined();
    const expectedWidth = label.length * 14 * 0.55;
    expect(textEl!.width).toBeCloseTo(expectedWidth, 5);
  });

  test("arrow label bound text x is centered on the arrow midpoint: midX - labelWidth / 2", () => {
    const s = scene();
    const label = "calls";
    // arrow from x=10 going to x=10+100=110; midX=60
    s.arrow("a1", 10, 0, [[0, 0], [100, 0]], "#000000", label);
    const { elements } = s.build();
    const textEl = elements.find((e) => e.id === "a1_t");
    expect(textEl).toBeDefined();
    const labelWidth = label.length * 14 * 0.55;
    const midX = 10 + (100 - 0) / 2; // x1 + (x2 - x1) / 2
    const expectedX = midX - labelWidth / 2;
    expect(textEl!.x).toBeCloseTo(expectedX, 5);
  });

  test("standalone text() KEEPS its 0.55-derived width (unchanged)", () => {
    const s = scene();
    const label = "standalone text";
    const fontSize = 14;
    s.text("t1", 0, 0, label, fontSize);
    const { elements } = s.build();
    const textEl = elements.find((e) => e.id === "t1");
    expect(textEl).toBeDefined();
    const derivedWidth = label.length * fontSize * 0.55;
    expect(textEl!.width).toBeCloseTo(derivedWidth, 0);
  });

  test("connect() label x is centered on the arrow's true midpoint", () => {
    // Two boxes side by side; connect draws a horizontal arrow from right edge
    // of box1 to left edge of box2.
    // box1: x=0, y=0, w=100, h=50  -> right edge center = (100, 25)
    // box2: x=200, y=0, w=100, h=50 -> left edge center  = (200, 25)
    // Arrow: startX=100, startY=25, endX=200, endY=25
    // midX = (100 + 200) / 2 = 150
    const s = scene();
    const label = "calls";
    s.labeledRect("box1", 0, 0, 100, 50, PALETTE.light.blue, "Box1", 14);
    s.labeledRect("box2", 200, 0, 100, 50, PALETTE.light.blue, "Box2", 14);
    s.connect("c1", "box1", "box2", { label });
    const { elements } = s.build();

    const arrowEl = elements.find((e) => e.id === "c1");
    expect(arrowEl).toBeDefined();

    // Compute midpoint from the arrow element's own geometry
    const pts = arrowEl!.points as number[][];
    const lastPt = pts[pts.length - 1];
    const startAbsX = arrowEl!.x as number;
    const startAbsY = arrowEl!.y as number;
    const endAbsX = startAbsX + lastPt[0];
    const endAbsY = startAbsY + lastPt[1];
    const midX = (startAbsX + endAbsX) / 2;

    const labelWidth = label.length * 14 * 0.55;
    const expectedX = midX - labelWidth / 2;

    const textEl = elements.find((e) => e.id === "c1_t");
    expect(textEl).toBeDefined();
    expect(textEl!.x).toBeCloseTo(expectedX, 5);
  });
});
