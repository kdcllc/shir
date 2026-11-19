import { firstStrongDirection, splitGraphemes } from "chord-core";
import type { SongLine, SongModel, TextDirection } from "chord-core";

function clamp(value: number, max: number): number {
  return Math.min(Math.max(Math.trunc(value) || 0, 0), max);
}

/**
 * Direction of every grapheme: its own when it has a strong character; a
 * neutral one takes the direction of its nearest strong neighbours when they
 * agree, otherwise the line's. The line start and end count as the line's.
 */
function graphemeDirections(
  graphemes: readonly string[],
  lineDir: TextDirection,
): TextDirection[] {
  const strong = graphemes.map((g) => firstStrongDirection(g));
  const after: TextDirection[] = [];
  let next = lineDir;
  for (let i = graphemes.length - 1; i >= 0; i--) {
    after[i] = next;
    next = strong[i] ?? next;
  }
  let before = lineDir;
  return strong.map((own, i) => {
    if (own !== null && own !== undefined) {
      before = own;
      return own;
    }
    return before === after[i] ? before : lineDir;
  });
}

/**
 * Every position `0..n` of a line (`n` = end of line) exactly once, from
 * visual left to visual right. Simplified bidi: runs of equal direction are
 * laid out in line order (reversed on an `rtl` line), an `rtl` run reads
 * right to left, and the end position sits at the line's inline end. Number
 * runs and nested embeddings are not modelled.
 */
export function visualOrder(
  graphemes: readonly string[],
  lineDir: TextDirection,
): number[] {
  const n = graphemes.length;
  const dirs = graphemeDirections(graphemes, lineDir);
  const runs: { dir: TextDirection; indices: number[] }[] = [];
  dirs.forEach((dir, i) => {
    const last = runs[runs.length - 1];
    if (last !== undefined && last.dir === dir) last.indices.push(i);
    else runs.push({ dir, indices: [i] });
  });
  if (lineDir === "rtl") runs.reverse();
  const order = runs.flatMap((run) =>
    run.dir === "rtl" ? [...run.indices].reverse() : run.indices,
  );
  return lineDir === "rtl" ? [n, ...order] : [...order, n];
}

/**
 * The position one step to the visual `side` of `index` (clamped to `0..n`);
 * `index` itself at that visual end of the line.
 */
export function visualStep(
  side: "left" | "right",
  index: number,
  graphemes: readonly string[],
  lineDir: TextDirection,
): number {
  const from = clamp(index, graphemes.length);
  const order = visualOrder(graphemes, lineDir);
  const at = order.indexOf(from);
  return order[side === "left" ? at - 1 : at + 1] ?? from;
}

/** The caret position after a display-mode navigation key. */
export function caretMove(
  key: "ArrowLeft" | "ArrowRight" | "Home" | "End",
  caret: number,
  graphemes: readonly string[],
  lineDir: TextDirection,
): number {
  if (key === "Home") return 0;
  if (key === "End") return graphemes.length;
  return visualStep(
    key === "ArrowLeft" ? "left" : "right",
    caret,
    graphemes,
    lineDir,
  );
}

/** Number of whole graphemes of `text` that end at or before `codeUnitOffset`. */
export function graphemeIndexAt(text: string, codeUnitOffset: number): number {
  let end = 0;
  let count = 0;
  for (const grapheme of splitGraphemes(text)) {
    end += grapheme.length;
    if (end > codeUnitOffset) break;
    count++;
  }
  return count;
}

// ---- UI state of the visual editor ----------------------------------------

/** How the visual editor edits a row; `null` when the row has no text field. */
export type RowClass = "text" | "chords";

/** The open chord picker: adding at a position, or editing `chords[anchor]`. */
export type PickerTarget =
  | { seq: number; line: number; kind: "add"; index: number }
  | { seq: number; line: number; kind: "chord"; anchor: number };

/** What to do once the edited song arrives; dropped when the edit is rejected. */
export type PendingFocus =
  | { kind: "edit"; line: number; caret: number }
  | { kind: "anchor"; index: number; chord: string };

