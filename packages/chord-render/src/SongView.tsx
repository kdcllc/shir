import type { SongLine, SongModel } from "chord-core";
import { useRef } from "react";
import { ChordLine, EmptyLine } from "./ChordLine";
import { useChordOverlap } from "./overlap";
import { SectionLabel } from "./SectionLabel";
import styles from "./SongView.module.css";

export interface SongViewProps {
  song: SongModel;
  className?: string;
}

function renderLine(line: SongLine, i: number, song: SongModel) {
  switch (line.kind) {
    case "lyric":
    case "chords":
      return <ChordLine key={i} line={line} songDirection={song.direction} />;
    case "empty":
      return <EmptyLine key={i} />;
    case "comment":
      return (
        <p key={i} data-line="comment" data-style={line.style} dir="auto">
          {line.text}
        </p>
      );
    case "section":
      return line.edge === "start" ? (
        <SectionLabel key={i} line={line} song={song} />
      ) : null;
    case "tab":
      return (
        <p key={i} data-line="tab" dir="ltr">
          {line.text}
        </p>
      );
    case "raw":
      return (
        <p key={i} data-line="raw" dir="auto">
          {line.text}
        </p>
      );
    case "meta":
    case "remark":
    case "directive":
      return null;
    default: {
      const unreachable: never = line;
      return unreachable;
    }
  }
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
      {song.lines.map((line, i) => renderLine(line, i, song))}
    </div>
  );
}
