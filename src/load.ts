import * as fs from "fs";
import type { El, ExcalidrawScene } from "./scene-types";
import { writeSceneFile, type EchoGuard } from "./writeback";

export interface LoadedScene {
  /** All elements in file order. The returned array is the live copy — mutations to elements are reflected on save. */
  list(): El[];
  /** The element with the given id, or undefined if not found. */
  byId(id: string): El | undefined;
  /** Atomically write the current state back to the source file. */
  save(guard: EchoGuard): void;
}

/**
 * Read an existing .excalidraw file from disk and return a loaded-scene object.
 * Elements are kept verbatim (including human-drawn ones with unknown ids).
 * Mutations to the returned elements are saved via .save(guard).
 */
export function load(filePath: string): LoadedScene {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as ExcalidrawScene;
  const elements: El[] = Array.isArray(parsed.elements) ? parsed.elements : [];
  const appState = parsed.appState ?? {};

  return {
    list(): El[] {
      return elements;
    },

    byId(id: string): El | undefined {
      return elements.find((e) => e.id === id);
    },

    save(guard: EchoGuard): void {
      writeSceneFile(filePath, { elements, appState }, guard, parsed.source ?? "duet");
    },
  };
}
