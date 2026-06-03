// First-load ordering for the browser client.
//
// The server replays the current scene the instant the WebSocket opens, often
// before Excalidraw has handed the client its API. The client buffers that
// scene and flushes it once the `excalidrawAPI` callback fires.
//
// The catch: that callback fires BEFORE Excalidraw commits its own initial
// (empty) scene. A synchronous `updateScene` in the callback is immediately
// clobbered by that empty commit, so opening Duet on a non-empty file flashed
// the content and then blanked. Deferring the flush one frame lets our scene
// apply AFTER the initial commit, so it wins.
//
// This helper isolates that single ordering rule so it can be tested without a
// DOM: given a buffered scene, it must schedule the apply (deferred), never run
// it synchronously.

export type Schedule = (fn: () => void) => void;

const defaultSchedule: Schedule =
  typeof requestAnimationFrame === "function"
    ? (fn) => requestAnimationFrame(fn)
    : (fn) => setTimeout(fn, 0);

// Flush a scene that arrived before the Excalidraw API was ready. Does nothing
// when there is nothing buffered. When there is, the apply is DEFERRED via
// `schedule` (one animation frame in the browser) so Excalidraw's initial empty
// commit cannot overwrite it. Returns true when a flush was scheduled.
export function flushPendingScene(
  pending: unknown,
  apply: (scene: unknown) => void,
  schedule: Schedule = defaultSchedule,
): boolean {
  if (pending == null) return false;
  schedule(() => apply(pending));
  return true;
}
