// Shared Excalidraw element and scene types used across Track A (writeback,
// cli) and Track B (authoring, geometry, reconcile).
//
// El uses `any` so that geometry/reconcile internals can read numeric and
// string fields without per-site narrowing. Tightening to `unknown` is
// tracked but deferred (too many access sites to fix in one pass).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type El = Record<string, any>;

export interface ExcalidrawScene {
  type: "excalidraw";
  version: 2;
  source: string;
  elements: El[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}
