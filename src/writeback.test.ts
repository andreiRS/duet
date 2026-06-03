import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";
import {
  shouldPersist,
  shapeSceneForFile,
  hashContent,
  EchoGuard,
  writeSceneFile,
} from "./writeback";

describe("shouldPersist (version gate)", () => {
  it("returns true when the version advances", () => {
    expect(shouldPersist(1, 2)).toBe(true);
  });

  it("returns false when the version is unchanged (noise: mouse-move/hover/selection)", () => {
    expect(shouldPersist(5, 5)).toBe(false);
  });

  it("returns false when the version goes backwards", () => {
    expect(shouldPersist(5, 3)).toBe(false);
  });

  it("returns true on the first advancing change from the initial version", () => {
    expect(shouldPersist(0, 1)).toBe(true);
  });
});

describe("shapeSceneForFile (file shaping + appState whitelist)", () => {
  it("produces the defensive excalidraw file envelope", () => {
    const shaped = shapeSceneForFile({ elements: [], appState: {} }, "duet");
    expect(shaped.type).toBe("excalidraw");
    expect(shaped.version).toBe(2);
    expect(shaped.source).toBe("duet");
    expect(shaped.files).toEqual({});
  });

  it("keeps the elements array", () => {
    const elements = [{ id: "a", type: "rectangle" }];
    const shaped = shapeSceneForFile({ elements, appState: {} }, "duet");
    expect(shaped.elements).toEqual(elements);
  });

  it("keeps only whitelisted appState keys and drops transient state", () => {
    const shaped = shapeSceneForFile(
      {
        elements: [],
        appState: {
          viewBackgroundColor: "#abcdef",
          gridSize: 20,
          theme: "dark",
          // transient junk that must be dropped:
          scrollX: 100,
          scrollY: 200,
          zoom: { value: 2 },
          selectedElementIds: { a: true },
          collaborators: [{ id: "c" }],
          cursorButton: "down",
          draggingElement: { id: "d" },
        },
      },
      "duet",
    );
    expect(shaped.appState).toEqual({
      viewBackgroundColor: "#abcdef",
      gridSize: 20,
      theme: "dark",
    });
  });

  it("omits whitelisted keys that are absent rather than writing undefined", () => {
    const shaped = shapeSceneForFile(
      { elements: [], appState: { viewBackgroundColor: "#fff" } },
      "duet",
    );
    expect(shaped.appState).toEqual({ viewBackgroundColor: "#fff" });
    expect("theme" in (shaped.appState as object)).toBe(false);
  });

  it("defaults missing elements/appState to empty", () => {
    const shaped = shapeSceneForFile({}, "duet");
    expect(shaped.elements).toEqual([]);
    expect(shaped.appState).toEqual({});
  });
});

let tmpDir: string;
afterEach(() => {
  if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
});
function makeTmpDir(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "duet-wb-test-"));
  return tmpDir;
}

describe("hashContent", () => {
  it("is the sha256 of the exact bytes", () => {
    const bytes = '{"a":1}';
    const expected = crypto.createHash("sha256").update(bytes).digest("hex");
    expect(hashContent(bytes)).toBe(expected);
  });

  it("differs for different bytes", () => {
    expect(hashContent("a")).not.toBe(hashContent("b"));
  });
});

describe("EchoGuard", () => {
  it("consumes a recorded hash exactly once (own echo, then gone)", () => {
    const guard = new EchoGuard();
    guard.record("h1");
    expect(guard.consume("h1")).toBe(true);  // self-write echo: skip
    expect(guard.consume("h1")).toBe(false); // already consumed: not an echo
  });

  it("does not match an unrecorded hash (external write)", () => {
    const guard = new EchoGuard();
    expect(guard.consume("never-seen")).toBe(false);
  });
});

describe("writeSceneFile (atomic write + echo registration)", () => {
  it("writes the shaped scene so the file parses to the intended content", () => {
    const dir = makeTmpDir();
    const filePath = path.join(dir, "scene.excalidraw");
    const guard = new EchoGuard();

    writeSceneFile(filePath, { elements: [{ id: "a", type: "rectangle" }], appState: { scrollX: 9 } }, guard);

    const onDisk = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(onDisk.type).toBe("excalidraw");
    expect(onDisk.elements).toEqual([{ id: "a", type: "rectangle" }]);
    expect(onDisk.appState).toEqual({}); // scrollX dropped
    expect(onDisk.files).toEqual({});
  });

  it("leaves no lingering .tmp file (atomic tmp+rename)", () => {
    const dir = makeTmpDir();
    const filePath = path.join(dir, "scene.excalidraw");
    writeSceneFile(filePath, { elements: [], appState: {} }, new EchoGuard());
    const leftovers = fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("records the hash of the exact bytes written into the guard (echo registration)", () => {
    const dir = makeTmpDir();
    const filePath = path.join(dir, "scene.excalidraw");
    const guard = new EchoGuard();
    writeSceneFile(filePath, { elements: [], appState: {} }, guard);

    const bytes = fs.readFileSync(filePath, "utf8");
    // The watcher will read these exact bytes and must recognize them as our echo.
    expect(guard.consume(hashContent(bytes))).toBe(true);
  });
});
