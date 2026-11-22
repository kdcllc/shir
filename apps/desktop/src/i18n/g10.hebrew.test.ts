import { describe, expect, it } from "vitest";
import { EN } from "./en";
import { HE } from "./he";

/**
 * Guard for the Hebrew strings added by goal g10 (setlists). The key list is a literal, checked
 * against `Object.keys(EN)` (EN keys at a95b2ba plus exactly these), so a new key cannot skip the check.
 */
const NEW_KEYS = [
  "tabSongs",
  "tabSetlists",
  "sidebarViews",
  "setlistNameLabel",
  "createSetlist",
  "renameSetlist",
  "duplicateSetlist",
  "setlistsEmpty",
  "setlistEmpty",
  "setlistEntries",
  "deleteSetlistBody",
  "addToSetlist",
  "newSetlistOption",
  "setlistChoice",
  "add",
  "moveUp",
  "moveDown",
  "removeFromSetlist",
  "dragHandle",
  "dragGlyph",
  "print",
  "exportPdf",
  "exportWord",
  "pdfHint",
  "fileFilterWord",
  "setlistsLoadFailed",
  "setlistSaveFailed",
  "exportFailed",
  "exportLabelSetlist",
  "exportLabelKey",
  "exportLabelCapo",
  "exportLabelTranspose",
  "exportLabelSongs",
  "exportLabelDate",
  "duplicateSuffix",
  "setlistItemCount_one",
  "setlistItemCount_other",
  "addToSetlistTitle_one",
  "addToSetlistTitle_other",
  "addedToSetlist_one",
  "addedToSetlist_other",
  "movedAnnounce",
  "deleteSetlistTitle",
  "exportSaved",
  "capoSongDefault",
] as const;

/** Keys added by later goals (g11); not part of g10, so excluded before the exact comparison. */
const LATER_KEYS = new Set([
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
]);

/** The EN keys at a95b2ba (before g10), read from git. */
const BASELINE = new Set([
  "appName",
  "appNameHebrew",
  "groupSamples",
  "groupTestSongs",
  "songList",
  "transpose",
  "transposeDown",
  "transposeUp",
  "capo",
  "reset",
  "key",
  "shapes",
  "diagnostics",
  "noSongSelected",
  "searchLabel",
  "searchPlaceholder",
  "searchResults",
  "noResults",
  "searchFailed",
  "searchUnavailable",
  "loadingLibrary",
  "searching",
  "libraryEmpty",
  "songLoadFailed",
  "noKey",
  "separator",
  "transposeDownGlyph",
  "transposeUpGlyph",
  "newSong",
  "editSong",
  "openFiles",
  "editorLabel",
  "previewLabel",
  "save",
  "cancel",
  "paste",
  "convert",
  "flipAlignment",
  "alreadyChordPro",
  "pasteFailed",
  "importWarnings",
  "saveFailed",
  "discardTitle",
  "discardBody",
  "keepEditing",
  "discard",
  "reviewingFile",
  "importConverted",
  "importSkipped",
  "importPickFailed",
  "libraryReloadFailed",
  "deleteAction",
  "selectSongs",
  "selectAll",
  "selectDone",
  "deleteSelected",
  "deleteConfirmBody",
  "deleteFailed",
  "removeGlyph",
  "tabVisual",
  "tabSource",
  "editorTabs",
  "undo",
  "redo",
  "transposeSongDown",
  "transposeSongUp",
  "metaForm",
  "metaTitle",
  "metaArtist",
  "metaTempo",
  "visualLabel",
  "visualHint",
  "editLyrics",
  "lyricsInput",
  "addLineBelow",
  "removeLine",
  "editGlyph",
  "addGlyph",
  "chordsLineInput",
  "commentInput",
  "sourceOnly",
  "addSection",
  "sectionKind",
  "sectionLabel",
  "sectionVerse",
  "sectionChorus",
  "sectionBridge",
  "sectionUp",
  "sectionDown",
  "sectionRemove",
  "upGlyph",
  "downGlyph",
  "chordPicker",
  "chordInput",
  "chordSuggestions",
  "chordApply",
  "chordRemove",
  "chordMoveLeft",
  "chordMoveRight",
  "leftGlyph",
  "rightGlyph",
  "chordUnknown",
  "chordClose",
  "noLabel",
  "sectionOther",
  "sortLabel",
  "sortTitle",
  "sortArtist",
  "sortUpdated",
  "libraryView",
  "filterLanguage",
  "filterAll",
  "filterHebrew",
  "filterEnglish",
  "filterMixed",
  "badgeHebrew",
  "badgeEnglish",
  "badgeMixed",
  "noFilterMatches",
  "uiLanguage",
  "localeHebrew",
  "localeEnglish",
  "localeHebrewShort",
  "localeEnglishShort",
  "chordAddEmpty",
  "fileFilterSongs",
  "diagnosticsCount_one",
  "diagnosticsCount_other",
  "importSummary_one",
  "importSummary_other",
  "importQueued_one",
  "importQueued_other",
  "deleteSongNamed",
  "selectSongNamed",
  "deleteConfirmTitle",
  "deleteManyTitle",
  "selectedCount",
  "deletedCount_one",
  "deletedCount_other",
  "deleteManyFailed_one",
  "deleteManyFailed_other",
  "lineLabel",
]);
/** ASCII-letter words allowed in Hebrew text (product terms). */
const PRODUCT_TERMS = ["PDF", "Word"];

