import type { SongModel } from "chord-core";
import { useRef } from "react";
import { ChordLine, EmptyLine } from "./ChordLine";
import { useChordOverlap } from "./overlap";
import styles from "./SongView.module.css";

export interface SongViewProps {
  song: SongModel;
  className?: string;
}

/** Renders a song; the song root isolates bidi (B5) and runs the B4 overlap pass. */
export function SongView({ song, className }: SongViewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const pass = useChordOverlap(rootRef, song);
  return (
    <div
      ref={rootRef}
      data-song=""
      dir={song.direction ?? "auto"}
      data-overlap-pass={pass}
      className={className ? `${styles.song} ${className}` : styles.song}
    >
      {song.lines.map((line, i) =>
        line.kind === "empty" ? (
          <EmptyLine key={i} />
        ) : (
          <ChordLine key={i} line={line} songDirection={song.direction} />
        ),
      )}
    </div>
  );
}
