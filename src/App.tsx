import { useEffect, useRef, useState } from "react";
import { Excalidraw, CaptureUpdateAction, getSceneVersion } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { shouldPersistEdit } from "./writeback";

type ExcalidrawAPI = {
  updateScene: (sceneData: {
    elements?: unknown[];
    appState?: Record<string, unknown> | null;
    captureUpdate?: (typeof CaptureUpdateAction)[keyof typeof CaptureUpdateAction];
  }) => void;
  getSceneElements: () => readonly unknown[];
};

// appState keys we persist on the browser side too (mirror of the server
// whitelist). Everything else is transient view/session state.
const PERSISTED_APP_STATE = ["viewBackgroundColor", "gridSize", "theme"] as const;

const SAVE_DEBOUNCE_MS = 400;

export default function App() {
  const [flashVisible, setFlashVisible] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Excalidraw can invoke its excalidrawAPI callback more than once (re-mount,
  // StrictMode double-invoke). Store the API in a ref so the single WS effect
  // always reads the latest one without re-running.
  const apiRef = useRef<ExcalidrawAPI | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  // Last scene version we have accounted for. Updated both when we persist a
  // local edit AND when an incoming agent update lands, so the agent's update
  // never bounces straight back out as a "save".
  const lastVersionRef = useRef(0);
  // True while we are applying a remote/agent scene. updateScene re-stamps
  // element versions and fires onChange synchronously (and same-tick), so the
  // resulting version is HIGHER than the incoming one: a plain version gate
  // would treat it as a local edit and bounce it back as a "save", clobbering
  // the agent's file. This ref makes handleChange ABSORB those onChange(s).
  const isApplyingRemoteRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showFlash() {
    setFlashVisible(true);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashVisible(false), 1500);
  }

  function handleExcalidrawAPI(api: ExcalidrawAPI) {
    apiRef.current = api;
  }

  // The human edited the canvas. Excalidraw fires onChange for pure noise too
  // (mouse-move, hover, selection, pointer), so gate on the element version:
  // only persist when it ADVANCES. structuredClone before sending because
  // Excalidraw freezes the arrays it hands us (mutating/serializing the frozen
  // objects is fine, but we clone to be safe and to whitelist appState).
  function handleChange(
    elements: readonly unknown[],
    appState: Record<string, unknown>,
  ) {
    const nextVersion = getSceneVersion(elements as never);
    if (
      !shouldPersistEdit({
        isApplyingRemote: isApplyingRemoteRef.current,
        prevVersion: lastVersionRef.current,
        nextVersion,
      })
    ) {
      // Either noise (version unchanged) or a remote apply in progress. In both
      // cases record the current (post-apply) version so a later genuine human
      // edit still advances past it and persists, but do NOT write back.
      lastVersionRef.current = nextVersion;
      return;
    }
    lastVersionRef.current = nextVersion;

    const persistedAppState: Record<string, unknown> = {};
    for (const key of PERSISTED_APP_STATE) {
      if (key in appState) persistedAppState[key] = appState[key];
    }
    const payload = {
      type: "save",
      elements: structuredClone(elements) as unknown[],
      appState: structuredClone(persistedAppState),
    };

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
      }
    }, SAVE_DEBOUNCE_MS);
  }

  // Open exactly one WebSocket for the component's lifetime; clean it up (and
  // any pending flash timer) on unmount so we never leak sockets or fire a
  // setState on an unmounted component.
  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}`);
    wsRef.current = ws;

    function onMessage(event: MessageEvent) {
      try {
        const msg = JSON.parse(event.data as string);
        if (msg.type === "scene" && msg.scene != null) {
          const scene = structuredClone(msg.scene);
          const elements = scene.elements ?? [];
          // Mark that we are applying a remote scene so the onChange(s)
          // updateScene fires are absorbed, not bounced back as a "save".
          // updateScene re-stamps versions, so we cannot rely on the incoming
          // version alone (the post-apply version is higher); the flag is the
          // robust guard. It is cleared two animation frames later (below).
          isApplyingRemoteRef.current = true;
          apiRef.current?.updateScene({
            elements,
            appState: scene.appState ?? null,
            captureUpdate: CaptureUpdateAction.NEVER,
          });
          // Excalidraw fires onChange asynchronously (after its render commit,
          // a frame or two later), not synchronously inside updateScene. A
          // setTimeout(0) clears the flag too early and the bounce slips
          // through. Wait two animation frames so the render and its onChange
          // have fired, then record the ACTUAL post-apply scene version (it was
          // re-stamped higher) so a later genuine human edit still advances the
          // gate, and only then stop absorbing.
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              const applied = apiRef.current?.getSceneElements() ?? elements;
              lastVersionRef.current = getSceneVersion(applied as never);
              isApplyingRemoteRef.current = false;
            });
          });
          // External update arrived over the wire: flash a transient banner.
          showFlash();
        }
      } catch {
        // Ignore malformed messages
      }
    }

    ws.addEventListener("message", onMessage);

    return () => {
      ws.removeEventListener("message", onMessage);
      ws.close();
      wsRef.current = null;
      if (flashTimer.current) clearTimeout(flashTimer.current);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative" }}>
      <Excalidraw excalidrawAPI={handleExcalidrawAPI as never} onChange={handleChange as never} />
      <div
        style={{
          position: "fixed",
          top: 16,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 1000,
          padding: "8px 16px",
          borderRadius: 8,
          background: "rgba(30, 30, 30, 0.9)",
          color: "#fff",
          fontSize: 13,
          fontFamily: "system-ui, sans-serif",
          boxShadow: "0 2px 8px rgba(0, 0, 0, 0.25)",
          pointerEvents: "none",
          opacity: flashVisible ? 1 : 0,
          transition: "opacity 300ms ease",
        }}
      >
        Agent updated the canvas
      </div>
    </div>
  );
}
