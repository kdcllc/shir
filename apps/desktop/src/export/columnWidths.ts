import {
  ADVANCE_BOLD,
  ADVANCE_REGULAR,
  FALLBACK_BOLD,
  FALLBACK_REGULAR,
  UNITS_PER_EM,
} from "./fontMetrics";

export type WidthOptions = {
  /** Font size in points. Default 12 (docx.ts default run size 24 half-points). */
  pointSize?: number;
  /** Extra end margin of a chord cell, twips. Default 100 (docx.ts `CHORD_END_MARGIN`). */
  endMarginTwips?: number;
  /** Safety multiplier on the measured text width. Default 1.1. */
  pad?: number;
  /** Cell-internal spacing added to every estimate, twips. Default 60. */
  extraTwips?: number;
  /** Smallest column width, twips. Default 60. */
  minTwips?: number;
};

/** Width of `text` in twips (1/20 pt): Arial/Liberation Sans advances, fallback for unknowns. */
export function textTwips(
  text: string,
  weight: "regular" | "bold",
  pointSize: number,
): number {
  const table = weight === "bold" ? ADVANCE_BOLD : ADVANCE_REGULAR;
  const fallback = weight === "bold" ? FALLBACK_BOLD : FALLBACK_REGULAR;
  let units = 0;
  for (const ch of text) {
    units += table[ch.codePointAt(0) as number] ?? fallback;
  }
  return (units * pointSize * 20) / UNITS_PER_EM;
}

/**
 * Content-sized column widths (twips) for a chord/lyric table, one per cell:
 * `max(ceil(lyric * pad) + extra, ceil(chord * pad) + extra + endMargin, min)`.
 * Defaults: pointSize 12, endMarginTwips 100, pad 1.1, extraTwips 60, minTwips 60.
 * Pure: no DOM.
 */
export function estimateColumnWidths(
  cells: readonly { chord?: string; text: string }[],
  opts: WidthOptions = {},
): number[] {
  const {
    pointSize = 12,
    endMarginTwips = 100,
    pad = 1.1,
    extraTwips = 60,
    minTwips = 60,
  } = opts;
  return cells.map((cell) => {
    const lyric = textTwips(cell.text, "regular", pointSize);
    const chord = textTwips(cell.chord ?? "", "bold", pointSize);
    return Math.max(
      Math.ceil(lyric * pad) + extraTwips,
      Math.ceil(chord * pad) + extraTwips + endMarginTwips,
      minTwips,
    );
  });
}

/**
 * Scales widths down proportionally (rounded to integers, never below `minTwips`) when their sum
 * exceeds `maxTwips`; otherwise returns them unchanged. Over-long lines still do not wrap.
 */
export function fitColumnWidths(
  widths: readonly number[],
  maxTwips: number,
  minTwips = 60,
): number[] {
  const sum = widths.reduce((a, b) => a + b, 0);
  if (sum <= maxTwips) return [...widths];
  const scale = maxTwips / sum;
  return widths.map((w) => Math.max(minTwips, Math.round(w * scale)));
}
