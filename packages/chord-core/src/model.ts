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

/**
 * A metadata directive (`{title: x}`, `{meta: name value}`, ...). `name` is
 * the lowercase long name (`t` is saved as `title`); `value` is trimmed and is
 * `""` when the tag has none.
 */
export interface MetaLine {
  kind: "meta";
  name: string;
  value: string;
}

/** A comment directive (`{comment: t}`, `{comment_italic: t}`, `{comment_box: t}`). */
export interface CommentLine {
  kind: "comment";
  style: "normal" | "italic" | "box";
  text: string;
}

/**
 * A section boundary. `section` is the X of `start_of_X` / `end_of_X`
 * (aliases such as `soc` map to `chorus`). Only a start tag has a `label`.
 */
export interface SectionLine {
  kind: "section";
  edge: "start" | "end";
  section: string;
  label?: string;
}

/**
 * One verbatim line inside a literal section (`tab`, `grid`, `abc`, `ly`,
 * `textblock`, `svg`).
 */
export interface TabLine {
  kind: "tab";
  text: string;
}

/** A `#` source comment; `text` is everything after the first `#`, verbatim. */
export interface RemarkLine {
  kind: "remark";
  text: string;
}

/**
 * An unknown directive. `name` is lowercased and `value` trimmed; there is no
 * `value` key when the tag has no `:`.
 */
export interface DirectiveLine {
  kind: "directive";
  name: string;
  value?: string;
}

/** A source line the parser could not accept, kept verbatim. */
export interface RawLine {
  kind: "raw";
  text: string;
}

/** Any line of a song. */
export type SongLine =
  | LyricLine
  | ChordOnlyLine
  | EmptyLine
  | MetaLine
  | CommentLine
  | SectionLine
  | TabLine
  | RemarkLine
  | DirectiveLine
  | RawLine;

/** Every line kind, in canonical order (G1 kinds first). */
export const LINE_KINDS = [
  "lyric",
  "chords",
  "empty",
  "meta",
  "comment",
  "section",
  "tab",
  "remark",
  "directive",
  "raw",
] as const;

/** The discriminant of a {@link SongLine}. */
export type LineKind = SongLine["kind"];

/** Known metadata names (saved as `{name: value}`, except `direction`). */
export const META_NAMES = [
  "title",
  "subtitle",
  "artist",
  "composer",
  "lyricist",
  "album",
  "year",
  "key",
  "capo",
  "tempo",
  "time",
  "duration",
  "copyright",
  "direction",
] as const;

/**
 * Parsed song. `direction` comes from `{meta: direction rtl|ltr}` or
 * `{direction: ...}` metadata and is absent for any other value. `key` and
 * `capo` come from the first `key` / `capo` meta line (capo: integer 0-24).
 */
export interface SongModel {
  title?: string;
  direction?: TextDirection;
  key?: string;
  capo?: number;
  lines: SongLine[];
}

/** Machine-readable diagnostic category. */
export type DiagnosticCode =
  | "syntax"
  | "section-unopened"
  | "section-unclosed"
  | "section-mismatch"
  | "invalid-capo"
  | "unknown-chord";

/**
 * A problem found while parsing or transforming. `line` and `column` are
 * 1-based. For `parseSong` they refer to the source text. For model
 * transforms (`transposeSong`, `viewSong`), `line` is the 1-based index into
 * `song.lines` and `column` is the 1-based position of the chord within that
 * line (anchor order for `lyric`, array position for `chords`).
 */
export interface Diagnostic {
  line: number;
  column: number;
  code: DiagnosticCode;
  message: string;
}

/** Result of parsing: the song plus any diagnostics. */
export interface ParseResult {
  song: SongModel;
  diagnostics: Diagnostic[];
}
