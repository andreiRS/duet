import { describe, it, expect, afterEach, spyOn } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";
import {
  shouldPersist,
  shouldPersistEdit,
  shapeSceneForFile,
  hashContent,
  EchoGuard,
  writeSceneFile,
  atomicWriteScene,
  sceneVersion,
} from "./writeback";

describe("shouldPersist (version gate)", () => {
  it("returns true when the version advances", () => {
    expect(shouldPersist(1, 2)).toBe(true);
  });

  it("returns false when the version is unchanged (noise: mouse-move/hover/selection)", () => {
    expect(shouldPersist(5, 5)).toBe(false);
  });

  it("returns true when the version changes downward (genuine smaller scene, not noise)", () => {
    // After an agent pushes a large scene, a real human edit can yield a
    // lower summed version. That is a genuine change and must persist; only
    // an UNCHANGED version is noise.
    expect(shouldPersist(5, 3)).toBe(true);
  });

  it("returns true on the first advancing change from the initial version", () => {
    expect(shouldPersist(0, 1)).toBe(true);
  });
});

describe("shouldPersistEdit (client-side persist decision)", () => {
  it("does NOT persist while a remote/agent scene is being applied (absorb the bounce)", () => {
    expect(
      shouldPersistEdit({ isApplyingRemote: true, prevVersion: 5, nextVersion: 9 }),
    ).toBe(false);
  });

  it("does NOT persist when the version is unchanged (noise)", () => {
    expect(
      shouldPersistEdit({ isApplyingRemote: false, prevVersion: 7, nextVersion: 7 }),
    ).toBe(false);
  });

  it("persists a genuine advancing human edit", () => {
    expect(
      shouldPersistEdit({ isApplyingRemote: false, prevVersion: 4, nextVersion: 5 }),
    ).toBe(true);
  });

  it("persists a genuine human edit even when the version moves downward", () => {
    expect(
      shouldPersistEdit({ isApplyingRemote: false, prevVersion: 9, nextVersion: 4 }),
    ).toBe(true);
  });
});

describe("sceneVersion (summed element version, mirror of Excalidraw's getSceneVersion)", () => {
  it("sums element versions", () => {
    expect(sceneVersion([{ version: 5 }, { version: 3 }])).toBe(8);
  });

  it("treats a missing version as 0", () => {
    expect(sceneVersion([{ version: 5 }, {}])).toBe(5);
  });

  it("counts deleted (tombstone) elements just like Excalidraw's onChange does", () => {
    // Excalidraw hands onChange the INCLUDING-DELETED element array, and
    // getSceneVersion sums every element's version regardless of isDeleted.
    // sceneVersion must match so the client gate can compare like-for-like.
    expect(sceneVersion([{ version: 5 }, { version: 7, isDeleted: true }])).toBe(12);
  });
});

