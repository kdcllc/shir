import { describe, expect, it } from "vitest";
import { i18n } from "./index";

/**
 * Frozen English outputs of the former helper functions, written out as literals.
 * deleteManyFailed is `{ failed: 1, count: total }`, importSummary `{ saved: 2, count: total }`.
 * Intentionally never imports the helpers (they are removed by a later task).
 */
const COUNTS = [0, 1, 2, 3, 17] as const;
const TITLES = ["Hallelujah", "שיר למעלות"] as const;

const BY_COUNT: Record<string, readonly string[]> = {
  diagnosticsCount: [
    "0 problems",
    "1 problem",
    "2 problems",
    "3 problems",
    "17 problems",
  ],
  importSummary: [
    "Imported 2 of 0 files",
    "Imported 2 of 1 file",
    "Imported 2 of 2 files",
    "Imported 2 of 3 files",
    "Imported 2 of 17 files",
  ],
  importQueued: [
    "0 files need alignment review",
    "1 file needs alignment review",
    "2 files need alignment review",
    "3 files need alignment review",
    "17 files need alignment review",
  ],
  deleteManyTitle: [
    "Delete 0 songs?",
    "Delete 1 songs?",
    "Delete 2 songs?",
    "Delete 3 songs?",
    "Delete 17 songs?",
  ],
  selectedCount: [
    "0 selected",
    "1 selected",
    "2 selected",
    "3 selected",
    "17 selected",
  ],
  deletedCount: [
    "Deleted 0 songs",
    "Deleted 1 song",
    "Deleted 2 songs",
    "Deleted 3 songs",
    "Deleted 17 songs",
  ],
  deleteManyFailed: [
    "Could not delete 1 of 0 songs",
    "Could not delete 1 of 1 songs",
    "Could not delete 1 of 2 songs",
    "Could not delete 1 of 3 songs",
    "Could not delete 1 of 17 songs",
  ],
  lineLabel: ["Line 0", "Line 1", "Line 2", "Line 3", "Line 17"],
};

const BY_TITLE: Record<string, readonly string[]> = {
  deleteSongNamed: [
    "Delete \u2068Hallelujah\u2069",
    "Delete \u2068שיר למעלות\u2069",
  ],
  selectSongNamed: [
    "Select \u2068Hallelujah\u2069",
    "Select \u2068שיר למעלות\u2069",
  ],
  deleteConfirmTitle: [
    "Delete \u2068Hallelujah\u2069?",
    "Delete \u2068שיר למעלות\u2069?",
  ],
};

function countVars(key: string, n: number): Record<string, unknown> {
  if (key === "importSummary") return { count: n, saved: 2 };
  if (key === "deleteManyFailed") return { count: n, failed: 1 };
  return { count: n };
}

describe("English templates equal the frozen helper outputs", () => {
  for (const [key, expected] of Object.entries(BY_COUNT)) {
    it(`${key} for n in 0, 1, 2, 3, 17`, () => {
      COUNTS.forEach((n, i) => {
        const vars = key === "lineLabel" ? { n } : countVars(key, n);
        expect(i18n.t(key as never, vars as never), `${key}(${n})`).toBe(
          expected[i],
        );
      });
    });
  }

  for (const [key, expected] of Object.entries(BY_TITLE)) {
    it(`${key} isolates each title`, () => {
      TITLES.forEach((title, i) => {
        expect(i18n.t(key as never, { title } as never)).toBe(expected[i]);
      });
    });
  }
});
