import { firstStrongDirection } from "chord-core";
import type { LyricLine, SongModel, TextDirection } from "chord-core";

/** Effective direction of a lyric line: `line.direction ?? songDirection ?? firstStrongDirection(line.lyric) ?? "ltr"`. */
export function lineDirection(
  line: LyricLine,
  songDirection?: TextDirection,
): TextDirection {
  return (
    line.direction ?? songDirection ?? firstStrongDirection(line.lyric) ?? "ltr"
  );
}

/**
 * Resolved direction of a whole song: `song.direction` when set, else the first strong
 * direction of the song's lyric text, else `"ltr"`.
 */
export function songDirection(song: SongModel): TextDirection {
  if (song.direction) return song.direction;
  for (const line of song.lines) {
    if (line.kind !== "lyric") continue;
    const dir = firstStrongDirection(line.lyric);
    if (dir) return dir;
  }
  return "ltr";
}
