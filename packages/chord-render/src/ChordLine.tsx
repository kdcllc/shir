import { firstStrongDirection, splitGraphemes } from "chord-core";
import type { ChordOnlyLine, LyricLine, TextDirection } from "chord-core";
import { Fragment, type ReactNode } from "react";
import { ChordSymbol } from "./ChordSymbol";
import styles from "./ChordLine.module.css";

export interface ChordLineProps {
  line: LyricLine | ChordOnlyLine;
  songDirection?: TextDirection;
}

/** Chord symbols in source order separated by single spaces (B1). */
function Chords({ chords }: { chords: string[] }) {
  return chords.map((chord, i) => (
    <Fragment key={i}>
      {i > 0 ? " " : null}
      <ChordSymbol chord={chord} />
    </Fragment>
  ));
}

function Anchor({
  index,
  text,
  chords,
  boxDir,
}: {
  index: number;
  text: string;
  chords: string[];
  boxDir: TextDirection;
}) {
  return (
    <span data-anchor="" data-index={index} className={styles.anchor}>
      {text}
      <span data-chord-box="" dir={boxDir} className={styles.box}>
        <Chords chords={chords} />
      </span>
    </span>
  );
}

function LyricContent({
  line,
  lineDir,
}: {
  line: LyricLine;
  lineDir: TextDirection;
}) {
  const graphemes = splitGraphemes(line.lyric);
  const count = graphemes.length;
  const byIndex = new Map<number, string[]>();
  for (const { index, chord } of line.chords) {
    const i = Math.min(Math.max(index, 0), count);
    const list = byIndex.get(i);
    if (list) list.push(chord);
    else byIndex.set(i, [chord]);
  }
  const indices = [...byIndex.keys()].sort((a, b) => a - b);

  const out: ReactNode[] = [];
  let cursor = 0;
  const pushSeg = (to: number) => {
    if (to > cursor) {
      out.push(
        <span key={`s${cursor}`} data-seg="" className={styles.seg}>
          {graphemes.slice(cursor, to).join("")}
        </span>,
      );
    }
  };
  for (const i of indices) {
    pushSeg(i);
    const chords = byIndex.get(i) ?? [];
    if (i < count) {
      const g = graphemes[i] ?? "";
      out.push(
        <Anchor
          key={`a${i}`}
          index={i}
          text={g}
          chords={chords}
          boxDir={firstStrongDirection(g) ?? lineDir}
        />,
      );
      cursor = i + 1;
    } else {
      out.push(
        <Anchor
          key={`a${i}`}
          index={i}
          text=""
          chords={chords}
          boxDir={lineDir}
        />,
      );
      cursor = count;
    }
  }
  pushSeg(count);
  return out;
}

/** One lyric / chord-only line (B2, amended B3, B5, B6). */
export function ChordLine({ line, songDirection }: ChordLineProps) {
  if (line.kind === "chords") {
    return (
      <div
        data-line="chords"
        dir={songDirection ?? "auto"}
        className={styles.chords}
      >
        <Chords chords={line.chords} />
      </div>
    );
  }
  const lineDir: TextDirection =
    line.direction ??
    songDirection ??
    firstStrongDirection(line.lyric) ??
    "ltr";
  return (
    <div
      data-line="lyric"
      dir={line.direction ?? songDirection ?? "auto"}
      className={styles.lyric}
    >
      <LyricContent line={line} lineDir={lineDir} />
    </div>
  );
}

/** Blank separator line. */
export function EmptyLine() {
  return <div data-line="empty" className={styles.empty} />;
}
