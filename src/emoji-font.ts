// The family name Excalidraw uses as the emoji fallback in its canvas font
// stack (see @excalidraw/excalidraw font registry). It ships this fallback as
// `local("Segoe UI Emoji")` only, which exists on Windows but NOT on macOS or
// Linux, so emoji glyphs render as notdef there (#26, the "blue blob").
export const EMOJI_FAMILY = "Segoe UI Emoji";

// Cross-platform local emoji sources, tried in order. Apple Color Emoji (macOS),
// then Noto Color Emoji (Linux), then Segoe UI Emoji (Windows, Excalidraw's
// original fallback, kept last so native Windows behavior is unchanged).
export const EMOJI_SRC = [
  'local("Apple Color Emoji")',
  'local("Noto Color Emoji")',
  'local("Segoe UI Emoji")',
].join(", ");

// Restrict the face to emoji/symbol blocks so it only claims glyphs the primary
// fonts lack (the supplementary emoji planes plus the common symbol blocks and
// the variation selectors / ZWJ used by emoji sequences). Without a range the
// face would claim every codepoint, shadowing other fallbacks.
export const EMOJI_UNICODE_RANGE = [
  "U+200D", // zero-width joiner (emoji sequences)
  "U+2190-21FF", // arrows
  "U+2300-23FF", // misc technical
  "U+2600-27BF", // misc symbols + dingbats
  "U+2B00-2BFF", // misc symbols and arrows
  "U+FE00-FE0F", // variation selectors
  "U+1F000-1FAFF", // emoji supplementary planes
].join(", ");

type LoadableFace = { load?: () => Promise<unknown> };

// Register an emoji fallback face under EMOJI_FAMILY pointing at the OS emoji
// fonts, so Excalidraw's existing fallback name resolves to real glyphs. Kicks
// off loading best-effort: when it resolves, document.fonts fires loadingdone
// and Excalidraw repaints the canvas with the now-available glyphs. Generic over
// the face type so the browser's `document.fonts` + `FontFace` and a test double
// both satisfy it.
export function registerEmojiFallback<F extends LoadableFace>(
  target: { add: (face: F) => unknown },
  FontFaceImpl: new (family: string, source: string, descriptors?: Record<string, unknown>) => F,
): void {
  const face = new FontFaceImpl(EMOJI_FAMILY, EMOJI_SRC, {
    unicodeRange: EMOJI_UNICODE_RANGE,
    display: "swap",
  });
  target.add(face);
  void face.load?.();
}
