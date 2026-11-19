import { describe, expect, it } from "vitest";
import { TEMPLATES } from "../strings";
import { i18n } from "./index";

/**
 * Table-driven plural coverage (fast-check is only `planned` in docs/STACK.md, so no property library).
 * For every TEMPLATES key that takes a count and every n in 0..25, `t()` returns a usable string in
 * both languages and the number survives, except where Hebrew `one` / `two` may use a number word.
 */
const NUMBERS = Array.from({ length: 26 }, (_, n) => n);
const heRules = new Intl.PluralRules("he");

const templateKeys = Object.keys(TEMPLATES);
/** Template bases that interpolate `count` (plural-suffixed or not). */
const countBases = [
  ...new Set(
    templateKeys
      .filter((k) =>
        (TEMPLATES as Record<string, string>)[k]!.includes("{{count}}"),
      )
      .map((k) => k.replace(/_(one|other)$/, "")),
  ),
].sort();
const pluralBases = [
  ...new Set(
    templateKeys.filter((k) => k.endsWith("_one")).map((k) => k.slice(0, -4)),
  ),
].sort();

const t = (key: string, lng: "en" | "he", count: number): string =>
  (i18n.t as (k: string, o: object) => string)(key, {
    lng,
    count,
    saved: 7,
    failed: 3,
    title: "Hallelujah",
    n: count,
  });

describe("g8 plural coverage", () => {
  it("covers the expected template bases", () => {
    expect(countBases).toEqual([
      "deleteManyFailed",
      "deleteManyTitle",
      "deletedCount",
      "diagnosticsCount",
      "importQueued",
      "importSummary",
      "selectedCount",
    ]);
    expect(pluralBases).toEqual([
      "deleteManyFailed",
      "deletedCount",
      "diagnosticsCount",
      "importQueued",
      "importSummary",
    ]);
  });

  it.each(countBases)(
    "%s renders non-empty text for n = 0..25 in en and he",
    (base) => {
      for (const n of NUMBERS) {
        const en = t(base, "en", n);
        const he = t(base, "he", n);
        expect(en.trim().length, `en ${base} ${n}`).toBeGreaterThan(0);
        expect(he.trim().length, `he ${base} ${n}`).toBeGreaterThan(0);
        expect(en, `en ${base} ${n} unresolved`).not.toMatch(/\{\{|\}\}/);
        expect(he, `he ${base} ${n} unresolved`).not.toMatch(/\{\{|\}\}/);
        // An unresolved key would come back as the key itself.
        expect(en).not.toBe(base);
        expect(he).not.toBe(base);
        expect(en, `en ${base} ${n}`).toContain(String(n));
        const category = heRules.select(n);
        if (category !== "one" && category !== "two")
          expect(he, `he ${base} ${n} (${category})`).toContain(String(n));
      }
    },
  );

  it("the Hebrew number-word forms are only ever chosen for one and two", () => {
    expect(heRules.select(1)).toBe("one");
    expect(heRules.select(2)).toBe("two");
    for (const n of [0, 3, 10, 11, 17, 20, 25])
      expect(["one", "two"]).not.toContain(heRules.select(n));
  });

  it.each(pluralBases)(
    "HE %s_many holds {{count}} (read from the resource)",
    (base) => {
      const many = i18n.getResource("he", "translation", `${base}_many`);
      expect(typeof many).toBe("string");
      expect(many as string).toContain("{{count}}");
    },
  );

  it("the harness would notice a missing number", () => {
    // Negative control: a Hebrew `one` word form really omits the digit, so the rule above is not vacuous.
    expect(t("deletedCount", "he", 1)).not.toContain("1");
    expect(t("deletedCount", "he", 3)).toContain("3");
  });
});
