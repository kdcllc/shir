import { firstStrongDirection } from "chord-core";
import type { LyricLine, TextDirection } from "chord-core";
import { describe, expect, it } from "vitest";
import { lineDirection } from "./lineDirection";

const HEBREW = "שיר חדש";
const LATIN = "new song";

const lyric = (text: string, direction?: TextDirection): LyricLine =>
  direction === undefined
    ? { kind: "lyric", lyric: text, chords: [] }
    : { kind: "lyric", lyric: text, direction, chords: [] };

describe("lineDirection precedence", () => {
  it("precondition: the sample lyrics have opposite first-strong directions", () => {
    expect(firstStrongDirection(HEBREW)).toBe("rtl");
    expect(firstStrongDirection(LATIN)).toBe("ltr");
  });

  it("level 1: line.direction wins over the song direction and the first-strong direction", () => {
    // Song and lyric both say rtl; the line says ltr.
    expect(lineDirection(lyric(HEBREW, "ltr"), "rtl")).toBe("ltr");
    // Song and lyric both say ltr; the line says rtl.
    expect(lineDirection(lyric(LATIN, "rtl"), "ltr")).toBe("rtl");
    // Without a song direction the line still wins over its first-strong character.
    expect(lineDirection(lyric(HEBREW, "ltr"))).toBe("ltr");
    expect(lineDirection(lyric(LATIN, "rtl"))).toBe("rtl");
  });

  it("level 2: without line.direction the song direction wins over the first-strong direction", () => {
    // The lyric's first strong character is Latin (ltr); the song says rtl.
    expect(lineDirection(lyric(LATIN), "rtl")).toBe("rtl");
    // The lyric's first strong character is Hebrew (rtl); the song says ltr.
    expect(lineDirection(lyric(HEBREW), "ltr")).toBe("ltr");
  });

  it("level 3: with neither, the first-strong direction wins over the ltr default", () => {
    // Opposite to the final "ltr" fallback.
    expect(lineDirection(lyric(HEBREW))).toBe("rtl");
    expect(lineDirection(lyric(HEBREW), undefined)).toBe("rtl");
    // Leading neutral characters are skipped: the first STRONG character decides.
    expect(lineDirection(lyric("12 - שיר abc"))).toBe("rtl");
    expect(lineDirection(lyric(LATIN))).toBe("ltr");
    expect(lineDirection(lyric("12 - abc שיר"))).toBe("ltr");
  });

  it("level 4: a line with no strong character gives ltr", () => {
    for (const text of ["", " ", "12 34", "... !?"]) {
      // Precondition: there really is no strong character to fall back on.
      expect(firstStrongDirection(text), JSON.stringify(text)).toBeNull();
      expect(lineDirection(lyric(text)), JSON.stringify(text)).toBe("ltr");
    }
  });
});
