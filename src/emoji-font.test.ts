import { describe, it, expect } from "bun:test";
import { registerEmojiFallback, EMOJI_FAMILY } from "./emoji-font";

// A stand-in for the browser FontFace constructor so this runs under bun:test
// (no DOM). It records what Duet asks the browser to register.
class FakeFontFace {
  family: string;
  source: string;
  descriptors: Record<string, unknown>;
  loadCalls = 0;
  constructor(family: string, source: string, descriptors: Record<string, unknown> = {}) {
    this.family = family;
    this.source = source;
    this.descriptors = descriptors;
  }
  load() {
    this.loadCalls++;
    return Promise.resolve(this);
  }
}

function capture() {
  const added: FakeFontFace[] = [];
  const target = { add: (f: unknown) => added.push(f as FakeFontFace) };
  registerEmojiFallback(target, FakeFontFace as never);
  return added;
}

// Behavior: Excalidraw's canvas font stack falls back to "Segoe UI Emoji" for
// emoji glyphs. That font is Windows-only, so on macOS/Linux the glyph renders
// as notdef (the "blue blob" in #26). Duet registers a face under that SAME
// family name pointing at the OS emoji fonts, so the fallback resolves.
describe("emoji fallback font registration", () => {
  it("registers a face under the family Excalidraw uses for emoji fallback", () => {
    const added = capture();
    expect(added.length).toBe(1);
    expect(added[0].family).toBe("Segoe UI Emoji");
    expect(EMOJI_FAMILY).toBe("Segoe UI Emoji");
  });

  it("sources real OS emoji fonts on macOS and Linux", () => {
    const added = capture();
    // macOS ships Apple Color Emoji; most Linux distros ship Noto Color Emoji.
    // Keep Segoe last so Windows still uses its native emoji font.
    expect(added[0].source).toContain("Apple Color Emoji");
    expect(added[0].source).toContain("Noto Color Emoji");
    expect(added[0].source).toContain("Segoe UI Emoji");
  });

  it("scopes the face to emoji codepoints so it only claims emoji glyphs", () => {
    const added = capture();
    const range = String(added[0].descriptors.unicodeRange);
    // Must cover the supplementary emoji plane (e.g. U+1F40B whale from #26).
    expect(range).toMatch(/1F/i);
  });

  it("starts loading the face so the canvas re-renders once it resolves", () => {
    const added = capture();
    expect(added[0].loadCalls).toBe(1);
  });
});
