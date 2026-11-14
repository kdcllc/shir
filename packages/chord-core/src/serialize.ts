import { splitGraphemes } from "./graphemes";
import {
  META_NAMES,
  type LyricLine,
  type SongLine,
  type SongModel,
} from "./model";

const KNOWN_META: ReadonlySet<string> = new Set(
  META_NAMES.filter((n) => n !== "direction"),
);

function withValue(name: string, value: string): string {
  return value === "" ? `{${name}}` : `{${name}: ${value}}`;
}

function serializeLyric(line: LyricLine): string {
  const clusters = splitGraphemes(line.lyric);
  const count = clusters.length;
  const buckets: string[][] = Array.from({ length: count + 1 }, () => []);
  for (const anchor of line.chords) {
    const raw = Math.trunc(anchor.index);
    const at = Number.isNaN(raw) ? 0 : Math.min(Math.max(raw, 0), count);
    buckets[at]?.push(`[${anchor.chord}]`);
  }
  let out = "";
  for (let i = 0; i <= count; i++) {
    out += (buckets[i] ?? []).join("");
    out += clusters[i] ?? "";
  }
  return out;
}

function serializeLine(line: SongLine): string {
  switch (line.kind) {
    case "lyric":
      return serializeLyric(line);
    case "chords":
      return line.chords.map((c) => `[${c}]`).join(" ");
    case "empty":
      return "";
    case "meta":
      return KNOWN_META.has(line.name)
        ? withValue(line.name, line.value)
        : withValue(
            "meta",
            line.value === "" ? line.name : `${line.name} ${line.value}`,
          );
    case "comment": {
      const name =
        line.style === "normal" ? "comment" : `comment_${line.style}`;
      return withValue(name, line.text);
    }
    case "section":
      return line.edge === "end"
        ? `{end_of_${line.section}}`
        : withValue(`start_of_${line.section}`, line.label ?? "");
    case "directive":
      return withValue(line.name, line.value ?? "");
    case "remark":
      return `#${line.text}`;
    case "tab":
    case "raw":
      return line.text;
  }
}

/** Serialize a song model to canonical ChordPro text (`docs/CHORDPRO.md`). */
export function serializeSong(song: SongModel): string {
  if (song.lines.length === 0) return "";
  return song.lines.map(serializeLine).join("\n") + "\n";
}
