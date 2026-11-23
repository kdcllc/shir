import { noteToPitchClass, transposeChord, transposeKey } from "./chord";
import type { SpellingPreference } from "./chord";
import { splitGraphemes } from "./graphemes";
import type { ChordAnchor, SongLine, SongModel } from "./model";
import { serializeSong } from "./serialize";
import { LITERAL_SECTIONS, parseSong } from "./song";
import { transposeSong } from "./transpose";

/** Section kinds the visual editor can create or rename to. */
export const SECTION_KINDS = ["verse", "chorus", "bridge"] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

/** Metadata names the editor form edits. */
export const EDIT_META_NAMES = [
  "title",
  "artist",
  "key",
  "capo",
  "tempo",
] as const;
export type EditMetaName = (typeof EDIT_META_NAMES)[number];

/** One edit. `line` is an index into `song.lines`; `anchor` is an index into that line's `chords` array; `index` is a grapheme index. */
export type EditOp =
  | { type: "setLyric"; line: number; text: string }
  | { type: "addChord"; line: number; index: number; chord: string }
  | { type: "setChord"; line: number; anchor: number; chord: string }
  | { type: "removeChord"; line: number; anchor: number }
  | { type: "moveChord"; line: number; anchor: number; index: number }
  | { type: "insertLine"; at: number }
  | { type: "removeLine"; line: number }
  | { type: "splitLine"; line: number; index: number }
  | { type: "joinLines"; line: number }
  | { type: "setChordsLine"; line: number; chords: readonly string[] }
  | { type: "setComment"; line: number; text: string }
  | { type: "setMeta"; name: EditMetaName; value: string }
  | {
      type: "addSection";
      at: number;
      section: SectionKind;
      label?: string | undefined;
    }
  | {
      type: "renameSection";
      line: number;
      section: SectionKind;
      label?: string | undefined;
    }
  | { type: "moveSection"; line: number; direction: "up" | "down" }
  | { type: "removeSection"; line: number }
  | { type: "transpose"; semitones: number };

/** Result of an edit: the reparsed song, its canonical ChordPro text, and whether the text changed. */
export interface EditResult {
  song: SongModel;
  text: string;
  changed: boolean;
}

/** A well-formed section: `start` and `end` are indices of its start and end lines. */
export interface SectionSpan {
  start: number;
  end: number;
  section: string;
  label?: string | undefined;
  literal: boolean;
}

// User text is only ever looked up in these sets, never in a plain object, so
// names such as `constructor` or `__proto__` cannot reach the prototype chain.
const SECTION_KIND_SET: ReadonlySet<unknown> = new Set<unknown>(SECTION_KINDS);
const EDIT_META_NAME_SET: ReadonlySet<unknown> = new Set<unknown>(
  EDIT_META_NAMES,
);

const DEFAULT_SUGGESTION_LIMIT = 12;

/** Semitone offset and suffix of each diatonic triad, by key mode. */
const MAJOR_TRIADS: readonly (readonly [number, string])[] = [
  [0, ""],
  [2, "m"],
  [4, "m"],
  [5, ""],
  [7, ""],
  [9, "m"],
];
const MINOR_TRIADS: readonly (readonly [number, string])[] = [
  [0, "m"],
  [3, ""],
  [5, "m"],
  [7, "m"],
  [8, ""],
  [10, ""],
];

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

/** `Math.trunc(value)` clamped to `0..max`; `null` for `NaN` or a non-number. */
function clampIndex(value: unknown, max: number): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return Math.min(Math.max(Math.trunc(value), 0), max);
}

/** True when `line` is an integer index of an existing line. */
function isLineIndex(
  lines: readonly SongLine[],
  line: unknown,
): line is number {
  return isInteger(line) && line >= 0 && line < lines.length;
}

/** Text for a directive value: no line breaks or braces, trimmed. */
function cleanValue(value: unknown): string {
  return typeof value === "string" ? value.replace(/[\n\r{}]/g, "").trim() : "";
}

/** The trimmed chord text, or `null` when it is not valid chord text. */
function cleanChord(chord: unknown): string | null {
  return typeof chord === "string" && isValidChordText(chord)
    ? chord.trim()
    : null;
}

/** A lyric line, or an `empty` line when it has no text and no chords. */
function lyricOrEmpty(
  lyric: string,
  chords: ChordAnchor[],
  direction?: "rtl" | "ltr",
): SongLine {
  if (lyric === "" && chords.length === 0) return { kind: "empty" };
  return direction === undefined
    ? { kind: "lyric", lyric, chords }
    : { kind: "lyric", lyric, chords, direction };
}

