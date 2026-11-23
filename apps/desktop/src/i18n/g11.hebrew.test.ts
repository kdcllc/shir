import { describe, expect, it } from "vitest";
import { EN } from "./en";
import { HE } from "./he";

/** The EN keys added by goal g11 (document import and AI conversion), pinned as a literal. */
const G11_KEYS = [
  "importWithAi",
  "aiStepSource",
  "aiStepPrompt",
  "aiStepReply",
  "aiSourceDocument",
  "aiSourceAttach",
  "aiPickDocument",
  "aiPromptLabel",
  "aiPromptHint",
  "aiCopy",
  "aiCopied",
  "aiCopyFailed",
  "aiReplyLabel",
  "aiParse",
  "aiParseError",
  "aiTruncated",
  "aiSongsFound",
  "aiDefaultSource",
  "convertWithAi",
  "importNotes",
  "docNoteOneSong",
  "fileFilterDocuments",
  "docTooLarge",
  "docTextTooLarge",
  "docUnsupported",
  "docCorrupt",
  "docIo",
  "docNoText",
  "docWarnPdfReordered",
  "docWarnPdfNoText",
  "docWarnSkipped",
  "aiCharCount",
  "aiSongLabel",
  "aiReviewSongs_one",
  "aiReviewSongs_other",
] as const;

const en = EN as Record<string, string>;
const he = HE as Record<string, string>;
const placeholders = (v: string): string[] =>
  [...v.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!);

/** Every HE key that translates `key`: a plural base also has `_two` and `_many`. */
function formsOf(key: string): [heKey: string, enKey: string][] {
  if (!key.endsWith("_one")) return [[key, key]];
  const base = key.slice(0, -4);
  return [
    [key, key],
    [`${base}_two`, key],
    [`${base}_many`, `${base}_other`],
    [`${base}_other`, `${base}_other`],
  ];
}

const PREFIXED = /^(ai|doc)[A-Z]/;

/** Differences between the ai*\/doc* keys of `keys` and the pinned ones; empty when equal. */
function prefixedDifference(keys: readonly string[]): string[] {
  const actual = keys.filter((k) => PREFIXED.test(k)).sort();
  const pinned: readonly string[] = G11_KEYS.filter((k) =>
    PREFIXED.test(k),
  ).sort();
  return [
    ...actual.filter((k) => !pinned.includes(k)).map((k) => `extra ${k}`),
    ...pinned.filter((k) => !actual.includes(k)).map((k) => `missing ${k}`),
  ];
}

describe("g11 Hebrew strings", () => {
  it("the key list is exactly the g11 EN keys", () => {
    expect(new Set(G11_KEYS).size).toBe(G11_KEYS.length);
    for (const key of G11_KEYS) expect(en, key).toHaveProperty(key);
    expect(prefixedDifference(Object.keys(EN))).toEqual([]);
  });

  it("negative: an extra ai/doc key in EN is reported", () => {
    expect(prefixedDifference([...Object.keys(EN), "aiExtra"])).toEqual([
      "extra aiExtra",
    ]);
  });

  it.each(G11_KEYS.flatMap((k) => formsOf(k)))(
    "%s has Hebrew text and keeps its placeholders",
    (heKey, enKey) => {
      expect(he, heKey).toHaveProperty(heKey);
      const value = he[heKey]!;
      expect(value.trim().length).toBeGreaterThan(0);
      expect(value).toMatch(/[\u05D0-\u05EA]/);
      const mayDropCount = heKey.endsWith("_one") || heKey.endsWith("_two");
      for (const name of placeholders(en[enKey]!))
        if (!(name === "count" && mayDropCount))
          expect(value, `${heKey} {{${name}}}`).toContain(`{{${name}}}`);
      for (const name of placeholders(value))
        expect(
          placeholders(en[enKey]!),
          `${heKey} extra {{${name}}}`,
        ).toContain(name);
    },
  );

  it("has no bidi control characters", () => {
    for (const key of G11_KEYS)
      expect(he[key]!, key).not.toMatch(
        /[\u202A-\u202E\u2066-\u2069\u200E\u200F]/,
      );
  });
});
