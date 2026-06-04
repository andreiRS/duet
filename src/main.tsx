import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { registerEmojiFallback } from "./emoji-font";

// Excalidraw's emoji fallback is `local("Segoe UI Emoji")` only (Windows-only),
// so emoji render as notdef on macOS/Linux (#26). Register a same-named face
// backed by the OS emoji fonts before React mounts.
if (typeof document !== "undefined" && typeof FontFace !== "undefined") {
  registerEmojiFallback(document.fonts, FontFace);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
