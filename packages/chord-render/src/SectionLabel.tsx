import type { SectionLine, SongModel } from "chord-core";
import { songDirection } from "./lineDirection";

/**
 * Section-start label (N15). The block takes the song's resolved direction so the label
 * aligns with the lyrics; the label text is an isolate that keeps its own order.
 */
export function SectionLabel({
  line,
  song,
}: {
  line: SectionLine;
  song: SongModel;
}) {
  return (
    <p
      data-line="section"
      data-section={line.section}
      dir={songDirection(song)}
    >
      <bdi>{line.label ?? line.section}</bdi>
    </p>
  );
}
