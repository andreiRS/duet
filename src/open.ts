import * as fs from "fs";
import type { El } from "./scene-types";
import { readSceneFile, elementsOf } from "./scene-io";
import { atomicWriteScene } from "./writeback";
import { makeVerbs, type Verbs } from "./authoring";
import { checkGeometry, isStructural, type Violation } from "./geometry";
import { diffById, mergeById } from "./reconcile";

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
 * Reconcile the agent's elements with the current on-disk file at write time
 * (ADR-0007 forward-race fix). Pure-ish: reads the file, returns the merged
 * elements to write (does not write).
 *
 * - First save (file does not exist yet): nothing to re-read, return as-is.
 * - Otherwise: re-read disk, compute the agent's dirty-set
 *   (`diffById(baseline, agent)` = added ∪ moved ∪ retyped). Stamp those ids'
 *   `version` to `max(loadedVersion, currentDiskVersion) + 1` with a fresh
 *   `versionNonce`, so the agent's edits win the merge tiebreak. Untouched
 *   elements keep their loaded version, so a concurrent human edit to them
 *   survives on its higher disk version.
 * - Drop ids the agent intentionally deleted from the on-disk side so the
 *   "keep on-disk" merge rule does not resurrect them, then `mergeById`.
 */
function reconcileForWrite(filePath: string, baseline: El[], agent: El[]): El[] {
  if (!fs.existsSync(filePath)) return agent;

  let disk: El[];
  try {
    disk = elementsOf(readSceneFile(filePath));
  } catch (cause) {
    // On-disk file unreadable mid-save. We must NOT fall back to writing the
    // agent's elements — that would blind-overwrite concurrent on-disk state,
    // the exact race ADR-0007 closes. Fail loudly instead (mirrors open()'s
    // fail-fast on a malformed read) so nothing is written.
    throw new Error(
      `save(${filePath}): on-disk scene was unreadable at save time — refusing to overwrite to avoid clobbering concurrent edits: ${(cause as Error).message}`,
      { cause }
    );
  }

  const diff = diffById(baseline, agent);
  const dirty = new Set<string>([...diff.added, ...diff.moved, ...diff.retyped]);
  const diskById = new Map(disk.map((e) => [e.id, e]));

  // Stamp the agent's changed/added ids so they win the merge tiebreak.
  const stamped = agent.map((e) => {
    if (!dirty.has(e.id)) return e;
    const loadedVersion = (e.version as number) ?? 0;
    const diskVersion = (diskById.get(e.id)?.version as number) ?? 0;
    return {
      ...e,
      version: Math.max(loadedVersion, diskVersion) + 1,
      versionNonce: freshNonce(),
    };
  });

  // Honor agent deletions: an id the agent removed from its array must not be
  // re-added by mergeById's "keep on-disk" rule.
  //
  // NOTE: this is the one path that deliberately ignores the disk `version` for
  // an id (every other path respects it). Per ADR-0007's accepted same-id LWW,
  // an agent array-delete means "agent intentionally removed → stays gone",
  // regardless of what version the disk copy carries.
  const deleted = new Set(diff.deleted);
  const diskKept = disk.filter((e) => !deleted.has(e.id));

  return mergeById(diskKept, stamped);
}

// A fresh versionNonce, in the same value space Excalidraw uses (a 32-bit int).
function freshNonce(): number {
  return Math.floor(Math.random() * 0x7fffffff);
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
  let parsed: ReturnType<typeof readSceneFile> | undefined;
  if (exists) {
    try {
      parsed = readSceneFile(filePath);
    } catch (cause) {
      throw new Error(
        `open(${filePath}): malformed .excalidraw (invalid JSON): ${(cause as Error).message}`,
        { cause }
      );
    }
    // Valid JSON but not an Excalidraw scene (null, number, string, array, or an
    // object with no elements array) — fail fast so a later save() can't silently
    // overwrite the corrupt-but-existing file with an empty scene.
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      !Array.isArray((parsed as { elements?: unknown }).elements)
    ) {
      throw new Error(
        `open(${filePath}): malformed .excalidraw (not a valid scene: missing elements array)`
      );
    }
  }
  const elements: El[] = parsed ? elementsOf(parsed) : [];
  const appState = parsed?.appState ?? {};

  // Baseline snapshot (deep copy of the loaded elements). At save() this lets us
  // diff what the AGENT changed/added/deleted, so we stamp only its own edits
  // and never resurrect an id the agent intentionally removed (ADR-0007).
  const baseline: El[] = elements.map((e) => structuredClone(e));

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
        // Caller opted out of checking — ok:true is a no-check contract, not a geometry guarantee.
        const merged = reconcileForWrite(filePath, baseline, elements);
        atomicWriteScene(filePath, { elements: merged, appState }, opts?.source ?? "duet");
        elements.splice(0, elements.length, ...merged);
        return { ok: true, fixed: [] };
      }

      const result = checkGeometry(elements);

      // Structural violations: throw before writing anything
      const structural = result.remaining.filter((v) => isStructural(v.type));
      if (structural.length > 0) {
        const desc = structural.map((v) => `${v.type}(${v.ids.join(",")})`).join("; ");
        throw new Error(`save() aborted: structural geometry violations detected — ${desc}`);
      }

      // Mechanical auto-fixes: the violations that are in `violations` but not in `remaining`.
      // Sort ids before joining so the key is order-independent (defensive against
      // non-deterministic id ordering in future detectors).
      const remainingKeys = new Set(
        result.remaining.map((v) => `${v.type}:${[...v.ids].sort().join(",")}`)
      );
      const autoFixed = result.violations.filter(
        (v) => !remainingKeys.has(`${v.type}:${[...v.ids].sort().join(",")}`)
      );

      // Reconcile against the current on-disk file (catches a concurrent human
      // edit) AFTER the geometry auto-fix, so fixed coords are included in the
      // agent's dirty-set stamping. Then write the merged result atomically and
      // keep the live array in sync.
      const merged = reconcileForWrite(filePath, baseline, result.fixed);
      atomicWriteScene(filePath, { elements: merged, appState }, opts?.source ?? "duet");
      elements.splice(0, elements.length, ...merged);

      // Reflect the geometry check's own ok: false when a mechanical violation
      // survived the auto-fix loop (e.g. hit the 50-pass cap).
      return { ok: result.ok, fixed: autoFixed };
    },
  };
}
