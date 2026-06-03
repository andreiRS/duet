import * as fs from "fs";
import type { ExcalidrawScene, El } from "./scene-types";

export function readSceneFile(filePath: string): ExcalidrawScene {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as ExcalidrawScene;
}

export function elementsOf(scene: { elements?: unknown }): El[] {
  return Array.isArray(scene.elements) ? (scene.elements as El[]) : [];
}
