import { expect, test } from "bun:test";
import { diffById } from "./reconcile";
import { scene } from "./authoring";

// AC1: a box whose geometry (x/y/width/height) changed between baseline and
// current is classified `moved`.
test("AC1: a box with changed geometry is classified moved", () => {
  const baseline = [{ id: "api", type: "rectangle", x: 0, y: 0, width: 100, height: 50 }];
  const current = [{ id: "api", type: "rectangle", x: 40, y: 0, width: 100, height: 50 }];

  const diff = diffById(baseline, current);

  expect(diff.moved).toContain("api");
});

// AC1: an arrow whose `points` changed is also classified moved (geometry for
// an arrow lives in its point offsets, not width/height).
test("AC1: an arrow with changed points is classified moved", () => {
  const baseline = [{ id: "a1", type: "arrow", x: 0, y: 0, points: [[0, 0], [50, 0]] }];
  const current = [{ id: "a1", type: "arrow", x: 0, y: 0, points: [[0, 0], [80, 0]] }];

  const diff = diffById(baseline, current);

  expect(diff.moved).toContain("a1");
});

// AC1: an element whose `text` changed (but geometry unchanged) is retyped, not
// moved.
test("AC1: an element with changed text is classified retyped", () => {
  const baseline = [{ id: "api_t", type: "text", x: 0, y: 0, width: 30, height: 20, text: "API" }];
  const current = [{ id: "api_t", type: "text", x: 0, y: 0, width: 30, height: 20, text: "Gateway" }];

  const diff = diffById(baseline, current);

  expect(diff.retyped).toContain("api_t");
  expect(diff.moved).not.toContain("api_t");
});

// An element can be both moved AND retyped when geometry and text both change.
test("AC1: an element with changed geometry and text is both moved and retyped", () => {
  const baseline = [{ id: "api_t", type: "text", x: 0, y: 0, width: 30, height: 20, text: "API" }];
  const current = [{ id: "api_t", type: "text", x: 99, y: 0, width: 30, height: 20, text: "Gateway" }];

  const diff = diffById(baseline, current);

  expect(diff.moved).toContain("api_t");
  expect(diff.retyped).toContain("api_t");
});

// AC1: an id present in current but absent from baseline is classified added.
test("AC1: an id only in current is classified added", () => {
  const baseline = [{ id: "api", type: "rectangle", x: 0, y: 0, width: 100, height: 50 }];
  const current = [
    { id: "api", type: "rectangle", x: 0, y: 0, width: 100, height: 50 },
    { id: "db", type: "rectangle", x: 200, y: 0, width: 100, height: 50 },
  ];

  const diff = diffById(baseline, current);

  expect(diff.added).toContain("db");
});

// AC1: a known id present in baseline but gone from current is classified deleted.
test("AC1: a known id only in baseline is classified deleted", () => {
  const baseline = [
    { id: "api", type: "rectangle", x: 0, y: 0, width: 100, height: 50 },
    { id: "db", type: "rectangle", x: 200, y: 0, width: 100, height: 50 },
  ];
  const current = [{ id: "api", type: "rectangle", x: 0, y: 0, width: 100, height: 50 }];

  const diff = diffById(baseline, current);

  expect(diff.deleted).toContain("db");
});

// AC2: a no-op edit that only bumps version/versionNonce must produce NO change.
test("AC2: bumping only version/versionNonce produces no change", () => {
  const baseline = [
    { id: "api", type: "rectangle", x: 0, y: 0, width: 100, height: 50, text: "API", version: 1, versionNonce: 111 },
  ];
  const current = [
    { id: "api", type: "rectangle", x: 0, y: 0, width: 100, height: 50, text: "API", version: 2, versionNonce: 999 },
  ];

  const diff = diffById(baseline, current);

  expect(diff.moved).toHaveLength(0);
  expect(diff.retyped).toHaveLength(0);
  expect(diff.added).toHaveLength(0);
  expect(diff.deleted).toHaveLength(0);
});

// diffById must not depend on element array order: shuffling current yields the
// same classification.
test("diffById is independent of element order", () => {
  const baseline = [
    { id: "api", type: "rectangle", x: 0, y: 0, width: 100, height: 50 },
    { id: "db", type: "rectangle", x: 200, y: 0, width: 100, height: 50 },
  ];
  const ordered = [
    { id: "api", type: "rectangle", x: 40, y: 0, width: 100, height: 50 },
    { id: "db", type: "rectangle", x: 200, y: 0, width: 100, height: 50 },
    { id: "new", type: "rectangle", x: 500, y: 0, width: 100, height: 50 },
  ];
  const shuffled = [ordered[2], ordered[0], ordered[1]];

  const a = diffById(baseline, ordered);
  const b = diffById(baseline, shuffled);

  expect([...b.moved].sort()).toEqual([...a.moved].sort());
  expect([...b.retyped].sort()).toEqual([...a.retyped].sort());
  expect([...b.added].sort()).toEqual([...a.added].sort());
  expect([...b.deleted].sort()).toEqual([...a.deleted].sort());
  expect(a.moved).toEqual(["api"]);
  expect(a.added).toEqual(["new"]);
});

// AC1 + AC2 end-to-end on a real authored scene: a no-op version bump on every
// element yields no change; nudging one box yields exactly that box as moved.
test("AC1/AC2: diff on a real authored scene (accepts { elements } shape)", () => {
  const s = scene();
  s.labeledRect("api", 0, 0, 120, 60, scene().dark ? (["", "", ""] as const) : (["#dbe4ff", "#a5d8ff", "#4a9eed"] as const), "API", 16);
  s.labeledRect("db", 300, 0, 120, 60, ["#d3f9d8", "#b2f2bb", "#22c55e"] as const, "DB", 16);
  const baselineScene = s.build();

  // no-op: bump version/versionNonce on every element, change nothing else
  const bumped = {
    ...baselineScene,
    elements: baselineScene.elements.map((e) => ({ ...e, version: (e.version as number) + 1, versionNonce: 42 })),
  };
  const noop = diffById(baselineScene, bumped);
  expect(noop.moved).toHaveLength(0);
  expect(noop.retyped).toHaveLength(0);
  expect(noop.added).toHaveLength(0);
  expect(noop.deleted).toHaveLength(0);

  // nudge api only
  const nudged = {
    ...baselineScene,
    elements: baselineScene.elements.map((e) => (e.id === "api" ? { ...e, x: (e.x as number) + 50 } : e)),
  };
  const moved = diffById(baselineScene, nudged);
  expect(moved.moved).toEqual(["api"]);
});
