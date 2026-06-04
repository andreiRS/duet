import * as fs from "fs";
import type { El } from "./scene-types";
import { readSceneFile, elementsOf } from "./scene-io";
import { atomicWriteScene } from "./writeback";
import { makeVerbs, type Verbs } from "./authoring";
import { checkGeometry, isStructural, type Violation } from "./geometry";

/** What save() returns: the mechanical violations that were auto-fixed. */
export interface SaveReport {
  /** true when the written scene has no remaining violations. */
  ok: boolean;
  /** The mechanical violations that were auto-fixed before writing. */
  fixed: Violation[];
}

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
   * By default runs the geometry check before writing:
   *   - Auto-fixes mechanical violations (spacing-too-close, off-canvas, label-wider-than-box).
   *   - Throws on structural violations (box-overlap, arrow-misses-target) — nothing is written.
   * Pass `check: false` to skip the check entirely (writes as-is).
   * @param opts.source  Defaults to "duet".
   * @param opts.check   Defaults to true.
   */
  save(opts?: { source?: string; check?: boolean }): SaveReport;
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

    save(opts?: { source?: string; check?: boolean }): SaveReport {
      const check = opts?.check !== false; // defaults to true
      if (!check) {
        atomicWriteScene(filePath, { elements, appState }, opts?.source ?? "duet");
        return { ok: true, fixed: [] };
      }

      const result = checkGeometry(elements);

      // Structural violations: throw before writing anything
      const structural = result.remaining.filter((v) => isStructural(v.type));
      if (structural.length > 0) {
        const desc = structural.map((v) => `${v.type}(${v.ids.join(",")})`).join("; ");
        throw new Error(`save() aborted: structural geometry violations detected — ${desc}`);
      }

      // Mechanical auto-fixes: the violations that are in `violations` but not in `remaining`
      const remainingTypes = new Set(result.remaining.map((v) => `${v.type}:${v.ids.join(",")}`));
      const autoFixed = result.violations.filter(
        (v) => !remainingTypes.has(`${v.type}:${v.ids.join(",")}`)
      );

      // Write the auto-corrected elements. Keep the live array in sync.
      atomicWriteScene(filePath, { elements: result.fixed, appState }, opts?.source ?? "duet");
      elements.splice(0, elements.length, ...result.fixed);

      return { ok: true, fixed: autoFixed };
    },
  };
}
