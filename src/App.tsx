import { useRef } from "react";
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
  const apiRef = useRef<ExcalidrawAPI | null>(null);

  function handleExcalidrawAPI(api: ExcalidrawAPI) {
    apiRef.current = api;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        if (msg.type === "scene" && msg.scene != null && apiRef.current) {
          const scene = structuredClone(msg.scene);
          apiRef.current.updateScene({
            elements: scene.elements ?? [],
            appState: scene.appState ?? null,
            captureUpdate: CaptureUpdateAction.NEVER,
          });
        }
      } catch {
        // Ignore malformed messages
      }
    });
  }

  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <Excalidraw excalidrawAPI={handleExcalidrawAPI as never} />
    </div>
  );
}
