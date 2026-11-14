import { ChordLyricsPair, ChordProParser, Tag } from "chordsheetjs";
import type { TextDirection } from "./direction";
import { splitGraphemes } from "./graphemes";
import type { ChordAnchor, SongLine, SongModel } from "./model";

function firstString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

function toDirection(value: unknown): TextDirection | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim().toLowerCase();
  return v === "rtl" || v === "ltr" ? v : undefined;
}

/**
 * ChordSheetJS 18 keeps `{direction: x}` as a plain tag (not metadata), so read
 * its value from the tags when the metadata has none.
 */
function plainDirectionTag(
  lines: readonly { items: readonly unknown[] }[],
): unknown {
  const values: unknown[] = [];
  for (const line of lines) {
    for (const item of line.items) {
      if (item instanceof Tag && item.name === "direction")
        values.push(item.value);
    }
  }
  if (values.length === 0) return undefined;
  return values.every((v) => v === values[0]) ? values[0] : values;
}

/**
 * Parse ChordPro source into the line model using ChordSheetJS's parser only.
 * Mapping rules are frozen in task 02 R5: comment/directive-only lines are
 * dropped, blank lines become `empty`, the empty line after a final newline is
 * dropped, and chord anchors are grapheme indices into the logical lyric.
 */
export function parseSong(source: string): SongModel {
  if (source === "") return { lines: [] };

  let song;
  try {
    song = new ChordProParser().parse(source);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`parseSong: ${detail}`, { cause: err });
  }

  const rawLines = song.lines;
  const dropLast = /\r?\n$/.test(source);
  const out: SongLine[] = [];

  rawLines.forEach((line, i) => {
    if (dropLast && i === rawLines.length - 1) return;
    const items = line.items;
    if (items.length === 0) {
      out.push({ kind: "empty" });
      return;
    }
    const pairs = items.filter(
      (item): item is ChordLyricsPair => item instanceof ChordLyricsPair,
    );
    if (pairs.length === 0) return; // directive/comment-only line

    let lyric = "";
    const chords: ChordAnchor[] = [];
    for (const pair of pairs) {
      const chord = pair.chords ?? "";
      if (chord !== "") {
        chords.push({ index: splitGraphemes(lyric).length, chord });
      }
      lyric += pair.lyrics ?? "";
    }

    if (lyric.trim() === "") {
      if (chords.length > 0) {
        out.push({ kind: "chords", chords: chords.map((c) => c.chord) });
      } else {
        out.push({ kind: "empty" });
      }
      return;
    }
    out.push({ kind: "lyric", lyric, chords });
  });

  const title = firstString(song.getMetadataValue("title"));
  const direction = toDirection(
    song.getMetadataValue("direction") ?? plainDirectionTag(rawLines),
  );
  return {
    ...(title !== undefined ? { title } : {}),
    ...(direction ? { direction } : {}),
    lines: out,
  };
}
