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

export function scene(opts: { dark?: boolean } = {}) {
  const DARK = !!opts.dark;
  const ink = DARK ? "#e5e5e5" : "#1e1e1e";
  const els: El[] = [];

  const base = (e: El): El => ({
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
  });

  const baseText = (e: El): El => {
    const merged = base(e);
    return {
      ...merged,
      type: "text",
      strokeWidth: 1,
      fontFamily: 1,
      textAlign: (e.textAlign ?? "left") as string,
      verticalAlign: (e.verticalAlign ?? "top") as string,
      containerId: (e.containerId ?? null) as string | null,
      lineHeight: 1.25,
      originalText: e.text,
      autoResize: true,
    };
  };

  // Crude width estimate; Excalidraw re-measures on load
  const w = (t: string, fs: number) => t.length * fs * 0.55;

  // Standalone text element
  const text = (id: string, x: number, y: number, t: string, fontSize: number, color = ink) =>
    els.push(baseText({ id, x, y, width: w(t, fontSize), height: fontSize * 1.25, text: t, fontSize, strokeColor: color }));

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
    els.push(
      base({
        type: "rectangle",
        id,
        x,
        y,
        width,
        height,
        backgroundColor: fill,
        fillStyle: "solid",
        strokeColor: accent,
        strokeWidth: 2,
        roundness: { type: 3 },
        boundElements: [{ type: "text", id: tid }],
      }),
    );
    const tw = w(label, fontSize);
    els.push(
      baseText({
        id: tid,
        x: x + (width - tw) / 2,
        y: y + (height - fontSize * 1.25) / 2,
        width: tw,
        height: fontSize * 1.25,
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
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    label: string,
    color: string,
  ) => {
    const tid = arrowEl.id + "_t";
    arrowEl.boundElements = [{ type: "text", id: tid }];
    els.push(arrowEl);
    els.push(
      baseText({
        id: tid,
        x: x1 + (x2 - x1) / 2 - w(label, 14) / 2,
        y: y1 + (y2 - y1) / 2 - 10,
        width: w(label, 14),
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
      pushArrowLabel(e, x, x + width, y, y + height, label, color);
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

  return { text, labeledRect, arrow, connect, zone, raw, build, dark: DARK };
}
