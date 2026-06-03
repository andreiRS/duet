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

  test("arrow ending exactly 5px from the target edge PASSES (tolerance boundary)", () => {
    const s = scene();
    s.labeledRect("a", 0, 0, 100, 60, blue, "A", 16);
    s.labeledRect("b", 400, 0, 100, 60, green, "B", 16);
    // arrow ends at x=395, b's left edge is at x=400 -> exactly 5px short
    s.arrow("ar", 100, 30, [[0, 0], [295, 0]]);
    const r = checkGeometry(s.build());
    expect(r.violations.find((v) => v.type === "arrow-misses-target")).toBeUndefined();
  });

  test("arrow ending 6px from the target edge IS flagged (just past tolerance)", () => {
    const s = scene();
    s.labeledRect("a", 0, 0, 100, 60, blue, "A", 16);
    s.labeledRect("b", 400, 0, 100, 60, green, "B", 16);
    // arrow ends at x=394, b's left edge is at x=400 -> 6px short
    s.arrow("ar", 100, 30, [[0, 0], [294, 0]]);
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

  test("flags a moderately-off element ~500px from a 3-box cluster (and only it)", () => {
    const s = scene();
    // tight cluster near origin
    s.labeledRect("a", 0, 0, 100, 60, blue, "A", 16);
    s.labeledRect("b", 0, 120, 100, 60, blue, "B", 16);
    s.labeledRect("c", 120, 0, 100, 60, blue, "C", 16);
    // one box ~500px right of the cluster
    s.labeledRect("off", 720, 0, 100, 60, green, "X", 16);
    const r = checkGeometry(s.build());
    const offs = r.violations.filter((v) => v.type === "off-canvas");
    expect(offs).toHaveLength(1);
    expect(offs[0].ids).toEqual(["off"]);
  });

  test("with two elements, only the flung-away one is flagged (not both)", () => {
    const s = scene();
    s.labeledRect("home", 0, 0, 100, 60, blue, "A", 16);
    s.labeledRect("off", 5000, 0, 100, 60, green, "X", 16);
    const r = checkGeometry(s.build());
    const offs = r.violations.filter((v) => v.type === "off-canvas");
    expect(offs).toHaveLength(1);
    expect(offs[0].ids).toEqual(["off"]);
  });

  test("a reasonable spread-out layout is NOT flagged as off-canvas", () => {
    const s = scene();
    s.labeledRect("a", 0, 0, 100, 60, blue, "A", 16);
    s.labeledRect("b", 300, 0, 100, 60, blue, "B", 16);
    s.labeledRect("c", 0, 300, 100, 60, blue, "C", 16);
    s.labeledRect("d", 300, 300, 100, 60, green, "D", 16);
    const r = checkGeometry(s.build());
    expect(r.violations.find((v) => v.type === "off-canvas")).toBeUndefined();
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

  test("with two elements, the fix pulls the outlier back and leaves the in-bounds one near origin", () => {
    const s = scene();
    s.labeledRect("home", 0, 0, 100, 60, blue, "A", 16);
    s.labeledRect("off", 5000, 0, 100, 60, green, "X", 16);
    const r = checkGeometry(s.build());
    const again = recheck(r.fixed);
    expect(again.violations.find((v) => v.type === "off-canvas")).toBeUndefined();
    // the in-bounds element stayed put near origin (was not dragged out to the outlier)
    const home = r.fixed.find((e) => e.id === "home")!;
    expect(Math.abs(home.x)).toBeLessThan(200);
    // the outlier was pulled back next to home
    const off = r.fixed.find((e) => e.id === "off")!;
    expect(off.x).toBeLessThan(500);
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

// `remaining` must list EVERY still-standing violation after the fix, so it
// always explains why `ok` is false (not just structural ones).
describe("remaining surfaces all unresolved violations", () => {
  test("remaining equals the set of violations still present in the fixed scene", () => {
    const s = scene();
    s.labeledRect("a", 0, 0, 100, 100, blue, "A", 16);
    s.labeledRect("b", 50, 50, 100, 100, green, "B", 16); // overlap (structural)
    s.labeledRect("box", 800, 800, 40, 50, blue, "a very long label that overflows", 20); // mechanical
    const r = checkGeometry(s.build());
    const stillThere = checkGeometry(r.fixed).violations;
    // remaining is exactly what is still standing after the auto-fix
    const key = (v: { type: string; ids: string[] }) => v.type + ":" + [...v.ids].sort().join(",");
    expect(r.remaining.map(key).sort()).toEqual(stillThere.map(key).sort());
  });

  test("any violation still standing after the fix is surfaced in remaining, and ok is false", () => {
    // An off-canvas arrow gets relocated next to the cluster by the mechanical
    // fix, after which it no longer reaches its target (a structural
    // arrow-misses). The point under test: whatever is left standing after the
    // auto-fix loop, of ANY kind, must appear in remaining so it explains ok.
    // (Pure-mechanical leftovers can only occur if the 50-pass cap is hit; the
    // filter below would surface those identically.)
    const s = scene();
    s.labeledRect("a", 0, 0, 100, 60, blue, "A", 16);
    s.labeledRect("b", 0, 120, 100, 60, blue, "B", 16);
    s.labeledRect("c", 120, 0, 100, 60, blue, "C", 16);
    s.arrow("far", 9000, 9000, [[0, 0], [50, 0]]);
    const r = checkGeometry(s.build());
    const stillThere = checkGeometry(r.fixed).violations;
    expect(stillThere.length).toBeGreaterThan(0);
    expect(r.ok).toBe(false);
    // every still-standing violation is surfaced in remaining
    for (const v of stillThere) {
      expect(r.remaining.find((x) => x.type === v.type && x.ids.join() === v.ids.join())).toBeDefined();
    }
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
