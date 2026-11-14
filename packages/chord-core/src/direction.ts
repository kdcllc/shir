export type TextDirection = "rtl" | "ltr";

const RTL_LETTER = /^[\p{Script=Hebrew}\p{Script=Arabic}]$/u;
const MARK_RTL = /^[\u200F\u061C]$/u;
const MARK_LTR = /^\u200E$/u;
const ANY_LETTER = /^\p{L}$/u;

/**
 * First-strong direction (UAX #9 P2, simplified). Hebrew/Arabic letters give
 * "rtl", any other letter gives "ltr"; digits, punctuation, spaces and marks
 * (e.g. niqqud) are skipped. Returns null when no strong character exists.
 *
 * Explicit strong marks count like the browser's `dir="auto"` (B5): U+200F RLM
 * and U+061C ALM give "rtl", U+200E LRM gives "ltr", when first.
 *
 * Callers pass lyric text, not chord text: "(F#m7) שיר" is "ltr" because the
 * chord letters come first.
 */
export function firstStrongDirection(text: string): TextDirection | null {
  for (const ch of text) {
    if (MARK_RTL.test(ch)) return "rtl";
    if (MARK_LTR.test(ch)) return "ltr";
    if (!ANY_LETTER.test(ch)) continue;
    return RTL_LETTER.test(ch) ? "rtl" : "ltr";
  }
  return null;
}
