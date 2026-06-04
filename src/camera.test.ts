import { describe, expect, it } from "bun:test";
import { resolveCameraScroll, CAMERA_DEFAULT_DURATION_MS } from "./camera";
import type { El } from "./reconcile";

function el(id: string): El {
  return { id, type: "rectangle", x: 0, y: 0, width: 10, height: 10 } as unknown as El;
}

describe("resolveCameraScroll", () => {
  it("frames all elements when op:fit has no ids", () => {
    const els = [el("a"), el("b")];
    const args = resolveCameraScroll({ type: "camera", op: "fit" }, els);
    expect(args).not.toBeNull();
    expect(args!.targets).toEqual(els);
  });

  it("defaults animate to true and duration to the named constant", () => {
    const args = resolveCameraScroll({ type: "camera", op: "fit" }, [el("a")]);
    expect(args!.options.animate).toBe(true);
    expect(args!.options.duration).toBe(CAMERA_DEFAULT_DURATION_MS);
    expect(args!.options.fitToContent).toBe(true);
  });

  it("passes animate:false through as false", () => {
    const args = resolveCameraScroll(
      { type: "camera", op: "fit", animate: false },
      [el("a")],
    );
    expect(args!.options.animate).toBe(false);
  });

  it("passes an explicit duration through", () => {
    const args = resolveCameraScroll(
      { type: "camera", op: "fit", duration: 1200 },
      [el("a")],
    );
    expect(args!.options.duration).toBe(1200);
  });

  it("frames the union of elements whose id is in ids", () => {
    const els = [el("a"), el("b"), el("c")];
    const args = resolveCameraScroll(
      { type: "camera", op: "fit", ids: ["a", "c"] },
      els,
    );
    expect(args!.targets.map((e: El) => e.id)).toEqual(["a", "c"]);
  });

  it("returns null when the scene is empty", () => {
    expect(resolveCameraScroll({ type: "camera", op: "fit" }, [])).toBeNull();
  });

  it("returns null when no id matches (frame nothing, not the whole scene)", () => {
    const els = [el("a"), el("b")];
    const args = resolveCameraScroll(
      { type: "camera", op: "fit", ids: ["zzz"] },
      els,
    );
    expect(args).toBeNull();
  });
});
