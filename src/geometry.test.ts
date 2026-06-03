import { describe, expect, test } from "bun:test";
import { scene, PALETTE } from "./authoring.ts";
import { checkGeometry } from "./geometry.ts";

const blue = PALETTE.light.blue;
const green = PALETTE.light.green;

// AC1: each check detects its violation on a crafted bad scene.
describe("AC1: detection", () => {
  test("detects a label wider than its box", () => {
    // labeledRect centers the bound text and sizes its width from the label;
    // a long label in a narrow box overflows the box width.
    const s = scene();
    s.labeledRect("box", 0, 0, 40, 50, blue, "a very long label that overflows", 20);
    const r = checkGeometry(s.build());
    const v = r.violations.find((v) => v.type === "label-wider-than-box");
    expect(v).toBeDefined();
    expect(v!.ids).toContain("box");
  });

  test("detects two overlapping boxes", () => {
    const s = scene();
    s.labeledRect("a", 0, 0, 100, 100, blue, "A", 16);
    s.labeledRect("b", 50, 50, 100, 100, green, "B", 16);
    const r = checkGeometry(s.build());
    const v = r.violations.find((v) => v.type === "box-overlap");
    expect(v).toBeDefined();
    expect(v!.ids).toEqual(expect.arrayContaining(["a", "b"]));
  });

  test("detects an arrow whose endpoint misses the target edge", () => {
    const s = scene();
    s.labeledRect("a", 0, 0, 100, 60, blue, "A", 16);
    s.labeledRect("b", 400, 0, 100, 60, green, "B", 16);
    // arrow from right edge of a, ending far short of b's left edge (300 vs 400)
    s.arrow("ar", 100, 30, [[0, 0], [200, 0]]);
    const r = checkGeometry(s.build());
    const v = r.violations.find((v) => v.type === "arrow-misses-target");
    expect(v).toBeDefined();
    expect(v!.ids).toContain("ar");
  });

  test("detects an off-canvas element", () => {
    const s = scene();
    // a small cluster of in-bounds boxes, plus one element flung far away
    s.labeledRect("a", 0, 0, 100, 60, blue, "A", 16);
    s.labeledRect("b", 0, 200, 100, 60, blue, "B", 16);
    s.labeledRect("c", 200, 0, 100, 60, blue, "C", 16);
    s.labeledRect("off", 99999, 0, 100, 60, green, "X", 16);
    const r = checkGeometry(s.build());
    const v = r.violations.find((v) => v.type === "off-canvas");
    expect(v).toBeDefined();
    expect(v!.ids).toContain("off");
  });

  test("detects two elements closer than 20px", () => {
    const s = scene();
    s.labeledRect("a", 0, 0, 100, 60, blue, "A", 16);
    // 5px gap horizontally, not overlapping
    s.labeledRect("b", 105, 0, 100, 60, green, "B", 16);
    const r = checkGeometry(s.build());
    const v = r.violations.find((v) => v.type === "spacing-too-close");
    expect(v).toBeDefined();
    expect(v!.ids).toEqual(expect.arrayContaining(["a", "b"]));
  });
});

// helper: re-run the check on an already-fixed scene
const recheck = (fixed: ReturnType<typeof checkGeometry>["fixed"]) => checkGeometry(fixed);

