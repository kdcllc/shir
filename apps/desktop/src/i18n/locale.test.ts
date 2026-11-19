import { describe, expect, it } from "vitest";
import {
  LOCALE_STORAGE_KEY,
  applyDocumentLocale,
  detectLocale,
  localeDirection,
  readStoredLocale,
  storeLocale,
} from "./locale";

const throwing = {
  getItem: () => {
    throw new Error("denied");
  },
  setItem: () => {
    throw new Error("denied");
  },
};

describe("detectLocale", () => {
  it("a stored he/en wins over the browser languages", () => {
    expect(detectLocale("he", ["en-US"])).toBe("he");
    expect(detectLocale("en", ["he-IL"])).toBe("en");
  });

  it("ignores an invalid stored value", () => {
    expect(detectLocale("fr", ["he"])).toBe("he");
    expect(detectLocale("HE", [])).toBe("en");
    expect(detectLocale("", ["he"])).toBe("he");
  });

  it.each(["he", "he-IL", "iw", "HE_il"])("%s maps to he", (tag) => {
    expect(detectLocale(null, [tag])).toBe("he");
  });

  it.each([["en-US"], ["fr"], []])("%j maps to en", (...langs) => {
    expect(detectLocale(null, langs.flat() as string[])).toBe("en");
  });

  it("only the first non-empty language counts", () => {
    expect(detectLocale(null, ["en", "he"])).toBe("en");
    expect(detectLocale(null, ["", "he"])).toBe("he");
    expect(detectLocale(null, ["heb"])).toBe("en");
  });
});

describe("storage helpers", () => {
  it("round-trips through a storage", () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    };
    expect(readStoredLocale(storage)).toBeNull();
    storeLocale(storage, "he");
    expect(data.get(LOCALE_STORAGE_KEY)).toBe("he");
    expect(LOCALE_STORAGE_KEY).toBe("shir.locale");
    expect(readStoredLocale(storage)).toBe("he");
  });

  it("never throws on a throwing or missing storage", () => {
    expect(readStoredLocale(throwing)).toBeNull();
    expect(readStoredLocale(undefined)).toBeNull();
    expect(() => storeLocale(throwing, "he")).not.toThrow();
    expect(() => storeLocale(undefined, "en")).not.toThrow();
  });
});

describe("document application", () => {
  it("maps locale to direction", () => {
    expect(localeDirection("he")).toBe("rtl");
    expect(localeDirection("en")).toBe("ltr");
  });

  it("sets lang and dir for both locales", () => {
    applyDocumentLocale(document, "he");
    expect(document.documentElement.lang).toBe("he");
    expect(document.documentElement.dir).toBe("rtl");
    applyDocumentLocale(document, "en");
    expect(document.documentElement.lang).toBe("en");
    expect(document.documentElement.dir).toBe("ltr");
  });
});
