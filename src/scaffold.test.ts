import { describe, it, expect } from "bun:test";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

function isExact(version: string) {
  return /^\d+\.\d+\.\d+$/.test(version);
}

describe("package.json — pinned deps", () => {
  const expected = [
    ["@excalidraw/excalidraw", "0.18.1"],
    ["react", "19.2.7"],
    ["react-dom", "19.2.7"],
    ["vite", "8.0.16"],
    ["@vitejs/plugin-react", "6.0.2"],
  ];

  for (const [pkg_, version] of expected) {
    it(`pins ${pkg_} at ${version}`, () => {
      expect(allDeps[pkg_]).toBe(version);
      expect(isExact(allDeps[pkg_])).toBe(true);
    });
  }
});

describe("vite.config — build settings", () => {
  // Parse the config by reading the source; we can't import it here without
  // running Vite's own resolution, so we check the raw text for the key values.
  const configPath = join(root, "vite.config.ts");

  it("vite.config.ts exists", () => {
    expect(existsSync(configPath)).toBe(true);
  });

  it('build.target is "es2022"', () => {
    const src = readFileSync(configPath, "utf-8");
    expect(src).toMatch(/build\s*:\s*\{[^}]*target\s*:\s*["']es2022["']/s);
  });

  it('optimizeDeps.esbuildOptions.target is "es2022"', () => {
    const src = readFileSync(configPath, "utf-8");
    expect(src).toMatch(/esbuildOptions\s*:\s*\{[^}]*target\s*:\s*["']es2022["']/s);
  });

  it('base is "./"', () => {
    const src = readFileSync(configPath, "utf-8");
    expect(src).toMatch(/base\s*:\s*["']\.\/["']/);
  });
});

describe("app source — Excalidraw mounted", () => {
  it("src/App.tsx imports and renders <Excalidraw />", () => {
    const appPath = join(root, "src", "App.tsx");
    expect(existsSync(appPath)).toBe(true);
    const src = readFileSync(appPath, "utf-8");
    expect(src).toMatch(/@excalidraw\/excalidraw/);
    expect(src).toMatch(/<Excalidraw/);
  });

  it("src/main.tsx mounts the React app", () => {
    const mainPath = join(root, "src", "main.tsx");
    expect(existsSync(mainPath)).toBe(true);
    const src = readFileSync(mainPath, "utf-8");
    expect(src).toMatch(/createRoot|render/);
  });

  it("index.html exists at repo root with a script entry", () => {
    const htmlPath = join(root, "index.html");
    expect(existsSync(htmlPath)).toBe(true);
    const src = readFileSync(htmlPath, "utf-8");
    expect(src).toMatch(/src\/main\.tsx/);
  });
});

describe("build output — dist/ contents (run `bun run build` first)", () => {
  const dist = join(root, "dist");
  const assets = join(dist, "assets");

  it("dist/index.html exists", () => {
    expect(existsSync(join(dist, "index.html"))).toBe(true);
  });

  it("dist/assets/ contains hashed JS chunk files", () => {
    expect(existsSync(assets)).toBe(true);
    const files = readdirSync(assets);
    // Vite hashes: name-HASH.js (hash is 8 uppercase alphanum chars)
    const hashedJs = files.filter((f) => /-[A-Za-z0-9]{8}\.js$/.test(f));
    expect(hashedJs.length).toBeGreaterThan(0);
  });

  it("dist/assets/ contains hashed CSS files", () => {
    const files = readdirSync(assets);
    const hashedCss = files.filter((f) => /-[A-Za-z0-9]{8}\.css$/.test(f));
    expect(hashedCss.length).toBeGreaterThan(0);
  });
});
