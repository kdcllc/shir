import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FocusEvent, KeyboardEvent, ReactNode } from "react";
import {
  SECTION_KINDS,
  isValidChordText,
  listSections,
  parseChord,
  serializeSong,
  splitGraphemes,
  suggestChords,
} from "chord-core";
import type {
  CommentLine,
  EditOp,
  LyricLine,
  SectionKind,
  SongLine,
  SongModel,
} from "chord-core";
import { ChordLine, lineDirection, useChordOverlap } from "chord-render";
import { useT } from "../i18n";
import {
  caretMove,
  followRowIds,
  graphemeIndexAt,
  initialRowIds,
  initialUi,
  lyricOf,
  neighbourRow,
  reconcileUi,
  textRows,
  visualStep,
} from "../visualKeys";
import type { RowClass } from "../visualKeys";
import { ChordPicker } from "./ChordPicker";
import { SectionControls } from "./SectionControls";
import styles from "./VisualEditor.module.css";

const noRoot = (): HTMLDivElement | null => null;
const noSent = (): string | undefined => undefined;
const defaultKind = (): SectionKind => "verse";
const emptyLyric = (): LyricLine => ({ kind: "lyric", lyric: "", chords: [] });

const NAV_KEYS = ["ArrowLeft", "ArrowRight", "Home", "End"] as const;

const KIND_LABEL_KEYS = {
  verse: "sectionVerse",
  chorus: "sectionChorus",
  bridge: "sectionBridge",
} as const satisfies { readonly [Kind in SectionKind]: string };

const isKnownChord = (chord: string): boolean => parseChord(chord) !== null;

/** The line as its ChordPro source text. */
function sourceText(line: SongLine): string {
  return serializeSong({ lines: [line] }).replace(/\n$/, "");
}

/**
 * Local draft of a one-line value: typing stays local, blur and Enter commit
 * the draft once when it differs from `value`, Escape restores `value`, and
 * an outside change of `value` replaces the draft.
 */
function useDraft(value: string, commit: (next: string) => void) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  const [sent, setSent] = useState(noSent);
  if (seen !== value) {
    setSeen(value);
    setDraft(value);
    setSent(undefined);
  }

  const flush = () => {
    if (draft === value || draft === sent) return;
    setSent(draft);
    commit(draft);
  };

  return {
    value: draft,
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      setDraft(e.target.value);
      setSent(undefined);
    },
    onBlur: flush,
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        flush();
      } else if (e.key === "Escape") {
        setDraft(value);
        setSent(undefined);
      }
    },
  };
}

interface ChordsInputProps {
  chords: readonly string[];
  onCommit(chords: string[]): void;
}

/** The chords of a chord-only line as space separated text. */
function ChordsInput({ chords, onCommit }: ChordsInputProps) {
  const t = useT();
  const draft = useDraft(chords.join(" "), (next) =>
    onCommit(next.split(/\s+/).filter((chord) => chord !== "")),
  );
  return (
    <input
      type="text"
      dir="ltr"
      className={styles.chords}
      data-testid="chords-input"
      data-ui-chrome
      aria-label={t("chordsLineInput")}
      spellCheck={false}
      autoCapitalize="off"
      autoComplete="off"
      {...draft}
    />
  );
}

// Arrow components below: the desktop contract's JSX text scan reads a
// `function` declaration between two components as text.
interface CommentInputProps {
  text: string;
  onCommit(text: string): void;
}

const CommentInput = ({ text, onCommit }: CommentInputProps) => {
  const t = useT();
  const draft = useDraft(text, onCommit);
  return (
    <input
      type="text"
      dir="auto"
      className={styles.comment}
      data-testid="comment-input"
      data-ui-chrome
      aria-label={t("commentInput")}
      {...draft}
    />
  );
};

interface LyricInputProps {
  initial: string;
  /** Blur: commit the draft and leave lyric-edit mode. */
  onCommit(draft: string): void;
  /** Enter with the caret at code-unit `offset`. */
  onEnter(draft: string, offset: number): void;
  /** Backspace at the start; returns whether it was handled. */
  onBackspace?: ((draft: string) => boolean) | undefined;
  /** ArrowUp (`-1`) / ArrowDown (`1`); returns whether it was handled. */
  onArrow?: ((draft: string, delta: -1 | 1) => boolean) | undefined;
  onEscape(): void;
}

