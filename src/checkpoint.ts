import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import type { ExcalidrawScene } from "./scene-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CheckpointEntry {
  /** Unique string id: "<seq>-<timestamp>-<random>" — sortable by sequence. */
  id: string;
  /** Monotonic sequence number (1-based, never reset). */
  seq: number;
  /** Unix ms timestamp from the injected clock. */
  timestamp: number;
  /** Agent-supplied label, or null for auto checkpoints. */
  label: string | null;
  /** Relative path (from .duet/ dir) to the stored scene JSON. */
  sceneFile: string;
}

export interface CheckpointStore {
  /** Save current scene state as a new checkpoint. */
  save(scene: ExcalidrawScene, opts?: { label?: string }): CheckpointEntry;
  /** All checkpoints, newest-first. */
  list(): CheckpointEntry[];
  /** Most recently saved checkpoint, or undefined if none. */
  latest(): CheckpointEntry | undefined;
  /** Find a checkpoint by id or label. Returns undefined if not found. */
  get(idOrLabel: string): CheckpointEntry | undefined;
  /** Delete a checkpoint (the only way a labeled one is removed). */
  delete(idOrLabel: string): void;
  /** Read a checkpoint's stored scene from disk. */
  readScene(entry: CheckpointEntry): ExcalidrawScene;
}

// ---------------------------------------------------------------------------
// On-disk layout
// ---------------------------------------------------------------------------
//
//  .duet/
//    manifest.json            — list of CheckpointEntry (in insertion order)
//    scenes/
//      <entry.sceneFile>      — the scene JSON (atomically written)
//
// manifest.json is the source of truth; the store reads it on open.
// Scene files are written atomically (temp + rename).
// ---------------------------------------------------------------------------

const HISTORY_CAP = 10;
const MANIFEST_FILE = "manifest.json";

function duetDir(sourceFilePath: string): string {
  return path.join(path.dirname(path.resolve(sourceFilePath)), ".duet");
}

function readManifest(dir: string): CheckpointEntry[] {
  const p = path.join(dir, MANIFEST_FILE);
  if (!fs.existsSync(p)) return [];
  try {
    const raw = fs.readFileSync(p, "utf8");
    return JSON.parse(raw) as CheckpointEntry[];
  } catch {
    return [];
  }
}

function writeManifest(dir: string, entries: CheckpointEntry[]): void {
  const p = path.join(dir, MANIFEST_FILE);
  const tmpP = `${p}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmpP, JSON.stringify(entries, null, 2), "utf8");
  fs.renameSync(tmpP, p);
}

function writeSceneAtomic(scenePath: string, scene: ExcalidrawScene): void {
  const bytes = JSON.stringify(scene, null, 2);
  const tmpPath = `${scenePath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmpPath, bytes, "utf8");
  fs.renameSync(tmpPath, scenePath);
}

function prune(entries: CheckpointEntry[], dir: string): CheckpointEntry[] {
  // Count only auto (label === null) entries
  const autos = entries.filter((e) => e.label === null);
  if (autos.length <= HISTORY_CAP) return entries;

  // Prune the oldest auto entries (they are in insertion order — oldest first)
  const toRemove = autos.length - HISTORY_CAP;
  const removeIds = new Set(autos.slice(0, toRemove).map((e) => e.id));

  const kept: CheckpointEntry[] = [];
  for (const e of entries) {
    if (removeIds.has(e.id)) {
      // Delete the scene file too
      const scenePath = path.join(dir, e.sceneFile);
      if (fs.existsSync(scenePath)) fs.rmSync(scenePath);
    } else {
      kept.push(e);
    }
  }
  return kept;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function openCheckpointStore(
  sourceFilePath: string,
  opts: { now?: () => number } = {},
): CheckpointStore {
  const now = opts.now ?? (() => Date.now());
  const dir = duetDir(sourceFilePath);
  const scenesDir = path.join(dir, "scenes");

  // Ensure directories exist
  fs.mkdirSync(scenesDir, { recursive: true });

  // Load existing manifest
  let entries: CheckpointEntry[] = readManifest(dir);

  // Derive next sequence from existing entries (survives new processes)
  function nextSeq(): number {
    if (entries.length === 0) return 1;
    return Math.max(...entries.map((e) => e.seq)) + 1;
  }

  function persist(): void {
    writeManifest(dir, entries);
  }

  return {
    save(scene: ExcalidrawScene, saveOpts?: { label?: string }): CheckpointEntry {
      const seq = nextSeq();
      const timestamp = now();
      const label = saveOpts?.label ?? null;
      const rand = crypto.randomBytes(4).toString("hex");
      const id = `${String(seq).padStart(6, "0")}-${timestamp}-${rand}`;
      const sceneFileName = `scenes/${id}.json`;

      // Write scene atomically
      const scenePath = path.join(dir, sceneFileName);
      writeSceneAtomic(scenePath, scene);

      const entry: CheckpointEntry = { id, seq, timestamp, label, sceneFile: sceneFileName };
      entries.push(entry);

      // Prune and persist
      entries = prune(entries, dir);
      persist();

      return entry;
    },

    list(): CheckpointEntry[] {
      // newest-first by sequence
      return [...entries].sort((a, b) => b.seq - a.seq);
    },

    latest(): CheckpointEntry | undefined {
      if (entries.length === 0) return undefined;
      return [...entries].sort((a, b) => b.seq - a.seq)[0];
    },

    get(idOrLabel: string): CheckpointEntry | undefined {
      return entries.find((e) => e.id === idOrLabel || (e.label !== null && e.label === idOrLabel));
    },

    delete(idOrLabel: string): void {
      const entry = entries.find(
        (e) => e.id === idOrLabel || (e.label !== null && e.label === idOrLabel),
      );
      if (!entry) return;

      // Remove scene file
      const scenePath = path.join(dir, entry.sceneFile);
      if (fs.existsSync(scenePath)) fs.rmSync(scenePath);

      entries = entries.filter((e) => e.id !== entry.id);
      persist();
    },

    readScene(entry: CheckpointEntry): ExcalidrawScene {
      const scenePath = path.join(dir, entry.sceneFile);
      const raw = fs.readFileSync(scenePath, "utf8");
      return JSON.parse(raw) as ExcalidrawScene;
    },
  };
}