/** A copy of `lines` with `line` put at `index` (`index === length` appends). */
function withLine(
  lines: readonly SongLine[],
  index: number,
  ...replacement: SongLine[]
): SongLine[] {
  return [...lines.slice(0, index), ...replacement, ...lines.slice(index + 1)];
}

/** A copy of `chords` with `anchor` after every anchor whose index is `<=` its own. */
function insertAnchor(
  chords: readonly ChordAnchor[],
  anchor: ChordAnchor,
): ChordAnchor[] {
  let at = 0;
  chords.forEach((c, i) => {
    if (c.index <= anchor.index) at = i + 1;
  });
  return [...chords.slice(0, at), anchor, ...chords.slice(at)];
}

/**
 * Move anchors from the old lyric to the new one. With `p` the common
 * grapheme prefix and `s` the common suffix of the remainders: an anchor at
 * `index <= p` stays, one at `index >= oldCount - s` shifts by the length
 * change, any other (inside the replaced span) moves to `p`.
 */
function reanchor(
  chords: readonly ChordAnchor[],
  oldLyric: string,
  newLyric: string,
): ChordAnchor[] {
  const before = splitGraphemes(oldLyric);
  const after = splitGraphemes(newLyric);
  const oldCount = before.length;
  const newCount = after.length;
  const shortest = Math.min(oldCount, newCount);
  let p = 0;
  while (p < shortest && before[p] === after[p]) p++;
  let s = 0;
  while (
    s < shortest - p &&
    before[oldCount - 1 - s] === after[newCount - 1 - s]
  ) {
    s++;
  }
  return chords.map((a) => {
    const index = clampIndex(a.index, oldCount) ?? 0;
    if (index <= p) return { index, chord: a.chord };
    if (index >= oldCount - s) {
      return { index: index + (newCount - oldCount), chord: a.chord };
    }
    return { index: p, chord: a.chord };
  });
}

/** Whether `chord` is text the editor accepts as a chord: non-empty after trimming, with no `[`, `]` or line break. */
export function isValidChordText(chord: string): boolean {
  if (typeof chord !== "string") return false;
  const text = chord.trim();
  return text !== "" && !/[[\]\n\r]/.test(text);
}

/**
 * The well-formed sections of a song, in line order: a start tag whose next
 * section tag is the matching end tag. Unclosed, unopened, nested and
 * mismatched tags give no span.
 */
export function listSections(song: SongModel): SectionSpan[] {
  const spans: SectionSpan[] = [];
  let open: { start: number; section: string; label?: string } | null = null;
  song.lines.forEach((line, i) => {
    if (line.kind !== "section") return;
    if (line.edge === "start") {
      open =
        line.label === undefined
          ? { start: i, section: line.section }
          : { start: i, section: line.section, label: line.label };
      return;
    }
    const prev = open;
    open = null;
    if (prev === null || prev.section !== line.section) return;
    spans.push({
      start: prev.start,
      end: i,
      section: prev.section,
      ...(prev.label !== undefined ? { label: prev.label } : {}),
      literal: LITERAL_SECTIONS.has(prev.section),
    });
  });
  return spans;
}

function sectionStart(section: string, label: unknown): SongLine {
  const text = cleanValue(label);
  return text === ""
    ? { kind: "section", edge: "start", section }
    : { kind: "section", edge: "start", section, label: text };
}

