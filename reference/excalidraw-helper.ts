// Build VALID Excalidraw JSON for export_to_excalidraw.
//
// Why this file exists: the MCP server's `label` shorthand and bare `text`
// elements are DROPPED on export. Text only survives as full elements with
// every field set, and box labels only survive as separate bound-text
// elements (containerId on the text + boundElements on the container).
// This helper bakes that in so labels never vanish.
//
// Usage:
//   import { scene, PALETTE } from "./excalidraw.ts";
//   const s = scene({ dark: false });
//   s.text("t", 360, 10, "My diagram", 28);
//   s.labeledRect("a", 20, 130, 175, 70, PALETTE.light.blue, "to-spec", 18);
//   s.arrow("a1", 205, 165, [[0,0],[48,0]]);
//   console.log(JSON.stringify(s.build()));   // pipe/save, then export_to_excalidraw

export type El = Record<string, any>;

// [zoneBg, boxFill, accent] per family. Pulled from the server's read_me palette.
export const PALETTE = {
  light: {
    purple: ["#e5dbff", "#d0bfff", "#8b5cf6"], blue: ["#dbe4ff", "#a5d8ff", "#4a9eed"],
    amber: ["#fff3bf", "#fff3bf", "#f59e0b"], green: ["#d3f9d8", "#b2f2bb", "#22c55e"],
    cyan: ["#c3fae8", "#c3fae8", "#06b6d4"], red: ["#ffe3e3", "#ffc9c9", "#ef4444"],
  },
  dark: {
    purple: ["#2d1b69", "#3b2a7a", "#a78bfa"], blue: ["#1e3a5f", "#234a73", "#60a5fa"],
    amber: ["#5c3d1a", "#6b4a22", "#fbbf24"], green: ["#1a4d2e", "#205c38", "#4ade80"],
    cyan: ["#1a4d4d", "#206060", "#22d3ee"], red: ["#5c1a1a", "#6b2222", "#f87171"],
  },
} as const;
export type Family = [string, string, string]; // [zoneBg, boxFill, accent]

export function scene(opts: { dark?: boolean } = {}) {
  const DARK = !!opts.dark;
  const ink = DARK ? "#e5e5e5" : "#1e1e1e";
  const els: El[] = [];

  const base = (e: El): El => ({
    angle: 0, backgroundColor: "transparent", fillStyle: "solid",
    strokeWidth: 2, strokeStyle: "solid", roughness: 1, opacity: 100,
    groupIds: [], frameId: null, roundness: null, seed: 1,
    version: 1, versionNonce: 1, isDeleted: false, boundElements: null,
    updated: 1, link: null, locked: false, strokeColor: ink, ...e,
  });
  const baseText = (e: El): El => ({
    ...base(e), type: "text", strokeWidth: 1, fontFamily: 1,
    textAlign: e.textAlign ?? "left", verticalAlign: e.verticalAlign ?? "top",
    containerId: e.containerId ?? null, lineHeight: 1.25, originalText: e.text, autoResize: true,
  });
  // crude width estimate; Excalidraw re-measures on load, this only seeds layout
  const w = (t: string, fs: number) => t.length * fs * 0.55;

  // Standalone title/annotation text. x is the LEFT edge.
  const text = (id: string, x: number, y: number, t: string, fontSize: number, color = ink) =>
    els.push(baseText({ id, x, y, width: w(t, fontSize), height: fontSize * 1.25, text: t, fontSize, strokeColor: color }));

  // Rectangle with a centered, auto-surviving label. Pass a PALETTE family for colors.
  const labeledRect = (id: string, x: number, y: number, width: number, height: number, fam: Family, label: string, fontSize: number) => {
    const [, fill, accent] = fam;
    const tid = id + "_t";
    els.push(base({ type: "rectangle", id, x, y, width, height, backgroundColor: fill, fillStyle: "solid", strokeColor: accent, strokeWidth: 2, roundness: { type: 3 }, boundElements: [{ type: "text", id: tid }] }));
    const tw = w(label, fontSize);
    els.push(baseText({ id: tid, x: x + (width - tw) / 2, y: y + (height - fontSize * 1.25) / 2, width: tw, height: fontSize * 1.25, text: label, fontSize, strokeColor: DARK ? "#e5e5e5" : "#1e1e1e", textAlign: "center", verticalAlign: "middle", containerId: id }));
  };

  // Arrow from (x,y) along point offsets. Multi-point = elbow. Optional bound label.
  const arrow = (id: string, x: number, y: number, pts: number[][], color = ink, label?: string) => {
    const width = Math.max(...pts.map(p => p[0])) - Math.min(...pts.map(p => p[0]));
    const height = Math.max(...pts.map(p => p[1])) - Math.min(...pts.map(p => p[1]));
    const e: El = base({ type: "arrow", id, x, y, width, height, points: pts, strokeColor: color, strokeWidth: 2, endArrowhead: "arrow", startArrowhead: null, lastCommittedPoint: null, startBinding: null, endBinding: null });
    if (label) {
      const tid = id + "_t";
      e.boundElements = [{ type: "text", id: tid }];
      els.push(e);
      els.push(baseText({ id: tid, x: x + width / 2 - w(label, 14) / 2, y: y + height / 2 - 10, width: w(label, 14), height: 20, text: label, fontSize: 14, strokeColor: color, textAlign: "center", verticalAlign: "middle", containerId: id }));
    } else els.push(e);
  };

  // Faint grouping rectangle behind a cluster. Pass a PALETTE family.
  const zone = (id: string, x: number, y: number, width: number, height: number, fam: Family) =>
    els.push(base({ type: "rectangle", id, x, y, width, height, backgroundColor: fam[0], fillStyle: "solid", strokeColor: fam[2], strokeWidth: 1, opacity: 30, roundness: { type: 3 } }));

  const raw = (e: El) => els.push(base(e)); // escape hatch for ellipse/diamond/etc.

  const build = () => {
    const all = [...els];
    if (DARK) all.unshift(base({ type: "rectangle", id: "darkbg", x: -4000, y: -3000, width: 10000, height: 7500, backgroundColor: "#1e1e2e", fillStyle: "solid", strokeColor: "transparent", strokeWidth: 0 }));
    return { type: "excalidraw", version: 2, source: "https://excalidraw.com", elements: all, appState: { viewBackgroundColor: DARK ? "#1e1e2e" : "#ffffff", gridSize: null } };
  };

  return { text, labeledRect, arrow, zone, raw, build, dark: DARK };
}
