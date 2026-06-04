// Pure resolver for the agent-camera view move (#23). Given a `camera` WS
// message and the current scene elements, returns the arguments for
// Excalidraw's `api.scrollToContent(targets, options)` — or null when there
// is nothing to frame. This is a VIEW path, not a content path: it never
// touches the file, the scene version, or the echo guard. App.tsx calls
// scrollToContent with what this returns; the save-gate already swallows the
// scroll*/zoom mutations scrollToContent makes, so no save is emitted.

import type { El } from "./reconcile";

export interface CameraMessage {
  type: "camera";
  op: "fit";
  ids?: string[];
  animate?: boolean;
  duration?: number;
}

export interface CameraScrollArgs {
  targets: El[];
  options: {
    // `fitToContent: true` frames the target bounding box and only zooms OUT
    // to fit — Excalidraw caps it at 100%, so a single small element is never
    // zoomed past 1:1 (the intent behind the spec's `maxZoom`, achieved
    // without it). We deliberately do not pass `maxZoom`.
    fitToContent: true;
    animate: boolean;
    duration: number;
  };
}

// Default animation duration when the message omits `duration`.
export const CAMERA_DEFAULT_DURATION_MS = 300;

export function resolveCameraScroll(
  msg: CameraMessage,
  elements: El[],
): CameraScrollArgs | null {
  // op:"fit" with no ids frames the whole scene; with ids, the union of the
  // elements whose id is listed (preserving scene order).
  const idSet = msg.ids ? new Set(msg.ids) : null;
  const targets = idSet
    ? elements.filter((e) => idSet.has(e.id as string))
    : elements;

  // Nothing to frame — empty scene, or ids matched no element. Frame nothing
  // rather than snapping to the whole scene.
  if (targets.length === 0) return null;

  return {
    targets,
    options: {
      fitToContent: true,
      animate: msg.animate ?? true,
      duration: msg.duration ?? CAMERA_DEFAULT_DURATION_MS,
    },
  };
}
