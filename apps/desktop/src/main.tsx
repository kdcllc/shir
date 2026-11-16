import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { logWebviewError } from "./storage";
import { installWebviewErrorForwarder } from "./webviewErrors";
import "chord-render/fonts.css";
import "./styles/global.css";

installWebviewErrorForwarder(window, logWebviewError);

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
