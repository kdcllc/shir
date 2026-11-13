const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Split text into grapheme clusters so niqqud stays with its base letter. */
export function splitGraphemes(text: string): string[] {
  if (text === "") return [];
  return Array.from(segmenter.segment(text), (s) => s.segment);
}
