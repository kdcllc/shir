import { firstStrongDirection } from "chord-core";
import type { LyricLine, TextDirection } from "chord-core";

/** Effective direction of a lyric line: `line.direction ?? songDirection ?? firstStrongDirection(line.lyric) ?? "ltr"`. */
export function lineDirection(
  line: LyricLine,
  songDirection?: TextDirection,
): TextDirection {
  return (
    line.direction ?? songDirection ?? firstStrongDirection(line.lyric) ?? "ltr"
  );
}
