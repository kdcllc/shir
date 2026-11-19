import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll } from "vitest";
import { cleanup } from "@testing-library/react";
import { i18n, initI18n } from "../i18n";
import { applyDocumentLocale, LOCALE_STORAGE_KEY } from "../i18n/locale";

beforeAll(() => {
  initI18n("en");
});

afterEach(() => {
  cleanup();
  void i18n.changeLanguage("en");
  window.localStorage.removeItem(LOCALE_STORAGE_KEY);
  window.localStorage.removeItem("shir.library");
  applyDocumentLocale(document, "en");
});
