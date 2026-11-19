import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { I18nProvider, initI18n } from "./i18n";
import {
  applyDocumentLocale,
  detectLocale,
  readStoredLocale,
} from "./i18n/locale";
import { logWebviewError } from "./storage";
import { installWebviewErrorForwarder } from "./webviewErrors";
import "chord-render/fonts.css";
import "./styles/global.css";

installWebviewErrorForwarder(window, logWebviewError);

const locale = detectLocale(
  readStoredLocale(window.localStorage),
  navigator.languages ?? [navigator.language],
);
initI18n(locale);
applyDocumentLocale(document, locale);

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
);