/** The lyric text of the row in lyric-edit mode; the editor focuses it. */
function LyricInput({
  initial,
  onCommit,
  onEnter,
  onBackspace,
  onArrow,
  onEscape,
}: LyricInputProps) {
  const t = useT();
  // Set when a key already dealt with the draft, so the blur that follows
  // (the input losing focus or being replaced) does not commit it again.
  const handled = useRef(false);
  const [draft, setDraft] = useState(initial);

  useEffect(() => {
    handled.current = false;
  });

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
    if (e.key === "Enter") {
      e.preventDefault();
      handled.current = true;
      onEnter(draft, el.selectionStart ?? draft.length);
    } else if (e.key === "Escape") {
      e.preventDefault();
      handled.current = true;
      onEscape();
    } else if (e.key === "Backspace" && atStart && onBackspace?.(draft)) {
      e.preventDefault();
      handled.current = true;
    } else if (
      (e.key === "ArrowUp" || e.key === "ArrowDown") &&
      onArrow?.(draft, e.key === "ArrowUp" ? -1 : 1)
    ) {
      e.preventDefault();
      handled.current = true;
    }
  };

  return (
    <input
      type="text"
      dir="auto"
      className={styles.lyrics}
      data-testid="line-input"
      data-ui-chrome
      aria-label={t("lyricsInput")}
      spellCheck={false}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => {
        if (!handled.current) onCommit(draft);
      }}
    />
  );
}

interface RowButtonsProps {
  onEditText?: (() => void) | undefined;
  onAddBelow?: (() => void) | undefined;
  onRemove?: (() => void) | undefined;
}

/** The secondary controls of a row; only the given actions are shown. */
const RowButtons = ({ onEditText, onAddBelow, onRemove }: RowButtonsProps) => {
  const t = useT();
  return (
    <span className={styles.buttons} data-ui-chrome>
      {onEditText !== undefined && (
        <button
          type="button"
          data-testid="line-edit-text"
          aria-label={t("editLyrics")}
          onClick={onEditText}
        >
          {t("editGlyph")}
        </button>
      )}
      {onAddBelow !== undefined && (
        <button
          type="button"
          data-testid="line-add-below"
          aria-label={t("addLineBelow")}
          onClick={onAddBelow}
        >
          {t("addGlyph")}
        </button>
      )}
      {onRemove !== undefined && (
        <button
          type="button"
          data-testid="line-remove"
          aria-label={t("removeLine")}
          onClick={onRemove}
        >
          {t("removeGlyph")}
        </button>
      )}
    </span>
  );
};

interface RowProps {
  /** Index of the line in `song.lines` (the phantom row: their count). */
  index: number;
  kind: string;
  phantom?: boolean | undefined;
  /** A visual terminator: hidden from assistive technology. */
  terminator?: boolean | undefined;
  /** The chord picker is open in this row. */
  pickerOpen?: boolean | undefined;
  onFocus(index: number): void;
  children?: ReactNode;
}

const Row = ({
  index,
  kind,
  phantom,
  terminator,
  pickerOpen,
  onFocus,
  children,
}: RowProps) => {
  return (
    <div
      className={styles.row}
      data-testid="visual-line"
      data-line-index={index}
      data-kind={kind}
      data-phantom={phantom === true ? "" : undefined}
      data-picker-open={pickerOpen === true ? "" : undefined}
      aria-hidden={terminator === true ? "true" : undefined}
      onFocus={() => onFocus(index)}
    >
      {children}
    </div>
  );
};

export interface VisualEditorProps {
  /** DOM id of the root (the tab's `aria-controls` target); default: no id attribute. */
  id?: string | undefined;
  song: SongModel;
  /** One user action = one call; the ops are applied together as one undo step. */
  onEdit(ops: readonly EditOp[]): void;
}

/**
 * The song as editable rows, chords over lyrics. Controlled: every action is
 * reported through `onEdit` and shows once the parent passes the edited
 * `song`; only UI state (focus, caret, picker, drafts) lives here.
 */
