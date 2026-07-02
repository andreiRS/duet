// Authoring library for Duet agent. Builds valid Excalidraw JSON with
// deterministic ids and bound-text labels that survive the edit round-trip.
//
// Id scheme:
//   box:       <id>
//   box label: <id>_t
//   arrow:     <id>
//   arrow label: <id>_t

import type { ExcalidrawScene, El } from "./scene-types";
export type { El } from "./scene-types";
import { measuredTextHeight, BOUND_TEXT_PADDING } from "./bound-text";

// [zoneBg, boxFill, accent] per family
export const PALETTE = {
  light: {
    purple: ["#e5dbff", "#d0bfff", "#8b5cf6"],
    blue: ["#dbe4ff", "#a5d8ff", "#4a9eed"],
    amber: ["#fff3bf", "#fff3bf", "#f59e0b"],
    green: ["#d3f9d8", "#b2f2bb", "#22c55e"],
    cyan: ["#c3fae8", "#c3fae8", "#06b6d4"],
    red: ["#ffe3e3", "#ffc9c9", "#ef4444"],
  },
  dark: {
    purple: ["#2d1b69", "#3b2a7a", "#a78bfa"],
    blue: ["#1e3a5f", "#234a73", "#60a5fa"],
    amber: ["#5c3d1a", "#6b4a22", "#fbbf24"],
    green: ["#1a4d2e", "#205c38", "#4ade80"],
    cyan: ["#1a4d4d", "#206060", "#22d3ee"],
    red: ["#5c1a1a", "#6b2222", "#f87171"],
  },
} as const;

export type Family = readonly [string, string, string];

// The default element envelope shared by every verb and by scene()'s build().
// Caller-supplied fields in `e` win via spread.
function baseEl(ink: string, e: El): El {
  return {
    angle: 0,
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: 1,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    strokeColor: ink,
    ...e,
  };
}

export interface PipelineOpts {
  /** X position of the first box. Default: 0 */
  startX?: number;
  /** Y position of all boxes. Default: 0 */
  startY?: number;
  /** Width of each box. Default: 120 */
  boxW?: number;
  /** Height of each box. Default: 60 */
  boxH?: number;
  /** Gap between adjacent boxes. Default: 40 */
  gap?: number;
  /** Font size for box labels. Default: 14 */
  fontSize?: number;
  /** Color family for all boxes. Default: PALETTE.light.blue */
  fam?: Family;
  /** Id prefix for boxes and arrows. Default: "pipe" */
  idPrefix?: string;
}

export interface Verbs {
  text(id: string, x: number, y: number, t: string, fontSize: number, color?: string): void;
  labeledRect(
    id: string,
    x: number,
    y: number,
    width: number,
    height: number,
    fam: Family,
    label: string,
    fontSize: number,
  ): void;
  arrow(id: string, x: number, y: number, pts: number[][], color?: string, label?: string): void;
  connect(
    id: string,
    fromBoxId: string,
    toBoxId: string,
    opts?: { color?: string; label?: string },
  ): void;
  zone(id: string, x: number, y: number, width: number, height: number, fam: Family): void;
  raw(e: El): void;
  /**
   * Place N evenly-spaced labeled boxes and connect each adjacent pair with a
   * bound arrow. Only neighbors (i → i+1) are connected; no crossing diagonals.
   */
  pipeline(labels: string[], opts?: PipelineOpts): void;
}

