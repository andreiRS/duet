// Local Excalidraw renderer: scene JSON -> SVG -> PNG, no network, no excalidraw.com.
// Reads Excalidraw JSON from a file path (arg) or stdin, writes a PNG next to it.
//
//   bun render.ts /tmp/diagram.json            # -> /tmp/diagram.png
//   bun gen.ts | bun render.ts - /tmp/out.png  # from stdin
//
// Handles exactly what the helper (excalidraw.ts) emits: rectangle, text,
// arrow (multi-point + bound label), zone (faint rect), ellipse/diamond (raw).

import { RoughGenerator } from "roughjs/bin/generator";
import { Resvg } from "@resvg/resvg-js";

const gen = new RoughGenerator();

type El = Record<string, any>;
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// roughjs Drawable -> SVG <path> strings
function roughPaths(d: any): string {
  return gen
    .toPaths(d)
    .map(
      (p) =>
        `<path d="${p.d}" stroke="${p.stroke}" stroke-width="${p.strokeWidth}" fill="${p.fill}" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
    .join("");
}

function renderEl(el: El): string {
  if (el.isDeleted) return "";
  const o = {
    roughness: el.roughness ?? 1,
    seed: el.seed ?? 1,
    stroke: el.strokeColor ?? "#1e1e1e",
    strokeWidth: el.strokeWidth ?? 2,
    fill: el.backgroundColor && el.backgroundColor !== "transparent" ? el.backgroundColor : undefined,
    fillStyle: el.fillStyle ?? "solid",
  };
  const op = el.opacity != null ? el.opacity / 100 : 1;
  const wrap = (inner: string) => (op < 1 ? `<g opacity="${op}">${inner}</g>` : inner);

  switch (el.type) {
    case "rectangle": {
      const r = el.roundness ? Math.min(el.width, el.height) * 0.18 : 0;
      // roughjs has no rounded-rect; approximate with a path for rounded, plain rectangle otherwise
      const d = r
        ? gen.path(roundedRectPath(el.x, el.y, el.width, el.height, r), o)
        : gen.rectangle(el.x, el.y, el.width, el.height, o);
      return wrap(roughPaths(d));
    }
    case "ellipse":
      return wrap(roughPaths(gen.ellipse(el.x + el.width / 2, el.y + el.height / 2, el.width, el.height, o)));
    case "diamond": {
      const { x, y, width: w, height: h } = el;
      const pts: [number, number][] = [
        [x + w / 2, y],
        [x + w, y + h / 2],
        [x + w / 2, y + h],
        [x, y + h / 2],
        [x + w / 2, y],
      ];
      return wrap(roughPaths(gen.linearPath(pts, o)));
    }
    case "arrow":
    case "line": {
      const pts: [number, number][] = (el.points ?? [[0, 0]]).map((p: number[]) => [el.x + p[0], el.y + p[1]]);
      let svg = roughPaths(gen.linearPath(pts, { ...o, fill: undefined }));
      if (el.type === "arrow" && el.endArrowhead !== null && pts.length >= 2) {
        svg += arrowhead(pts[pts.length - 2], pts[pts.length - 1], o.stroke, o.strokeWidth);
      }
      return wrap(svg);
    }
    case "text": {
      const fs = el.fontSize ?? 20;
      const anchor = el.textAlign === "center" ? "middle" : el.textAlign === "right" ? "end" : "start";
      const x = anchor === "middle" ? el.x + el.width / 2 : anchor === "end" ? el.x + el.width : el.x;
      // bound labels are vertically centered in their container; standalone are top-anchored
      const lines = String(el.text ?? "").split("\n");
      const lh = fs * (el.lineHeight ?? 1.25);
      const blockH = lh * lines.length;
      const top = el.verticalAlign === "middle" ? el.y + (el.height - blockH) / 2 : el.y;
      return lines
        .map((ln: string, i: number) => {
          const baseline = top + lh * i + fs * 0.82; // ascent offset
          return `<text x="${x}" y="${baseline}" font-size="${fs}" fill="${el.strokeColor ?? "#1e1e1e"}" text-anchor="${anchor}" font-family="Comic Sans MS, Chalkboard, Segoe Print, sans-serif">${esc(ln)}</text>`;
        })
        .join("");
    }
    default:
      return "";
  }
}

function roundedRectPath(x: number, y: number, w: number, h: number, r: number): string {
  return [
    `M${x + r} ${y}`,
    `L${x + w - r} ${y}`,
    `Q${x + w} ${y} ${x + w} ${y + r}`,
    `L${x + w} ${y + h - r}`,
    `Q${x + w} ${y + h} ${x + w - r} ${y + h}`,
    `L${x + r} ${y + h}`,
    `Q${x} ${y + h} ${x} ${y + h - r}`,
    `L${x} ${y + r}`,
    `Q${x} ${y} ${x + r} ${y}`,
    "Z",
  ].join(" ");
}

function arrowhead(from: [number, number], to: [number, number], stroke: string, sw: number): string {
  const ang = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const len = 14;
  const spread = Math.PI / 7;
  const p1: [number, number] = [to[0] - len * Math.cos(ang - spread), to[1] - len * Math.sin(ang - spread)];
  const p2: [number, number] = [to[0] - len * Math.cos(ang + spread), to[1] - len * Math.sin(ang + spread)];
  const line = (a: [number, number], b: [number, number]) =>
    `<path d="M${a[0]} ${a[1]} L${b[0]} ${b[1]}" stroke="${stroke}" stroke-width="${sw}" fill="none" stroke-linecap="round"/>`;
  return line(to, p1) + line(to, p2);
}

function buildSvg(scene: any): string {
  const els: El[] = (scene.elements ?? []).filter((e: El) => !e.isDeleted);
  const bg = scene.appState?.viewBackgroundColor ?? "#ffffff";
  // bounds across all non-background elements (skip the huge dark bg rect)
  const real = els.filter((e) => e.id !== "darkbg");
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const e of real) {
    const xs = e.points ? e.points.map((p: number[]) => e.x + p[0]) : [e.x, e.x + (e.width ?? 0)];
    const ys = e.points ? e.points.map((p: number[]) => e.y + p[1]) : [e.y, e.y + (e.height ?? 0)];
    minX = Math.min(minX, ...xs); maxX = Math.max(maxX, ...xs);
    minY = Math.min(minY, ...ys); maxY = Math.max(maxY, ...ys);
  }
  const pad = 24;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
  const body = els.map(renderEl).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${minX} ${minY} ${w} ${h}"><rect x="${minX}" y="${minY}" width="${w}" height="${h}" fill="${bg}"/>${body}</svg>`;
}

// ---- CLI ----
const arg = process.argv[2];
const out = process.argv[3];
let raw: string;
let outPath: string;
if (!arg || arg === "-") {
  raw = await Bun.stdin.text();
  outPath = out ?? "/tmp/diagram.png";
} else {
  raw = await Bun.file(arg).text();
  outPath = out ?? arg.replace(/\.json$/, "") + ".png";
}
const scene = JSON.parse(raw);
const svg = buildSvg(scene);
const svgPath = outPath.replace(/\.png$/, "") + ".svg";
await Bun.write(svgPath, svg);
const png = new Resvg(svg, { fitTo: { mode: "width", value: Math.min(2000, Math.max(800, 2 * (new Resvg(svg).width))) } }).render().asPng();
await Bun.write(outPath, png);
console.error(`wrote ${svgPath} and ${outPath}`);
