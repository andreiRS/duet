import type { El } from "./scene-types";
import { readSceneFile, elementsOf } from "./scene-io";
import { atomicWriteScene } from "./writeback";

export interface LoadedScene {
  /** All elements in file order. The returned array is the live copy — mutations to elements are reflected on save. */
  list(): El[];
  /** The element with the given id, or undefined if not found. */
  byId(id: string): El | undefined;
  /**
   * Atomically write the current state back to the source file.
   * No EchoGuard: the agent's own write must reach the watcher and broadcast.
   * @param opts.source  Defaults to "duet" so the client flashes the human.
   */
  save(opts?: { source?: string }): void;
}

/**
 * Read an existing .excalidraw file from disk and return a loaded-scene object.
 * Elements are kept verbatim (including human-drawn ones with unknown ids).
 * Mutations to the returned elements are saved via .save(opts).
 */
export function load(filePath: string): LoadedScene {
  const parsed = readSceneFile(filePath);
  const elements: El[] = elementsOf(parsed);
  const appState = parsed.appState ?? {};

  return {
    list(): El[] {
      return elements;
    },

    byId(id: string): El | undefined {
      return elements.find((e) => e.id === id);
    },

    save(opts?: { source?: string }): void {
      atomicWriteScene(filePath, { elements, appState }, opts?.source ?? "duet");
    },
  };
}
