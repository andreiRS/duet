import { expect, test } from "bun:test";
import { mergeRemoteScene } from "./client-merge";

// AC (#18): a human element drawn but not yet debounce-saved has a fresh id not
// in the remote scene. When a remote agent scene arrives, that in-progress
// element must NOT be dropped from the canvas.
test("an in-progress local element survives applying a remote scene", () => {
  const remote = [{ id: "agentBox", type: "rectangle", version: 1 }];
  const local = [{ id: "humanInProgress", type: "ellipse", version: 1 }];

  const merged = mergeRemoteScene(remote, local);

  expect(merged.map((e) => e.id)).toContain("humanInProgress");
});

// AC (#18): after reconciliation the canvas shows BOTH the remote agent
// elements AND the in-progress human element.
test("the merged scene shows both remote and in-progress local elements", () => {
  const remote = [{ id: "agentBox", type: "rectangle", version: 1 }];
  const local = [{ id: "humanInProgress", type: "ellipse", version: 1 }];

  const merged = mergeRemoteScene(remote, local);

  expect(merged.map((e) => e.id).sort()).toEqual(["agentBox", "humanInProgress"]);
});

// First-load: the canvas is empty, so merging a remote scene with no local
// elements must be exactly the remote scene (no behavior change, no flash).
test("first load with empty local view yields exactly the remote scene", () => {
  const remote = [
    { id: "a", type: "rectangle", version: 1 },
    { id: "b", type: "ellipse", version: 1 },
  ];

  const merged = mergeRemoteScene(remote, []);

  expect(merged).toEqual(remote);
});

// A shared id resolves by version: the higher-version copy wins. The arriving
// remote scene is the truth, so a remote element with a higher version replaces
// the stale local copy.
test("a shared id resolves to the higher-version copy (remote wins when newer)", () => {
  const remote = [{ id: "shared", type: "rectangle", x: 10, version: 5 }];
  const local = [{ id: "shared", type: "rectangle", x: 99, version: 2 }];

  const merged = mergeRemoteScene(remote, local);

  expect(merged).toHaveLength(1);
  expect(merged[0].x).toBe(10);
  expect(merged[0].version).toBe(5);
});

// A human delete is an isDeleted:true tombstone carried with a higher version.
// If the local view holds a newer tombstone for a shared id, it must win so the
// delete is not undone by the arriving remote scene.
test("a higher-version local tombstone wins over a stale remote element", () => {
  const remote = [{ id: "shared", type: "rectangle", isDeleted: false, version: 2 }];
  const local = [{ id: "shared", type: "rectangle", isDeleted: true, version: 7 }];

  const merged = mergeRemoteScene(remote, local);

  expect(merged).toHaveLength(1);
  expect(merged[0].isDeleted).toBe(true);
  expect(merged[0].version).toBe(7);
});

// Locks the merge contract behind the App.tsx tombstone-source fix: a human
// deletes X in the browser (Excalidraw soft-deletes -> X becomes an
// isDeleted:true tombstone with a HIGHER version). Before the 400ms-debounced
// save round-trips, a stale remote scene that still holds X ALIVE (lower
// version) arrives. The local source must include the tombstone (App.tsx uses
// getSceneElementsIncludingDeleted) so the version tiebreak runs: the tombstone
// wins and the just-deleted element is NOT resurrected by the stale remote.
test("a browser-deleted element is not resurrected by a stale remote scene", () => {
  const remote = [{ id: "X", type: "rectangle", isDeleted: false, version: 3 }];
  const local = [{ id: "X", type: "rectangle", isDeleted: true, version: 4 }];

  const merged = mergeRemoteScene(remote, local);

  expect(merged).toHaveLength(1);
  expect(merged[0].id).toBe("X");
  expect(merged[0].isDeleted).toBe(true);
});