export function VisualEditor({ id, song, onEdit: report }: VisualEditorProps) {
  const t = useT();
  const rootRef = useRef(noRoot());
  const [seen, setSeen] = useState(song);
  const [ui, setUi] = useState(initialUi);
  const [ids, setIds] = useState(() => initialRowIds(song));
  const [addKind, setAddKind] = useState(defaultKind);

  // Leaving lyric-edit mode mounts a fresh ChordLine without a song change,
  // so the overlap pass follows the lyric-edit state as well as the song.
  const editing = ui.edit;
  const layout = useMemo(() => ({ song, editing }), [song, editing]);
  const pass = useChordOverlap(rootRef, layout);

  if (seen !== song) {
    // A new song: the result of this editor's own edit (apply the pending
    // focus) or a change from outside; row indices follow their lines.
    setSeen(song);
    setUi(reconcileUi(ui, song, seen));
    // Rows keep their identity (and so their picker and draft) when they shift.
    setIds(followRowIds(ids, seen, song, ui.own));
  } else if (ui.pending !== null || ui.own) {
    // The edit was rejected (same song): the row stays as it is.
    setUi({ ...ui, pending: null, own: false });
  }

  /** Reports one user action and marks the song that follows as its result. */
  const onEdit = (ops: readonly EditOp[]) => {
    report(ops);
    setUi((u) => (u.own ? u : { ...u, own: true }));
  };

  const focusRow = ui.focusRow;
  useEffect(() => {
    if (focusRow === null) return;
    const target = rootRef.current?.querySelector(
      `[data-line-index="${focusRow.line}"]`,
    );
    // A chords row has no wrapper (a chord added to an empty row): its input.
    const wrapper =
      target?.querySelector("[data-row-focus]") ??
      target?.querySelector(`.${styles.chords}`);
    if (wrapper instanceof HTMLElement) wrapper.focus();
  }, [focusRow]);

  // Lyric-edit mode: focus the input, the caret at the requested offset. Done
  // here, after the effects of the rows, so that a chord picker that mounts
  // in the same render (its row moved) does not take the focus back.
  const edit = ui.edit;
  useEffect(() => {
    if (edit === null) return;
    const input = rootRef.current?.querySelector(
      `[data-line-index="${edit.line}"] .${styles.lyrics}`,
    );
    if (!(input instanceof HTMLInputElement)) return;
    input.focus();
    input.setSelectionRange(edit.caret, edit.caret);
  }, [edit]);

  const count = song.lines.length;
  const keys = ids.keys;
  const spans = listSections(song);
  const wrappers = textRows(song);

  const noteRow = (line: number) =>
    setUi((u) => (u.lastRow === line ? u : { ...u, lastRow: line }));

  const focusWrapper = (line: number) =>
    setUi((u) => ({
      ...u,
      seq: u.seq + 1,
      focusRow: { seq: u.seq + 1, line },
    }));

  const openAdd = (line: number, index: number) =>
    setUi((u) => ({
      ...u,
      seq: u.seq + 1,
      edit: null,
      caret: { line, index },
      picker: { seq: u.seq + 1, line, kind: "add", index },
    }));

  const openChord = (line: number, anchor: number) =>
    setUi((u) => ({
      ...u,
      seq: u.seq + 1,
      edit: null,
      picker: { seq: u.seq + 1, line, kind: "chord", anchor },
    }));

  const closePicker = (line: number) =>
    setUi((u) => ({
      ...u,
      seq: u.seq + 1,
      picker: null,
      focusRow: { seq: u.seq + 1, line },
    }));

  const startEdit = (line: number, kind: RowClass, caret: number) =>
    setUi((u) => ({
      ...u,
      seq: u.seq + 1,
      picker: null,
      edit: { seq: u.seq + 1, line, kind, caret },
    }));

  const endEdit = (line: number) =>
    setUi((u) => (u.edit?.line === line ? { ...u, edit: null } : u));

  /** Lyric-edit mode on `line` once the edited song arrives. */
  const editNext = (line: number, caret: number) =>
    setUi((u) => ({ ...u, pending: { kind: "edit", line, caret } }));

  const removeLine = (line: number) => () =>
    onEdit([{ type: "removeLine", line }]);

  /** A lyric or empty line, or the phantom row after the last line. */
  const textRow = (i: number, source: SongLine | undefined) => {
    const phantom = i === count;
    const line = source?.kind === "lyric" ? source : emptyLyric();
    const blank = source?.kind !== "lyric";
    const lyric = line.lyric;
    const graphemes = splitGraphemes(lyric);
    const dir = lineDirection(line, song.direction);
    const caret = ui.caret?.line === i ? ui.caret.index : 0;
    const edit = ui.edit?.line === i ? ui.edit : null;
    const picker = ui.picker?.line === i ? ui.picker : null;
    const picked =
      picker?.kind === "chord" ? line.chords[picker.anchor] : undefined;

    const setLyric = (draft: string): EditOp[] =>
      draft === lyric ? [] : [{ type: "setLyric", line: i, text: draft }];

    const onCommit = (draft: string) => {
      const ops = setLyric(draft);
      if (ops.length > 0) onEdit(ops);
      endEdit(i);
    };

    const onEnter = (draft: string, offset: number) => {
      // The untouched phantom row is not a line yet: nothing to split or add.
      if (phantom && draft === "") return;
      onEdit([
        ...setLyric(draft),
        offset < draft.length
          ? {
              type: "splitLine",
              line: i,
              index: graphemeIndexAt(draft, offset),
            }
          : { type: "insertLine", at: i + 1 },
      ]);
      editNext(i + 1, 0);
    };

    const onBackspace = (draft: string) => {
      const above = song.lines[i - 1];
      if (above?.kind !== "lyric" && above?.kind !== "empty") return false;
      const end = lyricOf(above).length;
      if (phantom && draft === "") {
        // Nothing to join: the phantom row is not a line yet.
        startEdit(i - 1, "text", end);
        return true;
      }
      onEdit([...setLyric(draft), { type: "joinLines", line: i - 1 }]);
      editNext(i - 1, end);
      return true;
    };

    const onArrow = (draft: string, delta: -1 | 1) => {
      const target = neighbourRow(song, i, delta);
      if (target === undefined) return false;
      const end = lyricOf(song.lines[target]).length;
      const ops = setLyric(draft);
      if (ops.length > 0) {
        onEdit(ops);
        editNext(target, end);
      } else {
        startEdit(target, "text", end);
      }
      return true;
    };

    const onEscape = () =>
      setUi((u) => ({
        ...u,
        seq: u.seq + 1,
        edit: null,
        focusRow: { seq: u.seq + 1, line: i },
      }));

    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
      // Keys of the chord buttons inside the line are theirs.
      if (e.target !== e.currentTarget) return;
      const nav = NAV_KEYS.find((key) => key === e.key);
      if (nav !== undefined) {
        e.preventDefault();
        const index = caretMove(nav, caret, graphemes, dir);
        setUi((u) => ({ ...u, caret: { line: i, index } }));
      } else if (e.key === "Enter") {
        e.preventDefault();
        openAdd(i, caret);
      } else if (e.key === "F2") {
        e.preventDefault();
        startEdit(i, "text", lyric.length);
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const target = neighbourRow(song, i, e.key === "ArrowUp" ? -1 : 1);
        if (target !== undefined) focusWrapper(target);
      } else if (e.key === "Delete") {
        const anchor = line.chords.findIndex((a) => a.index === caret);
        if (anchor === -1) return;
        e.preventDefault();
        onEdit([{ type: "removeChord", line: i, anchor }]);
      }
    };

    const onWrapperFocus = (e: FocusEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return;
      setUi((u) => ({
        ...u,
        focused: i,
        caret: u.caret?.line === i ? u.caret : { line: i, index: 0 },
      }));
    };

    const onWrapperBlur = (e: FocusEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return;
      setUi((u) => (u.focused === i ? { ...u, focused: null } : u));
    };

    const onMove = (side: "left" | "right") => {
      if (picker?.kind !== "chord" || picked === undefined) return;
      const index = visualStep(side, picked.index, graphemes, dir);
      if (index === picked.index) return;
      onEdit([{ type: "moveChord", line: i, anchor: picker.anchor, index }]);
      // Follow the chord itself: its place in `chords` may change.
      setUi((u) => ({
        ...u,
        pending: { kind: "anchor", index, chord: picked.chord },
      }));
    };

    return (
      <Row
        key={keys[i]}
        index={i}
        kind={blank ? "empty" : "lyric"}
        phantom={phantom}
        pickerOpen={picker !== null}
        onFocus={noteRow}
      >
        {edit !== null ? (
          <LyricInput
            key={edit.seq}
            initial={lyric}
            onCommit={onCommit}
            onEnter={onEnter}
            onBackspace={onBackspace}
            onArrow={onArrow}
            onEscape={onEscape}
          />
        ) : (
          <div
            className={styles.line}
            data-row-focus=""
            tabIndex={0}
            role="group"
            aria-label={t("lineLabel", { n: wrappers.indexOf(i) + 1 })}
            onFocus={onWrapperFocus}
            onBlur={onWrapperBlur}
            onKeyDown={onKeyDown}
            // The second click of a double click (which enters lyric-edit
            // mode) does not open or reopen the chord picker.
            onClickCapture={(e) => {
              if (e.detail >= 2) e.stopPropagation();
            }}
            onClick={blank ? () => startEdit(i, "text", 0) : undefined}
            onDoubleClick={() => startEdit(i, "text", lyric.length)}
          >
            <ChordLine
              line={line}
              songDirection={song.direction}
              editing={{
                caret: ui.focused === i ? caret : undefined,
                // A click on an empty row starts typing instead (see onClick).
                onPosition: (index) => {
                  if (!blank) openAdd(i, index);
                },
                onChord: (anchor) => openChord(i, anchor),
              }}
            />
          </div>
        )}
        {blank && edit === null && (
          <button
            type="button"
            className={styles.add}
            data-testid="row-add-chord"
            data-ui-chrome
            aria-label={t("chordAddEmpty")}
            onClick={() => openAdd(i, 0)}
          >
            {t("addGlyph")}
          </button>
        )}
        {picker !== null && (
          <div className={styles.picker}>
            {picker.kind === "add" ? (
              <ChordPicker
                key={picker.seq}
                suggestions={(prefix) => suggestChords(song, prefix)}
                isValid={isValidChordText}
                isKnown={isKnownChord}
                onSubmit={(chord) => {
                  onEdit([
                    { type: "addChord", line: i, index: picker.index, chord },
                  ]);
                  closePicker(i);
                }}
                onClose={() => closePicker(i)}
              />
            ) : (
              <ChordPicker
                key={picker.seq}
                initial={picked?.chord}
                suggestions={(prefix) => suggestChords(song, prefix)}
                isValid={isValidChordText}
                isKnown={isKnownChord}
                onSubmit={(chord) => {
                  onEdit([
                    { type: "setChord", line: i, anchor: picker.anchor, chord },
                  ]);
                  closePicker(i);
                }}
                onRemove={() => {
                  onEdit([
                    { type: "removeChord", line: i, anchor: picker.anchor },
                  ]);
                  closePicker(i);
                }}
                onMove={onMove}
                onClose={() => closePicker(i)}
              />
            )}
          </div>
        )}
        {!phantom && (
          <RowButtons
            onEditText={() => startEdit(i, "text", lyric.length)}
            onAddBelow={() => {
              onEdit([{ type: "insertLine", at: i + 1 }]);
              editNext(i + 1, 0);
            }}
            onRemove={removeLine(i)}
          />
        )}
      </Row>
    );
  };

  const verbatimRow = (i: number, line: SongLine, removable: boolean) => (
    <Row key={keys[i]} index={i} kind={line.kind} onFocus={noteRow}>
      <pre
        className={styles.verbatim}
        data-testid="visual-verbatim"
        dir={line.kind === "tab" ? "ltr" : "auto"}
      >
        {sourceText(line)}
      </pre>
      <span className={styles.note} data-ui-chrome>
        {t("sourceOnly")}
      </span>
      {removable && <RowButtons onRemove={removeLine(i)} />}
    </Row>
  );

  const commentRow = (i: number, line: CommentLine) => (
    <Row key={keys[i]} index={i} kind="comment" onFocus={noteRow}>
      <CommentInput
        text={line.text}
        onCommit={(text) => onEdit([{ type: "setComment", line: i, text }])}
      />
      <RowButtons onRemove={removeLine(i)} />
    </Row>
  );

  const row = (line: SongLine, i: number) => {
    switch (line.kind) {
      case "meta":
        return null;
      case "lyric":
      case "empty":
        return textRow(i, line);
      case "chords": {
        const adding = ui.edit?.line === i ? ui.edit : null;
        const addLyrics = (draft: string) => {
          if (draft !== "")
            onEdit([{ type: "setLyric", line: i, text: draft }]);
          endEdit(i);
        };
        return (
          <Row key={keys[i]} index={i} kind="chords" onFocus={noteRow}>
            <ChordsInput
              chords={line.chords}
              onCommit={(chords) =>
                onEdit([{ type: "setChordsLine", line: i, chords }])
              }
            />
            {adding !== null && (
              <LyricInput
                key={adding.seq}
                initial=""
                onCommit={addLyrics}
                onEnter={addLyrics}
                onEscape={() => endEdit(i)}
              />
            )}
            <RowButtons
              onEditText={() => startEdit(i, "chords", 0)}
              onRemove={removeLine(i)}
            />
          </Row>
        );
      }
      case "comment":
        return commentRow(i, line);
      case "section": {
        if (line.edge === "end") {
          return spans.some((span) => span.end === i) ? (
            <Row
              key={keys[i]}
              index={i}
              kind="section-end"
              terminator
              onFocus={noteRow}
            />
          ) : (
            verbatimRow(i, line, false)
          );
        }
        const at = spans.findIndex((span) => span.start === i);
        const span = spans[at];
        if (span === undefined) return verbatimRow(i, line, false);
        return (
          <Row key={keys[i]} index={i} kind="section" onFocus={noteRow}>
            <SectionControls
              section={span.section}
              label={span.label}
              literal={span.literal}
              canMoveUp={at > 0}
              canMoveDown={at < spans.length - 1}
              onRename={(section, label) =>
                onEdit([{ type: "renameSection", line: i, section, label }])
              }
              onMove={(direction) =>
                onEdit([{ type: "moveSection", line: i, direction }])
              }
              onRemove={() => onEdit([{ type: "removeSection", line: i }])}
            />
          </Row>
        );
      }
      case "tab":
      case "raw":
      case "remark":
      case "directive":
        return verbatimRow(i, line, true);
      default: {
        const unreachable: never = line;
        return unreachable;
      }
    }
  };

  const hasContent = song.lines.some(
    (line) =>
      line.kind === "lyric" ||
      line.kind === "empty" ||
      line.kind === "chords" ||
      line.kind === "comment",
  );

  return (
    <div
      ref={rootRef}
      id={id}
      className={styles.root}
      data-testid="editor-visual"
      role="tabpanel"
      aria-label={t("visualLabel")}
      dir={song.direction ?? "auto"}
      data-overlap-pass={pass}
    >
      {!hasContent && (
        <p className={styles.hint} data-testid="visual-hint" data-ui-chrome>
          {t("visualHint")}
        </p>
      )}
      {song.lines.map(row)}
      {textRow(count, undefined)}
      <div className={styles.footer} data-ui-chrome>
        <select
          className={styles.kind}
          data-testid="add-section-kind"
          aria-label={t("sectionKind")}
          value={addKind}
          onChange={(e) => {
            const next = SECTION_KINDS.find((kind) => kind === e.target.value);
            if (next !== undefined) setAddKind(next);
          }}
        >
          {SECTION_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {t(KIND_LABEL_KEYS[kind])}
            </option>
          ))}
        </select>
        <button
          type="button"
          data-testid="add-section"
          onClick={() =>
            onEdit([
              {
                type: "addSection",
                at: ui.lastRow === null ? count : ui.lastRow + 1,
                section: addKind,
              },
            ])
          }
        >
          {t("addSection")}
        </button>
      </div>
    </div>
  );
}