/** The edited line list, or `null` when the op is invalid. */
function editLines(song: SongModel, op: EditOp): SongLine[] | null {
  const lines = song.lines;
  switch (op.type) {
    case "setLyric": {
      if (typeof op.text !== "string") return null;
      if (!isInteger(op.line) || op.line < 0 || op.line > lines.length) {
        return null;
      }
      const text = op.text.replace(/[\n\r]/g, "");
      const line: SongLine = lines[op.line] ?? { kind: "empty" };
      if (line.kind === "empty") {
        // Nothing to write: also keeps a line past the end from being added.
        // Whitespace only is the parser's own rule for an empty line.
        if (text.trim() === "") return [...lines];
        return withLine(lines, op.line, {
          kind: "lyric",
          lyric: text,
          chords: [],
        });
      }
      if (line.kind === "chords") {
        if (text === "") return [...lines];
        return withLine(lines, op.line, {
          kind: "lyric",
          lyric: text,
          chords: line.chords.map((chord) => ({ index: 0, chord })),
        });
      }
      if (line.kind !== "lyric") return null;
      return withLine(
        lines,
        op.line,
        lyricOrEmpty(
          text,
          reanchor(line.chords, line.lyric, text),
          line.direction,
        ),
      );
    }
    case "addChord": {
      const chord = cleanChord(op.chord);
      if (chord === null) return null;
      if (!isInteger(op.line) || op.line < 0 || op.line > lines.length) {
        return null;
      }
      const line: SongLine = lines[op.line] ?? { kind: "empty" };
      if (line.kind !== "lyric" && line.kind !== "empty") return null;
      const lyric = line.kind === "lyric" ? line.lyric : "";
      const chords = line.kind === "lyric" ? line.chords : [];
      const index = clampIndex(op.index, splitGraphemes(lyric).length);
      if (index === null) return null;
      return withLine(
        lines,
        op.line,
        lyricOrEmpty(
          lyric,
          insertAnchor(chords, { index, chord }),
          line.kind === "lyric" ? line.direction : undefined,
        ),
      );
    }
    case "setChord":
    case "removeChord":
    case "moveChord": {
      if (!isLineIndex(lines, op.line)) return null;
      const line = lines[op.line];
      if (line?.kind !== "lyric") return null;
      const at = op.anchor;
      if (!isInteger(at) || at < 0 || at >= line.chords.length) return null;
      const current = line.chords[at];
      if (current === undefined) return null;
      const others = line.chords.filter((_, i) => i !== at);
      let chords: ChordAnchor[];
      if (op.type === "setChord") {
        const chord = cleanChord(op.chord);
        if (chord === null) return null;
        chords = line.chords.map((a, i) =>
          i === at ? { index: a.index, chord } : a,
        );
      } else if (op.type === "removeChord") {
        chords = others;
      } else {
        const index = clampIndex(op.index, splitGraphemes(line.lyric).length);
        if (index === null) return null;
        chords = insertAnchor(others, { index, chord: current.chord });
      }
      return withLine(
        lines,
        op.line,
        lyricOrEmpty(line.lyric, chords, line.direction),
      );
    }
    case "insertLine": {
      if (!isInteger(op.at)) return null;
      const at = Math.min(Math.max(op.at, 0), lines.length);
      return [...lines.slice(0, at), { kind: "empty" }, ...lines.slice(at)];
    }
    case "removeLine": {
      if (!isLineIndex(lines, op.line)) return null;
      if (lines[op.line]?.kind === "section") return null;
      return withLine(lines, op.line);
    }
    case "splitLine": {
      if (!isLineIndex(lines, op.line)) return null;
      const line = lines[op.line];
      if (line?.kind !== "lyric") return null;
      const clusters = splitGraphemes(line.lyric);
      const index = clampIndex(op.index, clusters.length);
      if (index === null) return null;
      return withLine(
        lines,
        op.line,
        lyricOrEmpty(
          clusters.slice(0, index).join(""),
          line.chords.filter((a) => a.index < index),
          line.direction,
        ),
        lyricOrEmpty(
          clusters.slice(index).join(""),
          line.chords
            .filter((a) => !(a.index < index))
            .map((a) => ({ index: a.index - index, chord: a.chord })),
          line.direction,
        ),
      );
    }
    case "joinLines": {
      if (!isLineIndex(lines, op.line)) return null;
      const first = lines[op.line];
      const second = lines[op.line + 1];
      if (first?.kind !== "lyric" && first?.kind !== "empty") return null;
      if (second?.kind !== "lyric" && second?.kind !== "empty") return null;
      const firstLyric = first.kind === "lyric" ? first.lyric : "";
      const shift = splitGraphemes(firstLyric).length;
      const chords: ChordAnchor[] = [
        ...(first.kind === "lyric" ? first.chords : []),
        ...(second.kind === "lyric" ? second.chords : []).map((a) => ({
          index: a.index + shift,
          chord: a.chord,
        })),
      ];
      const direction =
        first.kind === "lyric"
          ? first.direction
          : second.kind === "lyric"
            ? second.direction
            : undefined;
      const joined = lyricOrEmpty(
        firstLyric + (second.kind === "lyric" ? second.lyric : ""),
        chords,
        direction,
      );
      return [...lines.slice(0, op.line), joined, ...lines.slice(op.line + 2)];
    }
    case "setChordsLine": {
      if (!isLineIndex(lines, op.line)) return null;
      if (lines[op.line]?.kind !== "chords") return null;
      if (!Array.isArray(op.chords)) return null;
      const chords: string[] = [];
      for (const entry of op.chords as readonly unknown[]) {
        if (typeof entry !== "string") return null;
        const chord = entry.trim();
        if (chord === "") continue;
        if (!isValidChordText(chord) || /\s/.test(chord)) return null;
        chords.push(chord);
      }
      return withLine(
        lines,
        op.line,
        chords.length === 0 ? { kind: "empty" } : { kind: "chords", chords },
      );
    }
    case "setComment": {
      if (typeof op.text !== "string") return null;
      if (!isLineIndex(lines, op.line)) return null;
      const line = lines[op.line];
      if (line?.kind !== "comment") return null;
      return withLine(lines, op.line, {
        kind: "comment",
        style: line.style,
        text: cleanValue(op.text),
      });
    }
    case "setMeta": {
      const name: string = op.name;
      if (!EDIT_META_NAME_SET.has(name)) return null;
      if (typeof op.value !== "string") return null;
      const value = cleanValue(op.value);
      const isTarget = (l: SongLine): boolean =>
        l.kind === "meta" && l.name === name;
      if (value === "") return lines.filter((l) => !isTarget(l));
      const existing = lines.findIndex(isTarget);
      if (existing !== -1) {
        return withLine(lines, existing, { kind: "meta", name, value });
      }
      let at = 0;
      while (lines[at]?.kind === "meta") at++;
      return [
        ...lines.slice(0, at),
        { kind: "meta", name, value },
        ...lines.slice(at),
      ];
    }
    case "addSection": {
      const section: string = op.section;
      if (!SECTION_KIND_SET.has(section)) return null;
      let at = clampIndex(op.at, lines.length);
      if (at === null) return null;
      for (const span of listSections(song)) {
        if (span.start < at && at <= span.end) at = span.end + 1;
      }
      return [
        ...lines.slice(0, at),
        sectionStart(section, op.label),
        { kind: "empty" },
        { kind: "section", edge: "end", section },
        ...lines.slice(at),
      ];
    }
    case "renameSection": {
      const section: string = op.section;
      if (!SECTION_KIND_SET.has(section)) return null;
      const span = listSections(song).find((s) => s.start === op.line);
      if (span === undefined || span.literal) return null;
      const out = [...lines];
      out[span.start] = sectionStart(section, op.label);
      out[span.end] = { kind: "section", edge: "end", section };
      return out;
    }
    case "moveSection": {
      const spans = listSections(song);
      const i = spans.findIndex((s) => s.start === op.line);
      if (i === -1) return null;
      const direction: string = op.direction;
      const other =
        direction === "up"
          ? spans[i - 1]
          : direction === "down"
            ? spans[i + 1]
            : undefined;
      const own = spans[i];
      if (own === undefined || other === undefined) return null;
      const [a, b] = own.start < other.start ? [own, other] : [other, own];
      return [
        ...lines.slice(0, a.start),
        ...lines.slice(b.start, b.end + 1),
        ...lines.slice(a.end + 1, b.start),
        ...lines.slice(a.start, a.end + 1),
        ...lines.slice(b.end + 1),
      ];
    }
    case "removeSection": {
      const span = listSections(song).find((s) => s.start === op.line);
      if (span === undefined) return null;
      return [...lines.slice(0, span.start), ...lines.slice(span.end + 1)];
    }
    case "transpose": {
      if (!isInteger(op.semitones)) return null;
      return transposeSong(song, op.semitones).song.lines;
    }
    default:
      return null;
  }
}

