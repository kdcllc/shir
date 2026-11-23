import { firstStrongDirection } from "./direction";
import type { TextDirection } from "./direction";
import { splitGraphemes } from "./graphemes";
import type { LyricLine, SongModel } from "./model";
import { viewSong } from "./transpose";

/** One chord-plus-text piece of a lyric line; `text` is a logical substring. */
export interface ExportSegment {
  chord?: string;
  text: string;
}

/** One exported line, already mapped from the viewed model. */
export type ExportLine =
  | { kind: "lyric"; direction: TextDirection; segments: ExportSegment[] }
  | { kind: "chords"; chords: string[]; direction: TextDirection }
  | { kind: "section"; label: string; direction: TextDirection }
  | { kind: "comment"; text: string; direction: TextDirection }
  | { kind: "tab"; text: string }
  | { kind: "raw"; text: string }
  | { kind: "empty" };

/** A single-direction chunk of a lyric line (see {@link directionalCells}). */
export interface ExportCell {
  chord?: string;
  text: string;
  direction: TextDirection;
}

/** A song rendered at a given transpose and capo. */
export interface ExportSong {
  /** `song.title ?? ""`. */
  title: string;
  /** Trimmed value of the first `artist` meta line; omitted when absent or empty. */
  artist?: string;
  soundingKey?: string;
  shapeKey?: string;
  /** Effective capo used. */
  capo: number;
  /** Effective transpose used. */
  transpose: number;
  /** Resolved song direction. */
  direction: TextDirection;
  /** The transposed, capo-adjusted model (what the viewer shows). */
  model: SongModel;
  lines: ExportLine[];
}

/** One setlist entry: a song with its own transpose and capo. */
export interface ExportEntry {
  song: SongModel;
  transpose?: number;
  capo?: number;
}

/** A titled, ordered list of exported songs. */
export interface ExportDocument {
  title: string;
  songs: ExportSong[];
}

/** Resolved song direction: `song.direction`, else first strong lyric direction, else "ltr". */
export function exportSongDirection(song: SongModel): TextDirection {
  if (song.direction) return song.direction;
  for (const line of song.lines) {
    if (line.kind !== "lyric") continue;
    const dir = firstStrongDirection(line.lyric);
    if (dir) return dir;
  }
  return "ltr";
}

/** Line direction: `line.direction ?? songDirection ?? firstStrongDirection(lyric) ?? "ltr"`. */
export function exportLineDirection(
  line: LyricLine,
  songDirection?: TextDirection,
): TextDirection {
  return (
    line.direction ?? songDirection ?? firstStrongDirection(line.lyric) ?? "ltr"
  );
}

function segmentLyric(line: LyricLine): ExportSegment[] {
  const graphemes = splitGraphemes(line.lyric);
  const slice = (from: number, to: number): string =>
    graphemes.slice(from, to).join("");
  const segments: ExportSegment[] = [];
  const first = line.chords[0];
  const lead = slice(0, first ? first.index : graphemes.length);
  if (lead !== "") segments.push({ text: lead });
  line.chords.forEach((anchor, i) => {
    const next = line.chords[i + 1];
    segments.push({
      chord: anchor.chord,
      text: slice(anchor.index, next ? next.index : graphemes.length),
    });
  });
  return segments;
}

