import { describe, expect, it } from "vitest";
import {
  estimateColumnWidths,
  fitColumnWidths,
  textTwips,
} from "./columnWidths";
import { ADVANCE_BOLD, ADVANCE_REGULAR, UNITS_PER_EM } from "./fontMetrics";

const tw = (units: number, pt = 12): number => (units * pt * 20) / UNITS_PER_EM;

describe("textTwips", () => {
  it("sums regular Latin advances", () => {
    // Liberation Sans Regular: A 1366, space 569, i 455 (units of 2048).
    expect(textTwips("A", "regular", 12)).toBeCloseTo(tw(1366), 5);
    expect(textTwips("A A", "regular", 12)).toBeCloseTo(tw(1366 * 2 + 569), 5);
    expect(textTwips("", "regular", 12)).toBe(0);
  });

  it("scales linearly with point size", () => {
    expect(textTwips("Am", "regular", 24)).toBeCloseTo(
      2 * textTwips("Am", "regular", 12),
      5,
    );
  });

  it("measures bold wider than regular", () => {
    expect(textTwips("A", "bold", 12)).toBeCloseTo(tw(1479), 5);
    expect(textTwips("Am7/G", "bold", 12)).toBeGreaterThan(
      textTwips("Am7/G", "regular", 12),
    );
  });

  it("measures Hebrew letters", () => {
    expect(textTwips("א", "regular", 12)).toBeCloseTo(tw(1286), 5);
    expect(textTwips("א", "bold", 12)).toBeCloseTo(tw(1397), 5);
  });

  it("gives Hebrew combining marks (niqqud) no advance", () => {
    const plain = textTwips("שלום", "regular", 12);
    const pointed = textTwips("שָלוֹם", "regular", 12);
    expect(plain).toBeGreaterThan(0);
    expect(pointed).toBe(plain);
  });

  it("uses the table maximum for an unknown code point", () => {
    const maxRegular = Math.max(...Object.values(ADVANCE_REGULAR));
    const maxBold = Math.max(...Object.values(ADVANCE_BOLD));
    expect(textTwips("中", "regular", 12)).toBeCloseTo(tw(maxRegular), 5);
    expect(textTwips("中", "bold", 12)).toBeCloseTo(tw(maxBold), 5);
    expect(textTwips("\u{1F3B8}", "regular", 12)).toBeCloseTo(
      tw(maxRegular),
      5,
    );
  });

  it("never under-estimates bold Am7/G (LibreOffice measured 772 twips at 12 pt)", () => {
    expect(textTwips("Am7/G", "bold", 12)).toBeGreaterThanOrEqual(772);
  });
});

describe("estimateColumnWidths", () => {
  it("sizes a lyric-dominated cell from the lyric", () => {
    const lyric = textTwips("rock and r", "regular", 12);
    expect(estimateColumnWidths([{ chord: "G", text: "rock and r" }])).toEqual([
      Math.ceil(lyric * 1.1) + 60,
    ]);
  });

  it("sizes a chord-dominated cell from the chord plus end margin", () => {
    const chord = textTwips("Am7/G", "bold", 12);
    expect(estimateColumnWidths([{ chord: "Am7/G", text: "a" }])).toEqual([
      Math.ceil(chord * 1.1) + 60 + 100,
    ]);
  });

  it("keeps an empty-text end-anchor cell as wide as its chord", () => {
    const chord = textTwips("C", "bold", 12);
    expect(estimateColumnWidths([{ chord: "C", text: "" }])).toEqual([
      Math.ceil(chord * 1.1) + 160,
    ]);
  });

  it("falls back to the minimum width for an empty cell", () => {
    // lyric 0 -> 60, chord 0 -> 160 by default, so lower extras to expose the minimum.
    expect(
      estimateColumnWidths([{ text: "" }], {
        extraTwips: 0,
        endMarginTwips: 0,
        minTwips: 75,
      }),
    ).toEqual([75]);
    expect(estimateColumnWidths([{ text: "" }])).toEqual([160]);
  });

  it("applies the documented defaults and honours overrides", () => {
    const cell = { chord: "G", text: "hello" };
    const lyric = textTwips("hello", "regular", 12);
    expect(estimateColumnWidths([cell])).toEqual(
      estimateColumnWidths([cell], {
        pointSize: 12,
        endMarginTwips: 100,
        pad: 1.1,
        extraTwips: 60,
        minTwips: 60,
      }),
    );
    expect(estimateColumnWidths([cell], { pad: 2, extraTwips: 0 })).toEqual([
      Math.ceil(lyric * 2),
    ]);
    expect(
      estimateColumnWidths([cell], { pointSize: 24, extraTwips: 0, pad: 1 })[0],
    ).toBe(Math.ceil(textTwips("hello", "regular", 24)));
  });
});

describe("fitColumnWidths", () => {
  it("returns widths unchanged when they fit", () => {
    expect(fitColumnWidths([100, 200], 300)).toEqual([100, 200]);
  });

  it("scales proportionally to integers when too wide", () => {
    expect(fitColumnWidths([1000, 3000], 2000)).toEqual([500, 1500]);
  });

  it("never goes below the minimum", () => {
    expect(fitColumnWidths([10, 10000], 1000, 60)[0]).toBe(60);
  });
});
