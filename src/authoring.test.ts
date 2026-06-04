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

// Issue #9: bound labels must not carry a hand-computed 0.55-derived width
describe("bound-label width is NOT the 0.55 heuristic", () => {
  test("labeledRect bound text width is 0 (not length*fontSize*0.55)", () => {
    const s = scene();
    const label = "Hello World";
    const fontSize = 16;
    s.labeledRect("box1", 0, 0, 200, 80, PALETTE.light.blue, label, fontSize);
    const { elements } = s.build();
    const textEl = elements.find((e) => e.id === "box1_t");
    expect(textEl).toBeDefined();
    // 0.55-derived width: 11 * 16 * 0.55 = 96.8
    const derivedWidth = label.length * fontSize * 0.55;
    expect(textEl!.width).not.toBeCloseTo(derivedWidth, 0);
    expect(textEl!.width).toBe(0);
  });

  test("arrow label bound text width is 0 (not length*fontSize*0.55)", () => {
    const s = scene();
    const label = "calls";
    s.arrow("a1", 0, 0, [[0, 0], [100, 0]], "#000000", label);
    const { elements } = s.build();
    const textEl = elements.find((e) => e.id === "a1_t");
    expect(textEl).toBeDefined();
    // 0.55-derived width: 5 * 14 * 0.55 = 38.5
    const derivedWidth = label.length * 14 * 0.55;
    expect(textEl!.width).not.toBeCloseTo(derivedWidth, 0);
    expect(textEl!.width).toBe(0);
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
});
