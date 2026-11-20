import type { ExportSong } from "chord-core";
import type { ExportLabels } from "./types";

/** Key and capo of a song for cover entries and song headers; the values are LTR. */
export function SongFacts({
  song,
  labels,
}: {
  song: ExportSong;
  labels: ExportLabels;
}) {
  return (
    <>
      {song.soundingKey !== undefined && (
        <span data-print-key="">
          {labels.key} <bdi dir="ltr">{song.soundingKey}</bdi>
        </span>
      )}
      {song.capo > 0 && (
        <span data-print-capo="">
          {labels.capo} <bdi dir="ltr">{song.capo}</bdi>
        </span>
      )}
    </>
  );
}