/**
 * Apply one edit to a song. The input is never mutated. A valid edit returns
 * the canonical text of the edited song and that text reparsed; an invalid
 * edit returns the input song itself with `changed: false`. Never throws.
 */
export function applyEdit(song: SongModel, op: EditOp): EditResult {
  const before = serializeSong(song);
  const lines =
    typeof op === "object" && op !== null ? editLines(song, op) : null;
  if (lines === null) return { song, text: before, changed: false };
  const text = serializeSong({ ...song, lines });
  return { song: parseSong(text).song, text, changed: text !== before };
}

/**
 * Apply edits in order, each to the previous result's song. `changed`
 * compares the final text with the input song's text; no ops (or an op list
 * that is not an array) returns the input song unchanged. Never throws.
 */
export function applyEdits(
  song: SongModel,
  ops: readonly EditOp[],
): EditResult {
  const before = serializeSong(song);
  let result: EditResult = { song, text: before, changed: false };
  if (!Array.isArray(ops)) return result;
  for (const op of ops) result = applyEdit(result.song, op);
  return { ...result, changed: result.text !== before };
}

/** The distinct chords a song uses, in order of first appearance. */
export function songChords(song: SongModel): string[] {
  const seen = new Set<string>();
  for (const line of song.lines) {
    if (line.kind === "lyric") {
      for (const anchor of line.chords) seen.add(anchor.chord);
    } else if (line.kind === "chords") {
      for (const chord of line.chords) seen.add(chord);
    }
  }
  return [...seen];
}

