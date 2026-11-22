import { describe, expect, it } from "vitest";
import { EN } from "./en";
import { HE } from "./he";

const en = EN as Record<string, string>;
const he = HE as Record<string, string>;
const placeholders = (v: string): string[] =>
  [...v.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!);
const pluralBases = Object.keys(en)
  .filter((k) => k.endsWith("_one"))
  .map((k) => k.slice(0, -4));

describe("EN / HE key parity", () => {
  it("has a non-trivial plural base set", () => {
    expect(pluralBases.sort()).toEqual([
      "addToSetlistTitle",
      "addedToSetlist",
      "aiReviewSongs",
      "deleteManyFailed",
      "deletedCount",
      "diagnosticsCount",
      "importQueued",
      "importSummary",
      "setlistItemCount",
    ]);
  });

  it("every EN key is in HE", () => {
    for (const key of Object.keys(en)) expect(he, key).toHaveProperty(key);
  });

  it("every HE key is an EN key or a _two/_many variant of an EN plural base", () => {
    for (const key of Object.keys(he)) {
      const extra = /^(.+)_(two|many)$/.exec(key);
      const ok = key in en || (extra && pluralBases.includes(extra[1]!));
      expect(ok, key).toBeTruthy();
    }
  });

  it("every EN plural base has all four HE forms", () => {
    for (const base of pluralBases)
      for (const form of ["one", "two", "many", "other"])
        expect(he, `${base}_${form}`).toHaveProperty(`${base}_${form}`);
  });

  it("every HE value is a non-empty string", () => {
    for (const [key, value] of Object.entries(he)) {
      expect(typeof value, key).toBe("string");
      expect(value.trim().length, key).toBeGreaterThan(0);
    }
  });

  it("HE keeps every EN placeholder (count may become a number word in _one/_two)", () => {
    for (const [key, value] of Object.entries(en)) {
      const forms = [key];
      if (key.endsWith("_one")) forms.push(`${key.slice(0, -4)}_two`);
      for (const hk of forms) {
        const allowCountWord = hk.endsWith("_one") || hk.endsWith("_two");
        for (const name of placeholders(value)) {
          if (name === "count" && allowCountWord) continue;
          expect(he[hk], `${hk} {{${name}}}`).toContain(`{{${name}}}`);
        }
      }
    }
  });

  it("HE _many and _other forms contain {{count}}", () => {
    for (const base of pluralBases)
      for (const form of ["many", "other"])
        expect(he[`${base}_${form}`], `${base}_${form}`).toContain("{{count}}");
  });

  it("FSI/PDI pairs are balanced in every HE value", () => {
    for (const [key, value] of Object.entries(he)) {
      const open = (value.match(/\u2068/g) ?? []).length;
      const close = (value.match(/\u2069/g) ?? []).length;
      expect(open, key).toBe(close);
    }
  });

  it("the guard rejects an unbalanced isolate", () => {
    const bad = "Delete \u2068{{title}}";
    expect((bad.match(/\u2068/g) ?? []).length).not.toBe(
      (bad.match(/\u2069/g) ?? []).length,
    );
  });
});
