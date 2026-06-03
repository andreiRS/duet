// Authoring library for Duet agent. Builds valid Excalidraw JSON with
// deterministic ids and bound-text labels that survive the edit round-trip.
//
// Id scheme:
//   box:       <id>
//   box label: <id>_t
//   arrow:     <id>
//   arrow label: <id>_t

export type El = Record<string, unknown>;

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
      const tid = id + "_t";
      e.boundElements = [{ type: "text", id: tid }];
      els.push(e);
      els.push(
        baseText({
          id: tid,
          x: x + width / 2 - w(label, 14) / 2,
          y: y + height / 2 - 10,
          width: w(label, 14),
          height: 20,
          text: label,
          fontSize: 14,
          strokeColor: color,
          textAlign: "center",
          verticalAlign: "middle",
          containerId: id,
        }),
      );
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

  // Escape hatch for ellipse/diamond/etc.
  const raw = (e: El) => els.push(base(e));

  const build = () => {
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
    };
  };

  return { text, labeledRect, arrow, zone, raw, build, dark: DARK };
}
