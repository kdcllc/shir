import { firstStrongDirection, splitGraphemes } from "chord-core";
import type { ChordOnlyLine, LyricLine, TextDirection } from "chord-core";
import { Fragment, type MouseEvent, type ReactNode } from "react";
import { ChordSymbol } from "./ChordSymbol";
import styles from "./ChordLine.module.css";
import { lineDirection } from "./lineDirection";

/** Interactive mode for the visual editor (lyric lines only). */
export interface ChordLineEditing {
  /** Grapheme position shown as the caret (0..graphemeCount); none when undefined. */
  caret?: number | undefined;
  /** Position `index` (0..graphemeCount; graphemeCount = end of line) was clicked. */
  onPosition(index: number): void;
  /** The chord at `line.chords[anchor]` was clicked. */
  onChord(anchor: number): void;
}

export interface ChordLineProps {
  line: LyricLine | ChordOnlyLine;
  songDirection?: TextDirection;
  /** Interactive mode; absent means read-only rendering. */
  editing?: ChordLineEditing | undefined;
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

/** A chord with its index in `line.chords` (editing mode). */
interface ChordRef {
  chord: string;
  anchor: number;
}

/** Chord buttons in source order separated by single spaces (B1). */
function ChordButtons({ chords }: { chords: ChordRef[] }) {
  return chords.map(({ chord, anchor }, i) => (
    <Fragment key={anchor}>
      {i > 0 ? " " : null}
      <button
        type="button"
        data-chord-button=""
        data-anchor-index={anchor}
        className={styles.chordbtn}
      >
        <ChordSymbol chord={chord} />
      </button>
    </Fragment>
  ));
}

/** One click target: a grapheme, or the end slot when `end` is set. */
function Position({
  pos,
  text,
  chords,
  boxDir,
  caret,
  end,
}: {
  pos: number;
  text: string;
  chords: ChordRef[] | undefined;
  boxDir: TextDirection;
  caret: boolean;
  end: boolean;
}) {
  return (
    <span
      data-pos={pos}
      data-end-slot={end ? "" : undefined}
      data-caret={caret ? "" : undefined}
      data-anchor={chords ? "" : undefined}
      data-index={chords ? pos : undefined}
      className={chords ? `${styles.anchor} ${styles.pos}` : styles.pos}
    >
      {text}
      {chords ? (
        <span data-chord-box="" dir={boxDir} className={styles.box}>
          <ChordButtons chords={chords} />
        </span>
      ) : null}
    </span>
  );
}

/** Editing mode: one position element per grapheme, then the end slot. */
function EditingContent({
  line,
  lineDir,
  caret,
}: {
  line: LyricLine;
  lineDir: TextDirection;
  caret: number | undefined;
}) {
  const graphemes = splitGraphemes(line.lyric);
  const count = graphemes.length;
  const byIndex = new Map<number, ChordRef[]>();
  line.chords.forEach(({ index, chord }, anchor) => {
    const i = Math.min(Math.max(index, 0), count);
    const list = byIndex.get(i);
    if (list) list.push({ chord, anchor });
    else byIndex.set(i, [{ chord, anchor }]);
  });
  return (
    <>
      {graphemes.map((g, i) => (
        <Position
          key={i}
          pos={i}
          text={g}
          chords={byIndex.get(i)}
          boxDir={firstStrongDirection(g) ?? lineDir}
          caret={caret === i}
          end={false}
        />
      ))}
      <Position
        key="end"
        pos={count}
        text=""
        chords={byIndex.get(count)}
        boxDir={lineDir}
        caret={caret === count}
        end
      />
    </>
  );
}

/** One lyric / chord-only line (B2, amended B3, B5, B6). */
export function ChordLine({ line, songDirection, editing }: ChordLineProps) {
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
  const lineDir = lineDirection(line, songDirection);
  if (editing) {
    // One delegated handler: a chord button wins over the position around it.
    const onClick = (event: MouseEvent<HTMLDivElement>) => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest("[data-chord-button]");
      if (button) {
        editing.onChord(Number(button.getAttribute("data-anchor-index")));
        return;
      }
      const pos = event.target.closest("[data-pos]");
      if (pos) editing.onPosition(Number(pos.getAttribute("data-pos")));
    };
    return (
      <div
        data-line="lyric"
        data-editing=""
        dir={line.direction ?? songDirection ?? "auto"}
        className={styles.lyric}
        onClick={onClick}
      >
        <EditingContent line={line} lineDir={lineDir} caret={editing.caret} />
      </div>
    );
  }
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