/** Build the export form of one song at a transpose and capo. */
export function buildExportSong(
  song: SongModel,
  opts?: { transpose?: number; capo?: number },
): ExportSong {
  const transpose = opts?.transpose ?? 0;
  const view = viewSong(song, {
    transpose,
    capo: opts?.capo ?? song.capo ?? 0,
  });
  const viewed = view.song;
  const direction = exportSongDirection(viewed);
  const lines: ExportLine[] = [];
  for (const line of viewed.lines) {
    switch (line.kind) {
      case "lyric":
        lines.push({
          kind: "lyric",
          direction: exportLineDirection(line, viewed.direction),
          segments: segmentLyric(line),
        });
        break;
      case "chords":
        lines.push({
          kind: "chords",
          chords: [...line.chords],
          direction: viewed.direction ?? "ltr",
        });
        break;
      case "section":
        if (line.edge === "start") {
          lines.push({
            kind: "section",
            label: line.label ?? line.section,
            direction,
          });
        }
        break;
      case "comment":
        lines.push({
          kind: "comment",
          text: line.text,
          direction: firstStrongDirection(line.text) ?? "ltr",
        });
        break;
      case "tab":
        lines.push({ kind: "tab", text: line.text });
        break;
      case "raw":
        lines.push({ kind: "raw", text: line.text });
        break;
      case "empty":
        lines.push({ kind: "empty" });
        break;
      default:
        break;
    }
  }
  const result: ExportSong = {
    title: viewed.title ?? "",
    capo: view.capo,
    transpose,
    direction,
    model: viewed,
    lines,
  };
  const artistLine = viewed.lines.find(
    (l) => l.kind === "meta" && l.name === "artist",
  );
  if (artistLine?.kind === "meta") {
    const artist = artistLine.value.trim();
    if (artist !== "") result.artist = artist;
  }
  if (view.soundingKey !== undefined) result.soundingKey = view.soundingKey;
  if (view.shapeKey !== undefined) result.shapeKey = view.shapeKey;
  return result;
}

/** Build an export document: songs in entry order, each with its own transpose/capo. */
export function buildExportDocument(
  title: string,
  entries: readonly ExportEntry[],
): ExportDocument {
  return {
    title,
    songs: entries.map((e) =>
      buildExportSong(e.song, { transpose: e.transpose, capo: e.capo }),
    ),
  };
}

/** Hebrew or Arabic first code point; the same set as `RTL_LETTER` in `direction.ts`. */
const RTL_START = /^[\p{Script=Hebrew}\p{Script=Arabic}]/u;

type CharClass = "rtl" | "ltr" | "neutral";

function classify(grapheme: string): CharClass {
  const cp = grapheme.codePointAt(0) ?? 0;
  if (RTL_START.test(grapheme)) return "rtl";
  if (/^\p{L}/u.test(grapheme) || (cp >= 0x30 && cp <= 0x39)) return "ltr";
  return "neutral";
}

/**
 * Split a lyric line's segments at direction-run boundaries so each cell holds
 * one direction. Cells stay in logical order; a segment's chord goes on its
 * first cell.
 */
export function directionalCells(
  line: Extract<ExportLine, { kind: "lyric" }>,
): ExportCell[] {
  const items: { seg: number; g: string }[] = [];
  line.segments.forEach((s, seg) => {
    for (const g of splitGraphemes(s.text)) items.push({ seg, g });
  });
  const classes = items.map((it) => classify(it.g));
  const dirs: TextDirection[] = [];
  let i = 0;
  while (i < classes.length) {
    const c = classes[i] as CharClass;
    if (c !== "neutral") {
      dirs.push(c);
      i++;
      continue;
    }
    let j = i;
    while (j < classes.length && classes[j] === "neutral") j++;
    const before = i > 0 ? (classes[i - 1] as CharClass) : undefined;
    const after = j < classes.length ? (classes[j] as CharClass) : undefined;
    const dir: TextDirection =
      before !== undefined && before === after && before !== "neutral"
        ? before
        : line.direction;
    for (let k = i; k < j; k++) dirs.push(dir);
    i = j;
  }

  const cells: ExportCell[] = [];
  let pos = 0;
  line.segments.forEach((s, seg) => {
    let first = true;
    let cur: ExportCell | undefined;
    while (pos < items.length && (items[pos] as { seg: number }).seg === seg) {
      const d = dirs[pos] as TextDirection;
      const g = (items[pos] as { g: string }).g;
      if (cur && cur.direction === d) {
        cur.text += g;
      } else {
        cur = { text: g, direction: d };
        if (first && s.chord !== undefined) cur.chord = s.chord;
        first = false;
        cells.push(cur);
      }
      pos++;
    }
    if (first && s.chord !== undefined) {
      cells.push({ chord: s.chord, text: "", direction: line.direction });
    }
  });
  return cells;
}
