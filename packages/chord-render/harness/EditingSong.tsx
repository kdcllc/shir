import type { SongLine, SongModel } from "chord-core";
import { useRef } from "react";
import { ChordLine, EmptyLine } from "../src/ChordLine";
import { useChordOverlap } from "../src/overlap";
import { SectionLabel } from "../src/SectionLabel";
import styles from "../src/SongView.module.css";

/** The last editing callback, recorded on `window.__lastEdit` for the bidi specs. */
export type HarnessEdit =
  | { kind: "position"; line: number; index: number }
  | { kind: "chord"; line: number; anchor: number };

function renderLine(line: SongLine, i: number, song: SongModel) {
  switch (line.kind) {
    case "lyric":
      return (
        <ChordLine
          key={i}
          line={line}
          songDirection={song.direction}
          editing={{
            onPosition: (index) => {
              window.__lastEdit = { kind: "position", line: i, index };
            },
            onChord: (anchor) => {
              window.__lastEdit = { kind: "chord", line: i, anchor };
            },
          }}
        />
      );
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

/** `SongView` with interactive lyric lines, for the editing-mode bidi specs. */
export function EditingSong({ song }: { song: SongModel }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const pass = useChordOverlap(rootRef, song);
  return (
    <div
      ref={rootRef}
      data-song=""
      dir={song.direction ?? "auto"}
      data-overlap-pass={pass}
      className={styles.song}
    >
      {song.lines.map((line, i) => renderLine(line, i, song))}
    </div>
  );
}
