import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { writeSceneFile, EchoGuard } from "./writeback";
import { open } from "./open";
import { scene, PALETTE } from "./authoring";

let tmpDir: string;
afterEach(() => {
  if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
});
function makeTmpDir(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "duet-open-test-"));
  return tmpDir;
}
function writeTmp(dir: string, elements: unknown[], appState = {}): string {
  const filePath = path.join(dir, "scene.excalidraw");
  writeSceneFile(filePath, { elements, appState }, new EchoGuard());
  return filePath;
}

describe("open() on a missing path (AC1)", () => {
  it("starts empty and does NOT write to disk before save()", () => {
    const dir = makeTmpDir();
    const filePath = path.join(dir, "new.excalidraw");

    const h = open(filePath);
    expect(h.list()).toEqual([]);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("authoring verbs then save() produce a valid .excalidraw file", () => {
    const dir = makeTmpDir();
    const filePath = path.join(dir, "new.excalidraw");

    const h = open(filePath);
    h.labeledRect("api", 0, 0, 120, 60, ["#dbe4ff", "#a5d8ff", "#4a9eed"] as const, "API", 16);
    h.save();

    expect(fs.existsSync(filePath)).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(onDisk.type).toBe("excalidraw");
    expect(onDisk.version).toBe(2);
    expect(Array.isArray(onDisk.elements)).toBe(true);
    // rect + its bound text label
    expect(onDisk.elements.map((e: { id: string }) => e.id)).toEqual(["api", "api_t"]);
  });
});

describe("open() on an existing file (AC2)", () => {
  it("exposes authoring verbs that append to existing elements", () => {
    const dir = makeTmpDir();
    const filePath = writeTmp(dir, [{ id: "old", type: "rectangle", x: 0, y: 0 }]);

    const h = open(filePath);
    h.text("note", 10, 10, "hi", 16);

    expect(h.list().map((e) => e.id)).toEqual(["old", "note"]);
  });

  it("preserves human-drawn elements (unknown ids) untouched through load → author → save", () => {
    const dir = makeTmpDir();
    const humanEl = { id: "human-xyz-abc", type: "freedraw", x: 5, y: 5, points: [[0, 0], [1, 1]] };
    const filePath = writeTmp(dir, [humanEl]);

    const h = open(filePath);
    h.text("agent-note", 100, 100, "added", 16);
    h.save();

    const onDisk = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const humanAfter = onDisk.elements.find((e: { id: string }) => e.id === "human-xyz-abc");
    expect(humanAfter).toEqual(humanEl);
    expect(onDisk.elements.map((e: { id: string }) => e.id)).toEqual(["human-xyz-abc", "agent-note"]);
  });
});

describe("verbs mutate the handle in place (AC3)", () => {
  it("list() reflects mutations immediately, same live array", () => {
    const dir = makeTmpDir();
    const filePath = path.join(dir, "new.excalidraw");
    const h = open(filePath);

    const before = h.list();
    h.text("a", 0, 0, "x", 16);
    const after = h.list();

    // same live array reference grown in place
    expect(after).toBe(before);
    expect(after.map((e) => e.id)).toEqual(["a"]);
  });

  it("connect() binds two boxes (reuses authoring binding logic)", () => {
    const dir = makeTmpDir();
    const filePath = path.join(dir, "new.excalidraw");
    const h = open(filePath);

    h.labeledRect("a", 0, 0, 100, 60, ["", "#fff", "#000"] as const, "A", 16);
    h.labeledRect("b", 400, 0, 100, 60, ["", "#fff", "#000"] as const, "B", 16);
    h.connect("e", "a", "b");

    const arrow = h.byId("e")!;
    expect(arrow.type).toBe("arrow");
    expect((arrow.startBinding as { elementId: string }).elementId).toBe("a");
    expect((arrow.endBinding as { elementId: string }).elementId).toBe("b");
    // both boxes reference the arrow in boundElements
    const a = h.byId("a")!;
    const refs = (a.boundElements as { id: string }[]).map((r) => r.id);
    expect(refs).toContain("e");
  });
});

describe("open() keeps load() query + save() (AC: load tests still pass)", () => {
  it("byId hit and miss, save with source", () => {
    const dir = makeTmpDir();
    const filePath = writeTmp(dir, [{ id: "target", type: "rectangle", x: 0, y: 0 }]);
    const h = open(filePath);

    expect(h.byId("target")!.id).toBe("target");
    expect(h.byId("nope")).toBeUndefined();

    h.save({ source: "my-agent" });
    const onDisk = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(onDisk.source).toBe("my-agent");
  });
});

// ─── Issue #10: geometry check on save() ─────────────────────────────────────

describe("save() runs geometry check by default (issue #10)", () => {
  const blue = PALETTE.light.blue;
  const green = PALETTE.light.green;

  it("AC1: auto-fixes a spacing-too-close violation, writes corrected file, returns a report", () => {
    const dir = makeTmpDir();
    const filePath = path.join(dir, "scene.excalidraw");

    const s = scene();
    // two boxes only 5px apart — spacing-too-close (< 20px)
    s.labeledRect("a", 0, 0, 100, 60, blue, "A", 16);
    s.labeledRect("b", 105, 0, 100, 60, green, "B", 16);
    const built = s.build();

    const h = open(filePath);
    // Manually inject the violating elements so we bypass open()'s empty start
    (h.list() as any[]).push(...built.elements);

    const report = h.save();

    // Report names the fix
    expect(report.fixed.length).toBeGreaterThan(0);
    expect(report.fixed.some((v) => v.type === "spacing-too-close")).toBe(true);

    // File exists and the written elements no longer violate spacing
    const onDisk = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(onDisk.elements.length).toBeGreaterThan(0);
  });

  it("AC2: throws on box-overlap (structural) and writes NOTHING", () => {
    const dir = makeTmpDir();
    const filePath = path.join(dir, "scene.excalidraw");

    const s = scene();
    s.labeledRect("a", 0, 0, 100, 100, blue, "A", 16);
    s.labeledRect("b", 50, 50, 100, 100, green, "B", 16); // overlapping
    const built = s.build();

    const h = open(filePath);
    (h.list() as any[]).push(...built.elements);

    expect(() => h.save()).toThrow();
    // File must NOT have been created
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("AC3: report has ok:true and lists what was auto-fixed", () => {
    const dir = makeTmpDir();
    const filePath = path.join(dir, "scene.excalidraw");

    const s = scene();
    s.labeledRect("a", 0, 0, 100, 60, blue, "A", 16);
    s.labeledRect("b", 105, 0, 100, 60, green, "B", 16); // spacing-too-close
    const built = s.build();

    const h = open(filePath);
    (h.list() as any[]).push(...built.elements);

    const report = h.save();
    expect(report.ok).toBe(true);
    expect(Array.isArray(report.fixed)).toBe(true);
    expect(report.fixed.length).toBeGreaterThan(0);
  });

  it("AC4: save({ check: false }) skips the check and writes even a structural violation", () => {
    const dir = makeTmpDir();
    const filePath = path.join(dir, "scene.excalidraw");

    const s = scene();
    s.labeledRect("a", 0, 0, 100, 100, blue, "A", 16);
    s.labeledRect("b", 50, 50, 100, 100, green, "B", 16); // overlapping — structural
    const built = s.build();

    const h = open(filePath);
    (h.list() as any[]).push(...built.elements);

    // Must NOT throw and must write the file
    expect(() => h.save({ check: false })).not.toThrow();
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it("clean scene: save() returns ok:true with no fixes", () => {
    const dir = makeTmpDir();
    const filePath = path.join(dir, "scene.excalidraw");

    const s = scene();
    s.labeledRect("a", 0, 0, 100, 60, blue, "A", 16);
    const built = s.build();

    const h = open(filePath);
    (h.list() as any[]).push(...built.elements);

    const report = h.save();
    expect(report.ok).toBe(true);
    expect(report.fixed).toEqual([]);
  });
});

// ─── Issue #11: open() fails fast on a malformed read ────────────────────────

describe("open() on a malformed .excalidraw file (issue #11)", () => {
  it("AC1: throws a clear, identifiable error — message mentions malformed/invalid JSON and the path", () => {
    const dir = makeTmpDir();
    const filePath = path.join(dir, "corrupt.excalidraw");
    fs.writeFileSync(filePath, "{ not valid json");

    expect(() => open(filePath)).toThrow(/malformed|invalid JSON/i);
    expect(() => open(filePath)).toThrow(filePath);
  });

  it("AC2: writes nothing when the read fails — the corrupt file bytes are unchanged", () => {
    const dir = makeTmpDir();
    const filePath = path.join(dir, "corrupt.excalidraw");
    const corrupt = "{ truncated";
    fs.writeFileSync(filePath, corrupt);

    try { open(filePath); } catch {}

    expect(fs.readFileSync(filePath, "utf8")).toBe(corrupt);
    // No extra files created
    expect(fs.readdirSync(dir)).toEqual(["corrupt.excalidraw"]);
  });

  it("AC3: a valid file is unaffected — loads, verbs work, save works", () => {
    const dir = makeTmpDir();
    const filePath = writeTmp(dir, [{ id: "existing", type: "rectangle", x: 0, y: 0 }]);

    const h = open(filePath);
    expect(h.byId("existing")!.id).toBe("existing");

    h.text("added", 10, 10, "hello", 16);
    h.save();

    const onDisk = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(onDisk.elements.map((e: { id: string }) => e.id)).toContain("existing");
    expect(onDisk.elements.map((e: { id: string }) => e.id)).toContain("added");
  });
});
