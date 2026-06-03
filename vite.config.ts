import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cpSync } from "fs";
import { join, resolve } from "path";
import type { Plugin } from "vite";

function copyExcalidrawFonts(): Plugin {
  return {
    name: "copy-excalidraw-fonts",
    closeBundle() {
      const src = resolve(
        "node_modules/@excalidraw/excalidraw/dist/prod/fonts"
      );
      const dest = join("dist", "fonts");
      cpSync(src, dest, { recursive: true });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), copyExcalidrawFonts()],
  build: {
    target: "es2022",
    outDir: "dist",
  },
  optimizeDeps: {
    esbuildOptions: {
      target: "es2022",
    },
  },
});
