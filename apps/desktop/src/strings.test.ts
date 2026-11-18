import { describe, expect, it } from "vitest";
import {
  deleteConfirmTitle,
  deleteManyFailed,
  deleteManyTitle,
  deleteSongNamed,
  deletedCount,
  lineLabel,
  selectSongNamed,
  selectedCount,
} from "./strings";

const FSI = "\u2068";
const PDI = "\u2069";
const HEBREW = "שיר למעלות";

describe("title helpers isolate the title", () => {
  it("deleteSongNamed wraps the title in FSI … PDI", () => {
    expect(deleteSongNamed("Hallelujah")).toBe(`Delete ${FSI}Hallelujah${PDI}`);
    expect(deleteSongNamed(HEBREW)).toBe(`Delete ${FSI}${HEBREW}${PDI}`);
  });

  it("selectSongNamed wraps the title in FSI … PDI", () => {
    expect(selectSongNamed("Hallelujah")).toBe(`Select ${FSI}Hallelujah${PDI}`);
    expect(selectSongNamed(HEBREW)).toBe(`Select ${FSI}${HEBREW}${PDI}`);
  });

  it("deleteConfirmTitle keeps the question mark outside the isolate", () => {
    expect(deleteConfirmTitle("Hallelujah")).toBe(
      `Delete ${FSI}Hallelujah${PDI}?`,
    );
    expect(deleteConfirmTitle(HEBREW)).toBe(`Delete ${FSI}${HEBREW}${PDI}?`);
  });
});

describe("count helpers", () => {
  it("deleteManyTitle names the count", () => {
    expect(deleteManyTitle(2)).toBe("Delete 2 songs?");
    expect(deleteManyTitle(17)).toBe("Delete 17 songs?");
  });

  it("selectedCount names the count", () => {
    expect(selectedCount(0)).toBe("0 selected");
    expect(selectedCount(1)).toBe("1 selected");
    expect(selectedCount(12)).toBe("12 selected");
  });

  it("deletedCount is singular only for exactly 1", () => {
    expect(deletedCount(1)).toBe("Deleted 1 song");
    expect(deletedCount(0)).toBe("Deleted 0 songs");
    expect(deletedCount(2)).toBe("Deleted 2 songs");
  });

  it("deleteManyFailed names failed then total", () => {
    expect(deleteManyFailed(2, 5)).toBe("Could not delete 2 of 5 songs");
    expect(deleteManyFailed(1, 1)).toBe("Could not delete 1 of 1 songs");
  });

  it("lineLabel names the line number", () => {
    expect(lineLabel(1)).toBe("Line 1");
    expect(lineLabel(42)).toBe("Line 42");
  });
});
