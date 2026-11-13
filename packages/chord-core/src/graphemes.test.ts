import { describe, expect, it } from "vitest";
import { splitGraphemes } from "./graphemes";

describe("splitGraphemes", () => {
  it("keeps niqqud with its base letter", () => {
    const text = "שָׁלוֹם";
    const g = splitGraphemes(text);
    expect(g).toHaveLength(4);
    expect(g.join("")).toBe(text);
  });
  it("never starts a grapheme with a mark", () => {
    for (const text of ["שָׁלוֹם", "מֶלֶךְ", "בְּרֵאשִׁית"]) {
      for (const g of splitGraphemes(text)) {
        expect(g).not.toMatch(/^\p{M}/u);
      }
    }
  });
  it("splits ASCII per character", () => {
    expect(splitGraphemes("abc")).toEqual(["a", "b", "c"]);
  });
  it("keeps an emoji ZWJ sequence together", () => {
    expect(splitGraphemes("👩‍👩‍👧")).toHaveLength(1);
  });
  it("returns [] for empty", () => {
    expect(splitGraphemes("")).toEqual([]);
  });
});
