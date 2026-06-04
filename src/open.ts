import * as fs from "fs";
import type { El } from "./scene-types";
import { readSceneFile, elementsOf } from "./scene-io";
import { atomicWriteScene } from "./writeback";
import { makeVerbs, type Verbs } from "./authoring";

/**
 * A loaded-or-created scene handle: query (list/byId), authoring verbs that
 * mutate the handle's element list IN PLACE, and an atomic save().
 * Verbs and save() operate on the SAME live element array.
 */
export interface OpenScene extends Verbs {
  /** All elements in file order. The live array — verb mutations show here. */
  list(): El[];
  /** The element with the given id, or undefined. */
  byId(id: string): El | undefined;
  /**
   * Atomically write the current state back to the file.
   * No EchoGuard: the agent's own write must reach the watcher and broadcast.
   * @param opts.source  Defaults to "duet".
   */
  save(opts?: { source?: string }): void;
}

/**
 * Open a .excalidraw file: load it if it exists, else start empty (NO write to
 * disk until save() is called — mirrors cli.ts ensureScene's start-empty
 * behavior but defers the write). The returned handle exposes the same
 * authoring verbs scene() does, mutating its internal element list in place.
 * Human-drawn elements (unknown ids) are kept verbatim through load → save.
 */
export function open(filePath: string): OpenScene {
  const exists = fs.existsSync(filePath);
  const parsed = exists ? readSceneFile(filePath) : undefined;
  const elements: El[] = parsed ? elementsOf(parsed) : [];
  const appState = parsed?.appState ?? {};

  const verbs = makeVerbs(elements);

  return {
    ...verbs,

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
