import { createInstance } from "i18next";
import { I18nextProvider, useTranslation } from "react-i18next";
import { createElement, type ReactNode } from "react";
import { EN } from "./en";
import { HE } from "./he";
import { applyDocumentLocale, storeLocale, type Locale } from "./locale";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    returnNull: false;
    resources: { translation: typeof EN };
  }
}

/** Dedicated instance (not the i18next global default). */
export const i18n = createInstance();

/** Synchronous init; idempotent (a repeat call only changes the language). */
export function initI18n(locale: Locale): void {
  if (i18n.isInitialized) {
    void i18n.changeLanguage(locale);
    return;
  }
  void i18n.init({
    resources: { en: { translation: EN }, he: { translation: HE } },
    lng: locale,
    fallbackLng: "en",
    initAsync: false,
    interpolation: { escapeValue: false },
    returnNull: false,
    react: { useSuspense: false },
  });
}

/** Changes the language, remembers the choice and updates `lang` / `dir`. */
export function setLocale(locale: Locale): void {
  void i18n.changeLanguage(locale);
  storeLocale(window.localStorage, locale);
  applyDocumentLocale(document, locale);
}

/** Typed `t` bound to the app instance; unknown keys are a type error. */
export function useT() {
  return useTranslation(undefined, { i18n }).t;
}

/** Current locale (re-renders on change) and its setter. */
export function useLocale(): {
  locale: Locale;
  setLocale(locale: Locale): void;
} {
  const { i18n: instance } = useTranslation(undefined, { i18n });
  return { locale: instance.language === "he" ? "he" : "en", setLocale };
}

export function I18nProvider({ children }: { children: ReactNode }) {
  return createElement(I18nextProvider, { i18n }, children);
}
