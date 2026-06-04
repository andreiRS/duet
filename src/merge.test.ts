import { expect, test } from "bun:test";
import { mergeById } from "./reconcile";

// An element present only on disk (not in the agent's incoming set) is KEPT.
// This is the core fix: missing-from-incoming does NOT mean deleted.
test("mergeById keeps an element that exists only on disk", () => {
  const disk = [{ id: "H2", type: "rectangle", x: 0, y: 0 }];
  const incoming = [{ id: "agentBox", type: "rectangle", x: 100, y: 0 }];

  const merged = mergeById(disk, incoming);

  expect(merged.find((e) => e.id === "H2")).toBeDefined();
});

// An element present only in the incoming set is ADDED, appended after the
// on-disk elements (preserving on-disk z-order).
test("mergeById adds an incoming-only element, appended at the end", () => {
  const disk = [{ id: "H1", type: "rectangle", x: 0, y: 0 }];
  const incoming = [{ id: "agentBox", type: "rectangle", x: 100, y: 0 }];

  const merged = mergeById(disk, incoming);

  expect(merged.map((e) => e.id)).toEqual(["H1", "agentBox"]);
});

// Shared id present in both: the element with the higher Excalidraw `version` wins.
test("mergeById: for a shared id the higher version wins", () => {
  const disk = [{ id: "x", type: "rectangle", x: 0, y: 0, version: 5, versionNonce: 100 }];
  const incoming = [{ id: "x", type: "rectangle", x: 99, y: 0, version: 7, versionNonce: 200 }];

  const merged = mergeById(disk, incoming);
  const x = merged.find((e) => e.id === "x")!;

  expect(x.version).toBe(7);
  expect(x.x).toBe(99);
});

// Shared id, equal version: mirror Excalidraw's reconciler — the LOWER
// versionNonce wins. Deterministic so all writers converge.
test("mergeById: on a version tie the lower versionNonce wins", () => {
  const disk = [{ id: "x", type: "rectangle", x: 0, y: 0, version: 5, versionNonce: 100 }];
  const incoming = [{ id: "x", type: "rectangle", x: 99, y: 0, version: 5, versionNonce: 200 }];

  const merged = mergeById(disk, incoming);
  const x = merged.find((e) => e.id === "x")!;

  // disk has the lower nonce (100 < 200), so disk wins
  expect(x.x).toBe(0);
  expect(x.versionNonce).toBe(100);
});

// Convergence: when version AND versionNonce are both equal, the winner must
// NOT depend on argument order — mergeById(A,B) and mergeById(B,A) pick the SAME
// copy for a shared id. The agent path and #17 call mergeById with swapped args,
// so a position-dependent winner would let writers diverge (ADR-0007).
test("mergeById: a version+nonce tie resolves order-independently (convergence)", () => {
  const X1 = { id: "x", type: "rectangle", x: 0, y: 0, version: 5, versionNonce: 100, tag: "one" };
  const X2 = { id: "x", type: "rectangle", x: 99, y: 0, version: 5, versionNonce: 100, tag: "two" };

  const ab = mergeById([X1], [X2]).find((e) => e.id === "x")!;
  const ba = mergeById([X2], [X1]).find((e) => e.id === "x")!;

  // Same winning element regardless of which side it came in on.
  expect(ab.tag).toBe(ba.tag);
});

// Soft-delete tombstone (ADR-0007 load-bearing path): a concurrent human delete
// is an `isDeleted:true` element with a HIGHER version. It must beat the agent's
// stale still-alive copy of that id through the normal version tiebreak — no
// special case. Proves the delete survives an agent holding a stale alive copy.
test("mergeById: a higher-version isDeleted tombstone on disk beats the agent's stale alive copy", () => {
  const disk = [{ id: "x", type: "rectangle", x: 0, y: 0, version: 9, versionNonce: 100, isDeleted: true }];
  const incoming = [{ id: "x", type: "rectangle", x: 0, y: 0, version: 5, versionNonce: 200, isDeleted: false }];

  const merged = mergeById(disk, incoming);
  const x = merged.find((e) => e.id === "x")!;

  expect(x.isDeleted).toBe(true);
  expect(x.version).toBe(9);
});

// Order: the on-disk array order (z-order) is preserved; genuinely new incoming
// elements are appended at the end in incoming order.
test("mergeById preserves on-disk order and appends new incoming at the end", () => {
  const disk = [
    { id: "a", type: "rectangle", x: 0, y: 0, version: 1 },
    { id: "b", type: "rectangle", x: 0, y: 0, version: 1 },
  ];
  const incoming = [
    { id: "b", type: "rectangle", x: 0, y: 0, version: 2 },
    { id: "c", type: "rectangle", x: 0, y: 0, version: 1 },
    { id: "a", type: "rectangle", x: 0, y: 0, version: 2 },
  ];

  const merged = mergeById(disk, incoming);

  expect(merged.map((e) => e.id)).toEqual(["a", "b", "c"]);
});