// Build the authoring verbs over an EXTERNAL elements array. Both scene()
// (which owns build()/dark) and open() (mutate-in-place on a loaded file) share
// this single factory, so binding logic (connect) lives in exactly one place.
// All verbs mutate `els` in place.
export function makeVerbs(els: El[], opts: { dark?: boolean } = {}): Verbs {
  const DARK = !!opts.dark;
  const ink = DARK ? "#e5e5e5" : "#1e1e1e";

  const base = (e: El): El => baseEl(ink, e);

  const baseText = (e: El): El => {
    const merged = base(e);
    return {
      ...merged,
      type: "text",
      strokeWidth: 1,
      // Excalifont (5), Excalidraw's current default handdrawn font, not Virgil
      // (1, legacy) or Helvetica (2, plain sans). See #26.
      fontFamily: 5,
      textAlign: (e.textAlign ?? "left") as string,
      verticalAlign: (e.verticalAlign ?? "top") as string,
      containerId: (e.containerId ?? null) as string | null,
      lineHeight: 1.25,
      originalText: e.text,
      autoResize: true,
    };
  };

  // Width estimate: text.length * fontSize * 0.55.
  // Used for STANDALONE text and BOUND labels alike.
  // geometry.ts uses the same factor at check time for label-overflow detection.
  const w = (t: string, fs: number) => t.length * fs * 0.55;

  // Standalone text element. Measure per line so multiline text (explicit "\n")
  // gets a box tall enough for every line and wide enough for its widest line.
  // A single-line height here left later lines clipped until a manual remeasure
  // (same class of bug as #25, but for standalone text rather than bound labels).
  const text = (id: string, x: number, y: number, t: string, fontSize: number, color = ink) => {
    const width = Math.max(...t.split("\n").map((line) => w(line, fontSize)));
    const height = measuredTextHeight(t, fontSize);
    els.push(baseText({ id, x, y, width, height, text: t, fontSize, strokeColor: color }));
  };

  // Rectangle with a bound-text label. Two elements: rect + text with containerId.
  const labeledRect = (
    id: string,
    x: number,
    y: number,
    width: number,
    height: number,
    fam: Family,
    label: string,
    fontSize: number,
  ) => {
    const [, fill, accent] = fam;
    const tid = id + "_t";
    // Measure the label for ALL its lines (#25). A label with "\n" newlines is
    // taller than one line; grow the box so every line is contained, matching
    // Excalidraw's bound-text padding.
    const labelH = measuredTextHeight(label, fontSize);
    const usableH = height - BOUND_TEXT_PADDING * 2;
    const boxH = labelH > usableH ? labelH + BOUND_TEXT_PADDING * 2 : height;
    els.push(
      base({
        type: "rectangle",
        id,
        x,
        y,
        width,
        height: boxH,
        backgroundColor: fill,
        fillStyle: "solid",
        strokeColor: accent,
        strokeWidth: 2,
        roundness: { type: 3 },
        boundElements: [{ type: "text", id: tid }],
      }),
    );
    // Bound text: store a non-zero width estimate so Excalidraw renders the
    // label as legible text. Center the label inside the (possibly grown) box.
    const labelW = w(label, fontSize);
    els.push(
      baseText({
        id: tid,
        x: x + (width - labelW) / 2,
        y: y + (boxH - labelH) / 2,
        width: labelW,
        height: labelH,
        text: label,
        fontSize,
        strokeColor: DARK ? "#e5e5e5" : "#1e1e1e",
        textAlign: "center",
        verticalAlign: "middle",
        containerId: id,
      }),
    );
  };

  // Shared helper: attach a bound label text element to an arrow element.
  // Mutates arrowEl.boundElements and pushes the text element onto els.
  const pushArrowLabel = (
    arrowEl: El,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    label: string,
    color: string,
  ) => {
    const tid = arrowEl.id + "_t";
    arrowEl.boundElements = [{ type: "text", id: tid }];
    els.push(arrowEl);
    // Bound text: store a non-zero width estimate so Excalidraw renders the
    // label as legible text. Center the label on the arrow midpoint.
    const arrowLabelW = w(label, 14);
    const mx = (startX + endX) / 2;
    const my = (startY + endY) / 2;
    els.push(
      baseText({
        id: tid,
        x: mx - arrowLabelW / 2,
        y: my - 10,
        width: arrowLabelW,
        height: 20,
        text: label,
        fontSize: 14,
        strokeColor: color,
        textAlign: "center",
        verticalAlign: "middle",
        containerId: arrowEl.id,
      }),
    );
  };

  // Arrow from (x,y) along point offsets. Optional bound label.
  const arrow = (id: string, x: number, y: number, pts: number[][], color = ink, label?: string) => {
    const width = Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0]));
    const height = Math.max(...pts.map((p) => p[1])) - Math.min(...pts.map((p) => p[1]));
    const e: El = base({
      type: "arrow",
      id,
      x,
      y,
      width,
      height,
      points: pts,
      strokeColor: color,
      strokeWidth: 2,
      endArrowhead: "arrow",
      startArrowhead: null,
      lastCommittedPoint: null,
      startBinding: null,
      endBinding: null,
    });
    if (label) {
      pushArrowLabel(e, x, y, x + width, y + height, label, color);
    } else {
      els.push(e);
    }
  };

  // Faint grouping rectangle
  const zone = (id: string, x: number, y: number, width: number, height: number, fam: Family) =>
    els.push(
      base({
        type: "rectangle",
        id,
        x,
        y,
        width,
        height,
        backgroundColor: fam[0],
        fillStyle: "solid",
        strokeColor: fam[2],
        strokeWidth: 1,
        opacity: 30,
        roundness: { type: 3 },
      }),
    );

  // Arrow connecting two existing boxes by id. Picks the nearest facing edge
  // based on the dominant axis between box centers.
  //
  // Binding shape: { elementId, focus, gap, fixedPoint: [fx, fy] }
  //   fixedPoint is normalized within the box: right=[1,0.5] left=[0,0.5]
  //   top=[0.5,0] bottom=[0.5,1]
  //
  // Also updates both boxes' boundElements arrays with {type:"arrow",id}.
  const connect = (
    id: string,
    fromBoxId: string,
    toBoxId: string,
    opts: { color?: string; label?: string } = {},
  ) => {
    const color = opts.color ?? ink;

    const fromEl = els.find((e) => e.id === fromBoxId);
    const toEl = els.find((e) => e.id === toBoxId);
    if (!fromEl || !toEl) {
      throw new Error(`connect: box not found. fromBoxId=${fromBoxId} toBoxId=${toBoxId}`);
    }

    // Centers
    const fromCx = fromEl.x + fromEl.width / 2;
    const fromCy = fromEl.y + fromEl.height / 2;
    const toCx = toEl.x + toEl.width / 2;
    const toCy = toEl.y + toEl.height / 2;

    const dx = toCx - fromCx;
    const dy = toCy - fromCy;

    // Pick edges: dominant axis determines the facing direction
    let startFP: [number, number];
    let endFP: [number, number];
    // Arrow start point (absolute) and end point (absolute) at the edge centers
    let startX: number;
    let startY: number;
    let endX: number;
    let endY: number;

    if (Math.abs(dx) >= Math.abs(dy)) {
      // Horizontal dominant
      if (dx >= 0) {
        // target is to the right
        startFP = [1, 0.5];
        endFP = [0, 0.5];
        startX = fromEl.x + fromEl.width;
        startY = fromEl.y + fromEl.height / 2;
        endX = toEl.x;
        endY = toEl.y + toEl.height / 2;
      } else {
        // target is to the left
        startFP = [0, 0.5];
        endFP = [1, 0.5];
        startX = fromEl.x;
        startY = fromEl.y + fromEl.height / 2;
        endX = toEl.x + toEl.width;
        endY = toEl.y + toEl.height / 2;
      }
    } else {
      // Vertical dominant
      if (dy >= 0) {
        // target is below
        startFP = [0.5, 1];
        endFP = [0.5, 0];
        startX = fromEl.x + fromEl.width / 2;
        startY = fromEl.y + fromEl.height;
        endX = toEl.x + toEl.width / 2;
        endY = toEl.y;
      } else {
        // target is above
        startFP = [0.5, 0];
        endFP = [0.5, 1];
        startX = fromEl.x + fromEl.width / 2;
        startY = fromEl.y;
        endX = toEl.x + toEl.width / 2;
        endY = toEl.y + toEl.height;
      }
    }

    // Points are relative to arrow origin (startX, startY)
    const pts = [[0, 0], [endX - startX, endY - startY]];
    const width = Math.abs(endX - startX);
    const height = Math.abs(endY - startY);

    const e: El = base({
      type: "arrow",
      id,
      x: startX,
      y: startY,
      width,
      height,
      points: pts,
      strokeColor: color,
      strokeWidth: 2,
      endArrowhead: "arrow",
      startArrowhead: null,
      lastCommittedPoint: null,
      startBinding: {
        elementId: fromBoxId,
        focus: 0,
        gap: 8,
        fixedPoint: startFP,
      },
      endBinding: {
        elementId: toBoxId,
        focus: 0,
        gap: 8,
        fixedPoint: endFP,
      },
    });

    if (opts.label) {
      pushArrowLabel(e, startX, startY, endX, endY, opts.label, color);
    } else {
      els.push(e);
    }

    // Bidirectional: add arrow reference to both boxes' boundElements
    const arrowRef = { type: "arrow", id };
    if (Array.isArray(fromEl.boundElements)) {
      fromEl.boundElements = [...fromEl.boundElements, arrowRef];
    } else {
      fromEl.boundElements = [arrowRef];
    }
    if (Array.isArray(toEl.boundElements)) {
      toEl.boundElements = [...toEl.boundElements, arrowRef];
    } else {
      toEl.boundElements = [arrowRef];
    }
  };

  // Escape hatch for ellipse/diamond/etc.
  const raw = (e: El) => els.push(base(e));

  // Place N evenly-spaced labeled boxes and connect adjacent pairs.
  const pipeline = (labels: string[], opts: PipelineOpts = {}) => {
    const {
      startX = 0,
      startY = 0,
      boxW = 120,
      boxH = 60,
      gap = 40,
      fontSize = 14,
      fam = PALETTE.light.blue,
      idPrefix = "pipe",
    } = opts;

    const step = boxW + gap;

    // Place all boxes
    for (let i = 0; i < labels.length; i++) {
      const boxId = `${idPrefix}_${i}`;
      labeledRect(boxId, startX + i * step, startY, boxW, boxH, fam, labels[i], fontSize);
    }

    // Connect adjacent pairs using existing connect verb (real bindings)
    for (let i = 0; i < labels.length - 1; i++) {
      const arrowId = `${idPrefix}_arr_${i}`;
      connect(arrowId, `${idPrefix}_${i}`, `${idPrefix}_${i + 1}`);
    }
  };

  return { text, labeledRect, arrow, connect, zone, raw, pipeline };
}

export function scene(opts: { dark?: boolean } = {}) {
  const DARK = !!opts.dark;
  const els: El[] = [];
  const verbs = makeVerbs(els, opts);
  const ink = DARK ? "#e5e5e5" : "#1e1e1e";
  const base = (e: El): El => baseEl(ink, e);

  const build = (): ExcalidrawScene => {
    const all = [...els];
    if (DARK) {
      all.unshift(
        base({
          type: "rectangle",
          id: "darkbg",
          x: -4000,
          y: -3000,
          width: 10000,
          height: 7500,
          backgroundColor: "#1e1e2e",
          fillStyle: "solid",
          strokeColor: "transparent",
          strokeWidth: 0,
        }),
      );
    }
    return {
      type: "excalidraw",
      version: 2,
      source: "https://excalidraw.com",
      elements: all,
      appState: {
        viewBackgroundColor: DARK ? "#1e1e2e" : "#ffffff",
        gridSize: null,
      },
      files: {},
    };
  };

  return { ...verbs, build, dark: DARK };
}
