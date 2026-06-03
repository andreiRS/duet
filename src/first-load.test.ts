import { describe, expect, it } from "bun:test";
import { flushPendingScene } from "./first-load";

describe("flushPendingScene (first-load ordering)", () => {
  it("does not apply synchronously — defers via the scheduler", () => {
    // Regression: a synchronous updateScene inside the excalidrawAPI callback is
    // clobbered by Excalidraw's initial empty commit, blanking the canvas on
    // first load. The flush MUST be scheduled, not run inline.
    const calls: string[] = [];
    const scene = { elements: [{ id: "a" }] };
    const apply = (s: unknown) => calls.push(`apply:${JSON.stringify(s)}`);
    let scheduled: (() => void) | null = null;
    const schedule = (fn: () => void) => {
      calls.push("schedule");
      scheduled = fn;
    };

    const flushed = flushPendingScene(scene, apply, schedule);

    expect(flushed).toBe(true);
    // Scheduled but NOT yet applied.
    expect(calls).toEqual(["schedule"]);

    // Running the scheduled callback (next frame) applies the buffered scene.
    scheduled!();
    expect(calls).toEqual(["schedule", `apply:${JSON.stringify(scene)}`]);
  });

  it("applies the exact scene that was buffered", () => {
    const scene = { elements: [{ id: "x" }], appState: { foo: 1 } };
    let applied: unknown = null;
    const run: Array<() => void> = [];
    flushPendingScene(scene, (s) => (applied = s), (fn) => run.push(fn));
    run[0]!();
    expect(applied).toBe(scene);
  });

  it("is a no-op when nothing is buffered", () => {
    const calls: string[] = [];
    const flushed = flushPendingScene(
      null,
      () => calls.push("apply"),
      () => calls.push("schedule"),
    );
    expect(flushed).toBe(false);
    expect(calls).toEqual([]);
  });
});