const en = EN as Record<string, string>;
const he = HE as Record<string, string>;

const placeholders = (v: string): string[] =>
  [...v.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!);
const FORBIDDEN = /[\u202A-\u202E\u2066\u2067\u200E\u200F]/;
const ISOLATED = /\u2068\{\{\w+\}\}\u2069/g;

/** Isolate rule shared by EN and HE values; one message per violation. */
function isolateProblems(value: string): string[] {
  const bad: string[] = [];
  if (/[\u2068\u2069]/.test(value.replace(ISOLATED, "")))
    bad.push("FSI/PDI not a balanced pair around a placeholder");
  const wanted = (value.match(/\{\{(?:title|name)\}\}/g) ?? []).length;
  const wrapped = (value.match(/\u2068\{\{(?:title|name)\}\}\u2069/g) ?? [])
    .length;
  if (wanted !== wrapped) bad.push("{{title}}/{{name}} lacks its isolate");
  return bad;
}

/** Violations of one HE value `heValue` against its EN counterpart `enValue`. */
function violations(heKey: string, enValue: string, heValue: string): string[] {
  const bad: string[] = [];
  if (/[A-Za-z]/.test(enValue) && !/[\u05D0-\u05EA]/.test(heValue))
    bad.push("no Hebrew letter");
  if (FORBIDDEN.test(heValue)) bad.push("forbidden bidi control or mark");
  bad.push(...isolateProblems(heValue));
  const expected = new Set(placeholders(enValue));
  const actual = new Set(placeholders(heValue));
  const mayDropCount = heKey.endsWith("_one") || heKey.endsWith("_two");
  for (const name of expected)
    if (!actual.has(name) && !(name === "count" && mayDropCount))
      bad.push(`lacks {{${name}}}`);
  for (const name of actual)
    if (!expected.has(name)) bad.push(`extra {{${name}}}`);
  const words = (
    heValue.replace(/\{\{\w+\}\}/g, "").match(/[A-Za-z]+/g) ?? []
  ).filter((w) => !PRODUCT_TERMS.includes(w));
  if (words.length > 0) bad.push(`ASCII words: ${words.join(" ")}`);
  return bad;
}

/** Every HE key checked for `key`, with the EN key it translates. */
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

describe("g10 Hebrew strings", () => {
  it("the key list is exactly the EN keys added since a95b2ba", () => {
    expect(new Set(NEW_KEYS).size).toBe(NEW_KEYS.length);
    expect(BASELINE.size).toBe(142);
    expect(
      Object.keys(EN)
        .filter((k) => !BASELINE.has(k) && !LATER_KEYS.has(k))
        .sort(),
    ).toEqual([...NEW_KEYS].sort());
    for (const key of BASELINE) expect(en, key).toHaveProperty(key);
    for (const key of NEW_KEYS) expect(en, key).toHaveProperty(key);
  });

  it.each(NEW_KEYS.flatMap((k) => formsOf(k)))(
    "%s is correct Hebrew",
    (heKey, enKey) => {
      expect(he, heKey).toHaveProperty(heKey);
      expect(violations(heKey, en[enKey]!, he[heKey]!)).toEqual([]);
    },
  );

  it.each(NEW_KEYS)("EN %s follows the isolate rule", (key) => {
    expect(isolateProblems(en[key]!)).toEqual([]);
  });

  it("the rules fire on bad values (negative controls)", () => {
    expect(
      violations(
        "x",
        "Delete \u2068{{name}}\u2069?",
        "למחוק את \u2068{{name}}\u2069?",
      ),
    ).toEqual([]);
    expect(
      violations(
        "x",
        "Delete \u2068{{name}}\u2069?",
        "Delete \u2068{{name}}\u2069?",
      ),
    ).toContain("no Hebrew letter");
    expect(
      violations("x", "Delete {{name}}", "למחוק \u202E{{name}}"),
    ).toContain("forbidden bidi control or mark");
    expect(
      violations("x", "Delete \u2068{{name}}\u2069?", "למחוק {{name}}?"),
    ).toContain("{{title}}/{{name}} lacks its isolate");
    expect(
      violations("x", "Delete \u2068{{name}}\u2069?", "למחוק \u2068{{name}}?"),
    ).toContain("FSI/PDI not a balanced pair around a placeholder");
    expect(violations("x", "Export PDF", "ייצוא Excel")).toContain(
      "ASCII words: Excel",
    );
    expect(violations("x", "Export PDF", "ייצוא PDF")).toEqual([]);
  });
});