// AC2: mechanical violations are auto-fixed and the re-check passes.
describe("AC2: mechanical auto-fix", () => {
  test("widens the box so the label fits, and the re-check is clean", () => {
    const s = scene();
    s.labeledRect("box", 0, 0, 40, 50, blue, "a very long label that overflows", 20);
    const r = checkGeometry(s.build());
    // re-running on the fixed scene finds no label-wider-than-box
    const again = recheck(r.fixed);
    expect(again.violations.find((v) => v.type === "label-wider-than-box")).toBeUndefined();
  });

  test("nudges an off-canvas element back in bounds, and the re-check is clean", () => {
    const s = scene();
    s.labeledRect("a", 0, 0, 100, 60, blue, "A", 16);
    s.labeledRect("b", 0, 200, 100, 60, blue, "B", 16);
    s.labeledRect("c", 200, 0, 100, 60, blue, "C", 16);
    s.labeledRect("off", 99999, 0, 100, 60, green, "X", 16);
    const r = checkGeometry(s.build());
    const again = recheck(r.fixed);
    expect(again.violations.find((v) => v.type === "off-canvas")).toBeUndefined();
  });

  test("pushes too-close elements apart, and the re-check is clean", () => {
    const s = scene();
    s.labeledRect("a", 0, 0, 100, 60, blue, "A", 16);
    s.labeledRect("b", 105, 0, 100, 60, green, "B", 16);
    const r = checkGeometry(s.build());
    const again = recheck(r.fixed);
    expect(again.violations.find((v) => v.type === "spacing-too-close")).toBeUndefined();
  });

  test("a scene with only mechanical violations becomes ok after the fix", () => {
    const s = scene();
    s.labeledRect("box", 0, 0, 40, 50, blue, "a very long label that overflows", 20);
    const r = checkGeometry(s.build());
    expect(r.ok).toBe(true);
  });

  test("a clean scene reports ok with no violations", () => {
    const s = scene();
    s.labeledRect("a", 0, 0, 120, 60, blue, "A", 16);
    s.labeledRect("b", 0, 200, 120, 60, green, "B", 16);
    const r = checkGeometry(s.build());
    expect(r.ok).toBe(true);
    expect(r.violations).toHaveLength(0);
    expect(r.remaining).toHaveLength(0);
  });
});

// AC3: structural violations are reported, not silently fixed.
describe("AC3: structural violations are flagged, not fixed", () => {
  test("overlapping boxes remain after the check and are listed in remaining", () => {
    const s = scene();
    s.labeledRect("a", 0, 0, 100, 100, blue, "A", 16);
    s.labeledRect("b", 50, 50, 100, 100, green, "B", 16);
    const r = checkGeometry(s.build());
    // still overlapping in the returned (un-rearranged) scene
    const overlap = r.remaining.find((v) => v.type === "box-overlap");
    expect(overlap).toBeDefined();
    expect(overlap!.ids).toEqual(expect.arrayContaining(["a", "b"]));
    // re-checking the "fixed" scene still finds the overlap (not silently fixed)
    expect(checkGeometry(r.fixed).remaining.find((v) => v.type === "box-overlap")).toBeDefined();
  });

  test("an arrow that misses its target is left for the agent to rethink", () => {
    const s = scene();
    s.labeledRect("a", 0, 0, 100, 60, blue, "A", 16);
    s.labeledRect("b", 400, 0, 100, 60, green, "B", 16);
    s.arrow("ar", 100, 30, [[0, 0], [200, 0]]);
    const r = checkGeometry(s.build());
    expect(r.remaining.find((v) => v.type === "arrow-misses-target")).toBeDefined();
  });
});

// AC4: a scene with a known violation is never reported as passing.
describe("AC4: never ok while a violation stands", () => {
  test("a scene with a structural violation is not ok", () => {
    const s = scene();
    s.labeledRect("a", 0, 0, 100, 100, blue, "A", 16);
    s.labeledRect("b", 50, 50, 100, 100, green, "B", 16);
    const r = checkGeometry(s.build());
    expect(r.ok).toBe(false);
  });

  test("a scene mixing mechanical and structural violations is not ok, and the mechanical part is still fixed", () => {
    const s = scene();
    // overlap (structural) + an overflowing label (mechanical)
    s.labeledRect("a", 0, 0, 40, 100, blue, "a very long overflowing label", 20);
    s.labeledRect("b", 20, 20, 100, 100, green, "B", 16);
    const r = checkGeometry(s.build());
    expect(r.ok).toBe(false);
    // the mechanical label fix was applied in the returned scene
    expect(checkGeometry(r.fixed).violations.find((v) => v.type === "label-wider-than-box")).toBeUndefined();
    // but the structural overlap still stands
    expect(r.remaining.find((v) => v.type === "box-overlap")).toBeDefined();
  });
});
