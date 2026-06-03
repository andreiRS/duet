import { describe, it, expect } from "bun:test";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "..");
const dist = join(root, "dist");
const distFonts = join(dist, "fonts");

// Behavior 1: dist/fonts/ exists after build and contains .woff2 files
describe("offline assets — fonts in dist/ (run `bun run build` first)", () => {
  it("dist/fonts/ directory exists", () => {
    expect(existsSync(distFonts)).toBe(true);
  });

  it("dist/fonts/ contains subdirectories for each font family", () => {
    const entries = readdirSync(distFonts);
    expect(entries.length).toBeGreaterThan(0);
  });

  it("dist/fonts/ contains .woff2 files", () => {
    function findWoff2(dir: string): string[] {
      const results: string[] = [];
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...findWoff2(full));
        } else if (entry.name.endsWith(".woff2")) {
          results.push(full);
        }
      }
      return results;
    }
    const woff2Files = findWoff2(distFonts);
    expect(woff2Files.length).toBeGreaterThan(0);
  });

  it("dist/fonts/ contains Excalifont files (Excalidraw's primary handwriting font)", () => {
    const excalifontDir = join(distFonts, "Excalifont");
    expect(existsSync(excalifontDir)).toBe(true);
    const files = readdirSync(excalifontDir);
    const woff2 = files.filter((f) => f.endsWith(".woff2"));
    expect(woff2.length).toBeGreaterThan(0);
  });
});

// Behavior 2: index.html sets EXCALIDRAW_ASSET_PATH before the module script
describe("offline assets — EXCALIDRAW_ASSET_PATH in index.html", () => {
  const htmlPath = join(root, "index.html");
  const html = readFileSync(htmlPath, "utf-8");

  it('index.html has an inline script setting window.EXCALIDRAW_ASSET_PATH to "./"', () => {
    expect(html).toMatch(/window\.EXCALIDRAW_ASSET_PATH\s*=\s*["']\.\//);
  });

  it("inline EXCALIDRAW_ASSET_PATH script appears BEFORE the module script tag", () => {
    const assetPathIdx = html.indexOf("EXCALIDRAW_ASSET_PATH");
    const moduleScriptIdx = html.indexOf('type="module"');
    expect(assetPathIdx).toBeGreaterThan(-1);
    expect(moduleScriptIdx).toBeGreaterThan(-1);
    expect(assetPathIdx).toBeLessThan(moduleScriptIdx);
  });

  it("the inline script is NOT a module (runs synchronously before bundle loads)", () => {
    // Find the inline script block containing EXCALIDRAW_ASSET_PATH
    const scriptMatch = html.match(/<script(?![^>]*type=["']module["'])[^>]*>[\s\S]*?EXCALIDRAW_ASSET_PATH[\s\S]*?<\/script>/);
    expect(scriptMatch).not.toBeNull();
  });
});

// Behavior 3 (deferred): No CDN requests at runtime
// AC3 requires a browser + network interceptor — deferred to the /run checkpoint.
// As a lightweight proxy check: the built dist/index.html should NOT hardcode
// known Excalidraw CDN font hostnames.
describe("offline assets — no CDN font URLs in built output (run `bun run build` first)", () => {
  it("dist/index.html does not contain excalidraw CDN font references", () => {
    const builtHtml = readFileSync(join(dist, "index.html"), "utf-8");
    expect(builtHtml).not.toMatch(/esm\.sh.*excalidraw/);
    expect(builtHtml).not.toMatch(/unpkg\.com.*excalidraw/);
    expect(builtHtml).not.toMatch(/excalidraw\.com\/fonts/);
  });
});
