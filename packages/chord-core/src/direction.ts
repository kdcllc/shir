export type TextDirection = "rtl" | "ltr";

const RTL_LETTER = /^[\p{Script=Hebrew}\p{Script=Arabic}]$/u;
const ANY_LETTER = /^\p{L}$/u;

/**
 * First-strong direction (UAX #9 P2, simplified). Hebrew/Arabic letters give
 * "rtl", any other letter gives "ltr"; digits, punctuation, spaces and marks
 * (e.g. niqqud) are skipped. Returns null when no strong character exists.
 *
 * Callers pass lyric text, not chord text: "(F#m7) שיר" is "ltr" because the
 * chord letters come first.
 */
export function firstStrongDirection(text: string): TextDirection | null {
  for (const ch of text) {
    if (!ANY_LETTER.test(ch)) continue;
    return RTL_LETTER.test(ch) ? "rtl" : "ltr";
  }
  return null;
}
