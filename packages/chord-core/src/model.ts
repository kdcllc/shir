import type { TextDirection } from "./direction";

/**
 * A chord anchored to a grapheme position in a lyric line.
 *
 * `index` is a grapheme index (per `splitGraphemes`) into the LOGICAL `lyric`
 * string (B2), with `0 <= index <= graphemeCount`; `index == graphemeCount`
 * means end of line. Anchors are sorted ascending by index. `chord` is the
 * chord text verbatim (B1).
 */
export interface ChordAnchor {
  index: number;
  chord: string;
}

/**
 * A lyric line with chord anchors. `direction` is optional: the parser leaves
 * it unset and the renderer honours it when present (B5).
 */
export interface LyricLine {
  kind: "lyric";
  lyric: string;
  chords: ChordAnchor[];
  direction?: TextDirection;
}

/** An instrumental line made of chords only (B6); chord text is verbatim. */
export interface ChordOnlyLine {
  kind: "chords";
  chords: string[];
}

/** A blank separator line. */
export interface EmptyLine {
  kind: "empty";
}

/** Any line of a song. */
export type SongLine = LyricLine | ChordOnlyLine | EmptyLine;

/**
 * Parsed song. `direction` comes from `{meta: direction rtl|ltr}` or
 * `{direction: ...}` metadata and is absent for any other value.
 */
export interface SongModel {
  title?: string;
  direction?: TextDirection;
  lines: SongLine[];
}
