/** Locale detection, persistence and document application (no i18next dependency). */
export type Locale = "he" | "en";

export const LOCALE_STORAGE_KEY = "shir.locale";

/** Stored `"he"` / `"en"` wins; else Hebrew when the first non-empty language is he / iw. */
export function detectLocale(
  stored: string | null,
  languages: readonly string[],
): Locale {
  if (stored === "he" || stored === "en") return stored;
  const first = languages.find((l) => l.trim() !== "");
  if (first === undefined) return "en";
  const primary = first.trim().split(/[-_]/)[0]!.toLowerCase();
  return primary === "he" || primary === "iw" ? "he" : "en";
}

export function readStoredLocale(
  storage: Pick<Storage, "getItem"> | undefined,
): string | null {
  try {
    return storage?.getItem(LOCALE_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function storeLocale(
  storage: Pick<Storage, "setItem"> | undefined,
  locale: Locale,
): void {
  try {
    storage?.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Storage may be unavailable or full; the choice just is not remembered.
  }
}

export function localeDirection(locale: Locale): "rtl" | "ltr" {
  return locale === "he" ? "rtl" : "ltr";
}

export function applyDocumentLocale(doc: Document, locale: Locale): void {
  doc.documentElement.lang = locale;
  doc.documentElement.dir = localeDirection(locale);
}
