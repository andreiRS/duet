import { useEffect, useRef, useState } from "react";
import { Excalidraw, CaptureUpdateAction } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";

type ExcalidrawAPI = {
  updateScene: (sceneData: {
    elements?: unknown[];
    appState?: Record<string, unknown> | null;
    captureUpdate?: (typeof CaptureUpdateAction)[keyof typeof CaptureUpdateAction];
  }) => void;
};

export default function App() {
  const [flashVisible, setFlashVisible] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Excalidraw can invoke its excalidrawAPI callback more than once (re-mount,
  // StrictMode double-invoke). Store the API in a ref so the single WS effect
  // always reads the latest one without re-running.
  const apiRef = useRef<ExcalidrawAPI | null>(null);

  function showFlash() {
    setFlashVisible(true);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashVisible(false), 1500);
  }

  function handleExcalidrawAPI(api: ExcalidrawAPI) {
    apiRef.current = api;
  }

  // Open exactly one WebSocket for the component's lifetime; clean it up (and
  // any pending flash timer) on unmount so we never leak sockets or fire a
  // setState on an unmounted component.
  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}`);

    function onMessage(event: MessageEvent) {
      try {
        const msg = JSON.parse(event.data as string);
        if (msg.type === "scene" && msg.scene != null) {
          const scene = structuredClone(msg.scene);
          apiRef.current?.updateScene({
            elements: scene.elements ?? [],
            appState: scene.appState ?? null,
            captureUpdate: CaptureUpdateAction.NEVER,
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
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative" }}>
      <Excalidraw excalidrawAPI={handleExcalidrawAPI as never} />
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
