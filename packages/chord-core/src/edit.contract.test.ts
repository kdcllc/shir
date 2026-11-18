import { describe, expect, it } from "vitest";
import * as core from "./index";

describe("edit API contract", () => {
  it("exports the section kinds the editor can create", () => {
    expect(core.SECTION_KINDS).toEqual(["verse", "chorus", "bridge"]);
  });

  it("exports the metadata names the editor form edits", () => {
    expect(core.EDIT_META_NAMES).toEqual([
      "title",
      "artist",
      "key",
      "capo",
      "tempo",
    ]);
  });

  it.each([
    "applyEdit",
    "applyEdits",
    "isValidChordText",
    "listSections",
    "songChords",
    "suggestChords",
  ] as const)("exports %s as a function from the index", (name) => {
    expect(typeof core[name]).toBe("function");
  });

  it("exports LITERAL_SECTIONS from the index, holding tab", () => {
    expect(core.LITERAL_SECTIONS.has("tab")).toBe(true);
  });
});