describe("agent-update loop regression: a scene with a tombstone must not bounce a no-op save", () => {
  // Real-world repro: applying a scene that holds a deleted element (e.g. a
  // pipe rectangle the agent removed) produced an endless "Agent updated the
  // canvas" loop. App.applyScene recorded its post-apply baseline over the
  // LIVE-only element set (getSceneElements), but Excalidraw reports onChange
  // over the INCLUDING-DELETED set. The tombstone's version is in one sum but
  // not the other, so the gate saw a phantom delta on every apply and shipped a
  // no-op save, which the server rebroadcast, ad infinitum. The fix records the
  // baseline over the SAME including-deleted set onChange uses.
  const live = [
    { id: "pipe_0", version: 154 },
    { id: "pipe_2", version: 102 },
  ];
  const deleted = [{ id: "pipe_1", version: 180, isDeleted: true }];
  const includingDeleted = [...live, ...deleted];

  // What Excalidraw passes to onChange right after the apply (no human edit).
  const onChangeVersion = sceneVersion(includingDeleted);

  it("baseline over the including-deleted set absorbs the post-apply onChange (no save)", () => {
    const baseline = sceneVersion(includingDeleted);
    expect(
      shouldPersistEdit({
        isApplyingRemote: false,
        prevVersion: baseline,
        nextVersion: onChangeVersion,
      }),
    ).toBe(false);
  });

  it("baseline over the live-only set falsely persists (documents the old bug)", () => {
    const buggyBaseline = sceneVersion(live);
    expect(buggyBaseline).not.toBe(onChangeVersion);
    expect(
      shouldPersistEdit({
        isApplyingRemote: false,
        prevVersion: buggyBaseline,
        nextVersion: onChangeVersion,
      }),
    ).toBe(true);
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

  it("bounds the registry to the last 16 hashes, evicting the oldest", () => {
    const guard = new EchoGuard();
    // Record the oldest hash, then 16 more (17 total) so the oldest is evicted.
    guard.record("oldest");
    for (let i = 0; i < 16; i++) guard.record(`h${i}`);

    // The evicted oldest hash must no longer be treated as our own write: a
    // later identical EXTERNAL write must NOT be wrongly skipped.
    expect(guard.consume("oldest")).toBe(false);
    // A recent self-write is still recognized and skipped.
    expect(guard.consume("h15")).toBe(true);
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

  it("uses a UNIQUE tmp path per write even within the same millisecond (no collision/lost write)", () => {
    const dir = makeTmpDir();
    const filePath = path.join(dir, "scene.excalidraw");
    const guard = new EchoGuard();

    // Capture the tmp source path of every rename. Pin Date.now so a tmp name
    // built only from pid+timestamp would be identical across writes: two
    // concurrent writers would then share a tmp file (second clobbers the
    // first; the first rename leaves the second's rename to ENOENT). The tmp
    // name must therefore carry extra entropy and be unique each call.
    const tmpPaths: string[] = [];
    const realRename = fs.renameSync;
    const renameSpy = spyOn(fs, "renameSync").mockImplementation(((from: fs.PathLike, to: fs.PathLike) => {
      tmpPaths.push(String(from));
      return realRename(from, to);
    }) as never);
    const realNow = Date.now;
    Date.now = () => 1_700_000_000_000;
    try {
      writeSceneFile(filePath, { elements: [{ id: "first", type: "rectangle" }], appState: {} }, guard);
      writeSceneFile(filePath, { elements: [{ id: "second", type: "rectangle" }], appState: {} }, guard);
    } finally {
      Date.now = realNow;
      renameSpy.mockRestore();
    }

    expect(tmpPaths.length).toBe(2);
    expect(tmpPaths[0]).not.toBe(tmpPaths[1]); // unique tmp paths
    const onDisk = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(onDisk.elements).toEqual([{ id: "second", type: "rectangle" }]);
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

// ─── Issue #7: atomicWriteScene — shared writer, no guard (AC2) ──────────────

describe("atomicWriteScene (shared atomic writer, no guard — issue #7 AC2)", () => {
  it("writes shaped scene atomically and returns shaped + bytes", () => {
    const dir = makeTmpDir();
    const filePath = path.join(dir, "scene.excalidraw");

    const { shaped, bytes } = atomicWriteScene(filePath, { elements: [{ id: "x", type: "rectangle" }], appState: { scrollX: 9 } });

    const onDisk = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(onDisk.type).toBe("excalidraw");
    expect(onDisk.elements).toEqual([{ id: "x", type: "rectangle" }]);
    expect(onDisk.appState).toEqual({}); // scrollX dropped by whitelist
    expect(shaped).toEqual(onDisk);
    expect(bytes).toBe(JSON.stringify(shaped, null, 2));
  });

  it("leaves no lingering .tmp file (atomic temp+rename)", () => {
    const dir = makeTmpDir();
    const filePath = path.join(dir, "scene.excalidraw");
    atomicWriteScene(filePath, { elements: [], appState: {} });
    const leftovers = fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("does NOT record in any EchoGuard — agent writes are not echo-suppressed (AC3 contrast)", () => {
    // When the agent uses atomicWriteScene directly (via save()), no guard is
    // touched. A new EchoGuard will not have seen the written bytes, confirming
    // the watcher will NOT suppress the agent's own write.
    const dir = makeTmpDir();
    const filePath = path.join(dir, "scene.excalidraw");
    const { bytes } = atomicWriteScene(filePath, { elements: [], appState: {} });

    const freshGuard = new EchoGuard();
    // No record() was called, so consume returns false — not an echo.
    expect(freshGuard.consume(hashContent(bytes))).toBe(false);
  });

  it("writeSceneFile still records bytes in the guard (server human-save path, AC3)", () => {
    const dir = makeTmpDir();
    const filePath = path.join(dir, "scene.excalidraw");
    const guard = new EchoGuard();
    writeSceneFile(filePath, { elements: [], appState: {} }, guard);

    const bytes = fs.readFileSync(filePath, "utf8");
    // Server's echo guard is armed: watcher will skip this write.
    expect(guard.consume(hashContent(bytes))).toBe(true);
  });
});