/** Letter offsets from the tonic letter of each triad, by key mode. */
const MAJOR_LETTER_OFFSETS: readonly number[] = [0, 1, 2, 3, 4, 5];
const MINOR_LETTER_OFFSETS: readonly number[] = [0, 2, 3, 4, 5, 6];
const LETTERS = "CDEFGAB";

/**
 * Triads spelled by letter (Gb gives `Cb`, C# gives `E#m`); `null` when a triad
 * would need a double accidental.
 */
function letterTriads(tonic: string, minor: boolean): string[] | null {
  const tonicLetter = LETTERS.indexOf(tonic.charAt(0));
  const tonicPc = noteToPitchClass(tonic);
  if (tonicLetter < 0 || tonicPc === null) return null;
  const triads = minor ? MINOR_TRIADS : MAJOR_TRIADS;
  const offsets = minor ? MINOR_LETTER_OFFSETS : MAJOR_LETTER_OFFSETS;
  const out: string[] = [];
  for (let i = 0; i < triads.length; i++) {
    const [degree, suffix] = triads[i] as readonly [number, string];
    const letter = LETTERS[
      (tonicLetter + (offsets[i] as number)) % 7
    ] as string;
    const letterPc = noteToPitchClass(letter) as number;
    const acc = ((((tonicPc + degree - letterPc) % 12) + 12 + 6) % 12) - 6;
    if (acc < -1 || acc > 1) return null;
    out.push(letter + (acc === -1 ? "b" : acc === 1 ? "#" : "") + suffix);
  }
  return out;
}

/** The six diatonic triads of a key, spelled in the key's own style; `[]` when it is not a key. */
function diatonicTriads(key: string | undefined): string[] {
  if (key === undefined || transposeKey(key, 0) === null) return [];
  const minor = key.endsWith("m");
  const tonic = minor ? key.slice(0, -1) : key;
  const lettered = letterTriads(tonic, minor);
  if (lettered !== null) return lettered;
  // A key named with an accidental spells every triad with that accidental
  // (`transposeKey` would rename a tie key such as `Gb` or `C#`).
  const prefer: SpellingPreference | undefined = tonic.includes("b")
    ? "flat"
    : tonic.includes("#")
      ? "sharp"
      : undefined;
  return (minor ? MINOR_TRIADS : MAJOR_TRIADS).map(([degree, suffix]) => {
    // Transposing from the key `degree` below makes the song key the target
    // key, which is what picks the sharp or flat spelling.
    const from = prefer === undefined ? transposeKey(key, -degree) : null;
    const root = transposeChord(
      tonic,
      degree,
      prefer !== undefined
        ? { prefer }
        : from === null
          ? undefined
          : { key: from },
    ).chord;
    return root + suffix;
  });
}

function asciiLower(text: string): string {
  return text.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/**
 * Chord suggestions for `prefix`: the chords the song uses, then the diatonic
 * triads of its key, keeping those that start with the trimmed prefix (ASCII
 * case-insensitive). At most `limit` are returned (default `12`; a
 * non-integer or `< 1` limit also means `12`).
 */
export function suggestChords(
  song: SongModel,
  prefix: string,
  limit?: number,
): string[] {
  const max = isInteger(limit) && limit >= 1 ? limit : DEFAULT_SUGGESTION_LIMIT;
  const candidates = new Set<string>(songChords(song));
  for (const chord of diatonicTriads(song.key)) candidates.add(chord);
  const wanted = asciiLower(typeof prefix === "string" ? prefix.trim() : "");
  return [...candidates]
    .filter((chord) => asciiLower(chord).startsWith(wanted))
    .slice(0, max);
}