/** UI-only state of the visual editor; every row index refers to `song.lines`. */
export interface VisualUi {
  /** Counter that makes each picker, lyric input and focus request distinct. */
  seq: number;
  /** Row whose wrapper has the focus. */
  focused: number | null;
  /** Most recently focused row (where Add section inserts). */
  lastRow: number | null;
  caret: { line: number; index: number } | null;
  picker: PickerTarget | null;
  /** Row in lyric-edit mode; `caret` is a code-unit offset into its text. */
  edit: { seq: number; line: number; kind: RowClass; caret: number } | null;
  pending: PendingFocus | null;
  /**
   * Set with every edit this editor reports: a song that arrives while it is
   * set is that edit's result, any other new song is a change from outside.
   */
  own: boolean;
  /** Request to focus a row wrapper. */
  focusRow: { seq: number; line: number } | null;
}

export function initialUi(): VisualUi {
  return {
    seq: 0,
    focused: null,
    lastRow: null,
    caret: null,
    picker: null,
    edit: null,
    pending: null,
    own: false,
    focusRow: null,
  };
}

/** The lyric of a line; `""` for anything but a lyric line. */
export function lyricOf(line: SongLine | undefined): string {
  return line?.kind === "lyric" ? line.lyric : "";
}

/**
 * `"text"` for a lyric or empty line and for the phantom row at
 * `song.lines.length`, `"chords"` for a chords line, otherwise `null`.
 */
export function rowClass(song: SongModel, line: number): RowClass | null {
  if (line === song.lines.length) return "text";
  const kind = song.lines[line]?.kind;
  if (kind === "lyric" || kind === "empty") return "text";
  return kind === "chords" ? "chords" : null;
}

/** Indices of the rows with a focusable wrapper, the phantom row included. */
export function textRows(song: SongModel): number[] {
  const rows: number[] = [];
  for (let i = 0; i <= song.lines.length; i++) {
    if (rowClass(song, i) === "text") rows.push(i);
  }
  return rows;
}

/** The nearest text row before (`-1`) or after (`1`) `line`, if any. */
export function neighbourRow(
  song: SongModel,
  line: number,
  delta: -1 | 1,
): number | undefined {
  const rows = textRows(song);
  return delta === 1
    ? rows.find((row) => row > line)
    : rows.reverse().find((row) => row < line);
}

/** Stable identities of the rows of a song: one per line, the phantom row last. */
export interface RowIds {
  keys: readonly number[];
  /** The next unused identity. */
  next: number;
}

/** Fresh identities for every row of `song`. */
export function initialRowIds(song: SongModel): RowIds {
  const count = song.lines.length + 1;
  return { keys: Array.from({ length: count }, (_, i) => i), next: count };
}

/**
 * The identities of the rows of `next`: a row that has a counterpart in
 * `prev` (`trackLine`) keeps its identity, so a row that shifts or moves, by
 * an edit of this editor or from outside, stays the same React element (its
 * picker, draft and focus survive); every other row is new.
 */
export function followRowIds(
  ids: RowIds,
  prev: SongModel,
  next: SongModel,
  own: boolean,
): RowIds {
  const map = trackLine(prev, next, own);
  const keys: (number | undefined)[] = Array.from(
    { length: next.lines.length + 1 },
    () => undefined,
  );
  ids.keys.forEach((key, line) => {
    const to = map(line);
    if (to !== null && to < keys.length && keys[to] === undefined) {
      keys[to] = key;
    }
  });
  let fresh = ids.next;
  return { keys: keys.map((key) => key ?? fresh++), next: fresh };
}

/**
 * Where each line of `prev` (and its phantom row) is in `next`. Lines of the
 * common prefix keep their index, lines of the common suffix shift with the
 * line count, and a line of the changed span in between has a counterpart
 * only when that span has the same number of lines on both sides: the line
 * with the same content when that content occurs exactly once in the span on
 * both sides (a reorder), otherwise the line at the same place.
 */
export function lineMap(
  prev: SongModel,
  next: SongModel,
): (line: number) => number | null {
  const before = prev.lines.map((line) => JSON.stringify(line));
  const after = next.lines.map((line) => JSON.stringify(line));
  const shortest = Math.min(before.length, after.length);
  let head = 0;
  while (head < shortest && before[head] === after[head]) head++;
  let tail = 0;
  while (
    tail < shortest - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail++;
  }
  const shift = after.length - before.length;
  const end = before.length - tail;
  return (line) => {
    if (!Number.isInteger(line) || line < 0 || line > before.length) {
      return null;
    }
    if (line < head) return line;
    if (line >= end) return line + shift;
    if (shift !== 0) return null;
    // Same line count: the changed span is `head..end` on both sides.
    const content = before[line];
    const same = (other: string) => other === content;
    const from = before.slice(head, end).filter(same);
    const to = after.slice(head, end);
    return from.length === 1 && to.filter(same).length === 1
      ? head + to.findIndex(same)
      : line;
  };
}

/**
 * Where each line of `prev` (and its phantom row) is in `next`: `lineMap`,
 * except that after the editor's own edit (`own`) that only appends lines the
 * phantom row keeps its index, being the row that became the first new line.
 */
export function trackLine(
  prev: SongModel,
  next: SongModel,
  own: boolean,
): (line: number) => number | null {
  const map = lineMap(prev, next);
  const count = prev.lines.length;
  const appended =
    own &&
    next.lines.length > count &&
    prev.lines.every(
      (line, i) => JSON.stringify(line) === JSON.stringify(next.lines[i]),
    );
  return (line) => (appended && line === count ? line : map(line));
}

/** `ui` with every row index moved to where its line is in `next`. */
function followLines(ui: VisualUi, prev: SongModel, next: SongModel): VisualUi {
  const map = trackLine(prev, next, ui.own);
  const at = (line: number | null) => (line === null ? null : map(line));
  const caretLine = at(ui.caret?.line ?? null);
  const pickerLine = at(ui.picker?.line ?? null);
  return {
    ...ui,
    focused: at(ui.focused),
    lastRow: at(ui.lastRow),
    caret:
      ui.caret !== null && caretLine !== null
        ? { line: caretLine, index: ui.caret.index }
        : null,
    picker:
      ui.picker !== null && pickerLine !== null
        ? { ...ui.picker, line: pickerLine }
        : null,
  };
}

function reconcilePicker(ui: VisualUi, song: SongModel): PickerTarget | null {
  const picker = ui.picker;
  if (picker === null || rowClass(song, picker.line) !== "text") return null;
  if (picker.kind === "add") return picker;
  const line = song.lines[picker.line];
  if (line?.kind !== "lyric") return null;
  const moved = ui.pending?.kind === "anchor" ? ui.pending : null;
  if (moved === null) {
    return picker.anchor < line.chords.length ? picker : null;
  }
  // chord-core re-inserts a moved chord after the anchors already at its index.
  const anchor = line.chords.map((a) => a.index).lastIndexOf(moved.index);
  return line.chords[anchor]?.chord === moved.chord
    ? { ...picker, anchor }
    : null;
}

/**
 * The UI state for a new `song`: applies the pending focus and resets every
 * row index that no longer points at a row of the same kind. With `prev` (the
 * song shown until now) every row index first moves along with its line
 * (`lineMap`) — after this editor's own edit as well as after a change from
 * outside (song details, undo, the Source tab) — so the picker, the caret and
 * the last focused row stay on the line they were on.
 */
export function reconcileUi(
  state: VisualUi,
  song: SongModel,
  prev?: SongModel,
): VisualUi {
  const ui = prev === undefined ? state : followLines(state, prev, song);
  const isText = (line: number) => rowClass(song, line) === "text";
  const target = ui.pending?.kind === "edit" ? ui.pending : null;
  const seq = ui.seq + 1;
  const caret = ui.caret;
  return {
    seq,
    focused: ui.focused !== null && isText(ui.focused) ? ui.focused : null,
    lastRow:
      ui.lastRow !== null && ui.lastRow <= song.lines.length
        ? ui.lastRow
        : null,
    caret:
      caret !== null && isText(caret.line)
        ? {
            line: caret.line,
            index: clamp(
              caret.index,
              splitGraphemes(lyricOf(song.lines[caret.line])).length,
            ),
          }
        : null,
    picker: reconcilePicker(ui, song),
    edit:
      target !== null && isText(target.line)
        ? { seq, line: target.line, kind: "text", caret: target.caret }
        : null,
    pending: null,
    own: false,
    focusRow: ui.focusRow,
  };
}
