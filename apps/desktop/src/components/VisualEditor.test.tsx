import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { useState } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  applyEdits,
  parseSong,
  serializeSong,
  splitGraphemes,
} from "chord-core";
import type { EditOp, SongModel } from "chord-core";
import { loadLibrary } from "../library";
import { STRINGS } from "../strings";
import { i18n } from "../i18n";
import { VisualEditor } from "./VisualEditor";

const lineLabel = (n: number) => i18n.t("lineLabel", { n });

const here = (file: string): string =>
  readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");

function fixture(name: string): SongModel {
  const entry = loadLibrary().find((s) => s.id === `test-songs:${name}`);
  if (entry === undefined) throw new Error(`no fixture ${name}`);
  return entry.song;
}

const parsed = (text: string): SongModel => parseSong(text).song;
const edited = (song: SongModel, ops: readonly EditOp[]): SongModel =>
  applyEdits(song, ops).song;

/** Index of the first lyric line of the Hebrew fixtures (after the header). */
const FIRST = 4;
const HE = fixture("he_plain");
const NIQQUD = fixture("he_niqqud");
const MIXED = fixture("mixed_he_en");
const SECTIONS = fixture("sections_he");
const EN = parsed("{meta: direction ltr}\n[Am]hello [G]world\nsecond line\n");

function lyricAt(song: SongModel, i: number): string {
  const line = song.lines[i];
  if (line?.kind !== "lyric") throw new Error(`line ${i} is not a lyric`);
  return line.lyric;
}

type OnEdit = (ops: readonly EditOp[]) => void;

/** Renders with a song that never changes (every edit is "rejected"). */
function setup(song: SongModel) {
  const onEdit = vi.fn<OnEdit>();
  const view = render(<VisualEditor song={song} onEdit={onEdit} />);
  return { onEdit, ...view };
}

interface HarnessProps {
  initial: SongModel;
  onEdit: OnEdit;
  onSong(song: SongModel): void;
}

function Harness({ initial, onEdit, onSong }: HarnessProps) {
  const [song, setSong] = useState(initial);
  return (
    <VisualEditor
      song={song}
      onEdit={(ops) => {
        onEdit(ops);
        // chord-core returns the same object when nothing changes.
        const next = applyEdits(song, ops).song;
        onSong(next);
        setSong(next);
      }}
    />
  );
}

/** Renders controlled: every edit is applied with chord-core and fed back. */
function setupLive(song: SongModel) {
  const onEdit = vi.fn<OnEdit>();
  const live = { song };
  const view = render(
    <Harness
      initial={song}
      onEdit={onEdit}
      onSong={(next) => {
        live.song = next;
      }}
    />,
  );
  return { onEdit, live, ...view };
}

function find(root: ParentNode, selector: string): HTMLElement {
  const el = root.querySelector(selector);
  if (!(el instanceof HTMLElement)) throw new Error(`no ${selector}`);
  return el;
}

const rows = () => screen.getAllByTestId("visual-line");
const row = (i: number) =>
  find(document, `[data-testid="visual-line"][data-line-index="${i}"]`);
const wrapper = (i: number) => find(row(i), "[data-row-focus]");
const inRow = (i: number) => within(row(i));
const pos = (i: number, index: number) => find(row(i), `[data-pos="${index}"]`);
const chordButton = (i: number, anchor: number) =>
  find(row(i), `[data-chord-button][data-anchor-index="${anchor}"]`);
const asInput = (el: HTMLElement): HTMLInputElement => {
  if (!(el instanceof HTMLInputElement)) throw new Error("not an input");
  return el;
};
const lineInput = (i: number) => asInput(inRow(i).getByTestId("line-input"));
const chordInput = () => asInput(screen.getByTestId("chord-input"));
const picker = () => screen.queryByTestId("chord-picker");
const caretPos = (i: number) =>
  row(i).querySelector("[data-caret]")?.getAttribute("data-pos");

const focus = (el: HTMLElement) => act(() => el.focus());
const press = (el: HTMLElement, key: string) => fireEvent.keyDown(el, { key });
const type = (el: HTMLElement, value: string) =>
  fireEvent.change(el, { target: { value } });
const submitChord = (chord: string) => {
  type(chordInput(), chord);
  press(chordInput(), "Enter");
};
const caretTo = (input: HTMLInputElement, offset: number) =>
  input.setSelectionRange(offset, offset);
const startEdit = (i: number) => {
  fireEvent.click(inRow(i).getByTestId("line-edit-text"));
  return lineInput(i);
};

describe("VisualEditor structure", () => {
  it("is a labelled tabpanel that isolates the song direction", () => {
    const { rerender, onEdit } = setup(HE);
    const root = screen.getByTestId("editor-visual");
    expect(root).toHaveAttribute("role", "tabpanel");
    expect(root).toHaveAccessibleName(STRINGS.visualLabel);
    expect(root).toHaveAttribute("dir", "rtl");
    expect(root).not.toHaveAttribute("id");
    expect(Number(root.getAttribute("data-overlap-pass"))).toBeGreaterThan(0);
    rerender(
      <VisualEditor id="panel" song={parsed("plain\n")} onEdit={onEdit} />,
    );
    expect(root).toHaveAttribute("id", "panel");
    expect(root).toHaveAttribute("dir", "auto");
  });

  it("uses the song view fonts and bidi isolation on the root class", () => {
    const css = here("./VisualEditor.module.css");
    const rule = /\.root\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toContain(
      'font-family: "Noto Sans Hebrew", Heebo, sans-serif;',
    );
    expect(rule).toContain("unicode-bidi: isolate;");
    const songView = here(
      "../../../../packages/chord-render/src/SongView.module.css",
    );
    const song = /\.song\s*\{([^}]*)\}/.exec(songView)?.[1] ?? "";
    expect(song).toContain(
      'font-family: "Noto Sans Hebrew", Heebo, sans-serif;',
    );
    expect(song).toContain("unicode-bidi: isolate;");
  });

  it("emits only the documented test ids, as literals", () => {
    const source = here("./VisualEditor.tsx");
    const ids = [...source.matchAll(/data-testid="([^"]+)"/g)].map((m) => m[1]);
    expect([...new Set(ids)].sort()).toEqual(
      [
        "editor-visual",
        "visual-hint",
        "visual-line",
        "line-input",
        "line-edit-text",
        "line-add-below",
        "line-remove",
        "row-add-chord",
        "chords-input",
        "comment-input",
        "visual-verbatim",
        "add-section-kind",
        "add-section",
      ].sort(),
    );
    expect(source).not.toMatch(/data-testid=\{/);
    expect(source).not.toMatch(/applyEdits?\b/);
  });

  it("renders one row per line except meta lines, then the phantom row", () => {
    const { onEdit } = setup(HE);
    const kinds = HE.lines.map((l) => l.kind);
    expect(kinds.slice(0, 5)).toEqual([
      "remark",
      "meta",
      "meta",
      "empty",
      "lyric",
    ]);
    const expected = HE.lines
      .map((l, i) => ({ kind: l.kind, index: String(i) }))
      .filter((r) => r.kind !== "meta");
    expected.push({ kind: "empty", index: String(HE.lines.length) });
    expect(
      rows().map((r) => ({
        kind: r.getAttribute("data-kind"),
        index: r.getAttribute("data-line-index"),
      })),
    ).toEqual(expected);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("shows a lyric row as a focusable group around an editing ChordLine with secondary controls", () => {
    setup(HE);
    const line = wrapper(FIRST);
    expect(line).toHaveAttribute("tabindex", "0");
    expect(line).toHaveAttribute("role", "group");
    // Row 3 (empty) is line 1, the first lyric is line 2.
    expect(wrapper(3)).toHaveAccessibleName(lineLabel(1));
    expect(line).toHaveAccessibleName(lineLabel(2));
    expect(find(line, '[data-line="lyric"]')).toHaveAttribute(
      "data-editing",
      "",
    );
    expect(line.closest("[data-ui-chrome]")).toBeNull();
    const edit = inRow(FIRST).getByTestId("line-edit-text");
    const add = inRow(FIRST).getByTestId("line-add-below");
    const remove = inRow(FIRST).getByTestId("line-remove");
    expect(edit).toHaveTextContent(STRINGS.editGlyph);
    expect(edit).toHaveAccessibleName(STRINGS.editLyrics);
    expect(add).toHaveTextContent(STRINGS.addGlyph);
    expect(add).toHaveAccessibleName(STRINGS.addLineBelow);
    expect(remove).toHaveTextContent(STRINGS.removeGlyph);
    expect(remove).toHaveAccessibleName(STRINGS.removeLine);
    for (const button of [edit, add, remove]) {
      expect(button.closest("[data-ui-chrome]")).not.toBeNull();
      expect(line.contains(button)).toBe(false);
    }
    // The caret shows only on the focused row.
    expect(caretPos(FIRST)).toBeUndefined();
  });

  it("always ends with a phantom empty row that has no buttons", () => {
    setup(HE);
    const phantom = row(HE.lines.length);
    expect(phantom).toHaveAttribute("data-kind", "empty");
    expect(phantom).toHaveAttribute("data-phantom", "");
    expect(within(phantom).queryAllByRole("button")).toHaveLength(0);
    expect(row(FIRST)).not.toHaveAttribute("data-phantom");
    expect(rows().at(-1)).toBe(phantom);
  });

  it("shows the hint only while the song has no editable line", () => {
    const { rerender, onEdit } = setup({ lines: [] });
    const hint = screen.getByTestId("visual-hint");
    expect(hint).toHaveTextContent(STRINGS.visualHint);
    expect(hint).toHaveAttribute("data-ui-chrome");
    expect(rows()).toHaveLength(1);
    rerender(
      <VisualEditor song={parsed("{title: T}\n# note\n")} onEdit={onEdit} />,
    );
    expect(screen.getByTestId("visual-hint")).toBeInTheDocument();
    for (const text of ["words\n", "\n", "[Am] [G]\n", "{comment: c}\n"]) {
      rerender(<VisualEditor song={parsed(text)} onEdit={onEdit} />);
      expect(screen.queryByTestId("visual-hint"), text).toBeNull();
    }
  });

  it("renders sections as controls, their end lines as hidden terminators", () => {
    setup(SECTIONS);
    expect(SECTIONS.lines[7]).toMatchObject({ kind: "section", edge: "start" });
    expect(SECTIONS.lines[10]).toMatchObject({ kind: "section", edge: "end" });
    const first = row(7);
    expect(first).toHaveAttribute("data-kind", "section");
    expect(within(first).getByTestId("section-kind")).toHaveValue("verse");
    expect(within(first).getByTestId("section-label")).toHaveValue("בית 1");
    expect(within(first).getByTestId("section-up")).toBeDisabled();
    expect(within(first).getByTestId("section-down")).toBeEnabled();
    expect(within(row(12)).getByTestId("section-up")).toBeEnabled();
    expect(within(row(12)).getByTestId("section-down")).toBeEnabled();
    expect(within(row(20)).getByTestId("section-down")).toBeDisabled();
    const end = row(10);
    expect(end).toHaveAttribute("data-kind", "section-end");
    expect(end).toHaveAttribute("aria-hidden", "true");
    expect(end).toBeEmptyDOMElement();
  });

  it("renders chords and comment rows as chrome inputs", () => {
    setup(parsed("[Am] [G]\n{comment: hello}\n"));
    const chords = inRow(0).getByTestId("chords-input");
    expect(row(0)).toHaveAttribute("data-kind", "chords");
    expect(chords).toHaveValue("Am G");
    expect(chords).toHaveAttribute("dir", "ltr");
    expect(chords).toHaveAttribute("aria-label", STRINGS.chordsLineInput);
    expect(chords).toHaveAttribute("spellcheck", "false");
    expect(chords).toHaveAttribute("data-ui-chrome");
    expect(inRow(0).getByTestId("line-edit-text")).toBeInTheDocument();
    expect(inRow(0).getByTestId("line-remove")).toBeInTheDocument();
    expect(inRow(0).queryByTestId("line-add-below")).toBeNull();
    const comment = inRow(1).getByTestId("comment-input");
    expect(row(1)).toHaveAttribute("data-kind", "comment");
    expect(comment).toHaveValue("hello");
    expect(comment).toHaveAttribute("dir", "auto");
    expect(comment).toHaveAttribute("aria-label", STRINGS.commentInput);
    expect(comment).toHaveAttribute("data-ui-chrome");
    expect(inRow(1).getByTestId("line-remove")).toBeInTheDocument();
    expect(inRow(1).queryByTestId("line-edit-text")).toBeNull();
  });
});

describe("VisualEditor lossless display", () => {
  const VERBATIM = ["tab", "raw", "remark", "directive"];

  for (const name of ["tab_block", "unknown_directives", "malformed_input"]) {
    it(`${name}: shows tab, raw, remark and directive lines verbatim`, () => {
      const song = fixture(name);
      const source = serializeSong(song).split("\n");
      const { onEdit } = setup(song);
      let checked = 0;
      song.lines.forEach((line, i) => {
        if (!VERBATIM.includes(line.kind)) return;
        checked++;
        const pre = inRow(i).getByTestId("visual-verbatim");
        expect(pre.tagName).toBe("PRE");
        expect(pre.textContent, `line ${i}`).toBe(source[i]);
        expect(pre).toHaveAttribute(
          "dir",
          line.kind === "tab" ? "ltr" : "auto",
        );
        expect(row(i)).toHaveAttribute("data-kind", line.kind);
        expect(row(i)).toHaveTextContent(STRINGS.sourceOnly);
        expect(inRow(i).getByTestId("line-remove")).toBeInTheDocument();
        expect(inRow(i).queryByTestId("line-edit-text")).toBeNull();
      });
      expect(checked).toBeGreaterThan(0);
      expect(onEdit).not.toHaveBeenCalled();
    });
  }

  it("keeps the exact source text of the fixtures", () => {
    const texts = (name: string) => {
      const view = setup(fixture(name));
      const all = screen
        .getAllByTestId("visual-verbatim")
        .map((pre) => pre.textContent);
      view.unmount();
      return all;
    };
    const tab = texts("tab_block");
    expect(tab).toContain("e|--0--3--5--|");
    expect(tab).toContain("  G|-0--2--4--|");
    expect(tab).toContain("# open strings {start_of_verse}");
    expect(tab).toContain("{comment: not a comment}");
    expect(tab).toContain("| Am . . . | C . . . |");
    const unknown = texts("unknown_directives");
    expect(unknown).toContain("{new_page}");
    expect(unknown).toContain("{x_shir_gap: 4}");
    expect(unknown).toContain("{x_shir_note: בדיקה חוזרת}");
    const malformed = texts("malformed_input");
    expect(malformed).toContain("{title: unterminated");
    expect(malformed).toContain("[A unterminated chord");
    expect(malformed).toContain("[]empty chord");
  });

  it("shows section lines outside a well-formed span verbatim, without a remove button", () => {
    const song = fixture("malformed_input");
    setup(song);
    const stray = song.lines.findIndex(
      (l) => l.kind === "section" && l.edge === "end",
    );
    const open = song.lines.findIndex(
      (l) => l.kind === "section" && l.edge === "start",
    );
    expect(stray).toBeGreaterThan(-1);
    expect(open).toBeGreaterThan(stray);
    expect(inRow(stray).getByTestId("visual-verbatim")).toHaveTextContent(
      "{end_of_chorus}",
    );
    expect(inRow(open).getByTestId("visual-verbatim")).toHaveTextContent(
      "{start_of_verse}",
    );
    for (const i of [stray, open]) {
      expect(row(i)).toHaveAttribute("data-kind", "section");
      expect(row(i)).not.toHaveAttribute("aria-hidden");
      expect(inRow(i).queryByTestId("line-remove")).toBeNull();
      expect(inRow(i).queryByTestId("section-kind")).toBeNull();
    }
  });

  it("removes a verbatim line", () => {
    const song = fixture("unknown_directives");
    const { onEdit } = setup(song);
    const i = song.lines.findIndex((l) => l.kind === "directive");
    fireEvent.click(inRow(i).getByTestId("line-remove"));
    expect(onEdit.mock.calls).toEqual([[[{ type: "removeLine", line: i }]]]);
  });
});

describe("VisualEditor chords", () => {
  it("adds a chord at a clicked position of a Hebrew line (logical index)", () => {
    const { onEdit } = setup(HE);
    expect(picker()).toBeNull();
    fireEvent.click(pos(FIRST, 0));
    expect(row(FIRST).contains(picker())).toBe(true);
    expect(chordInput()).toHaveValue("");
    expect(chordInput()).toHaveFocus();
    expect(screen.queryByTestId("chord-remove")).toBeNull();
    expect(screen.queryByTestId("chord-move-left")).toBeNull();
    submitChord("Dm");
    expect(onEdit.mock.calls).toEqual([
      [[{ type: "addChord", line: FIRST, index: 0, chord: "Dm" }]],
    ]);
    expect(picker()).toBeNull();
    expect(wrapper(FIRST)).toHaveFocus();
  });

  it("adds a chord at the clicked index and at the end slot", () => {
    const { onEdit } = setup(HE);
    const count = splitGraphemes(lyricAt(HE, FIRST)).length;
    fireEvent.click(pos(FIRST, 7));
    submitChord("C");
    fireEvent.click(pos(FIRST, count));
    submitChord("D");
    expect(onEdit.mock.calls).toEqual([
      [[{ type: "addChord", line: FIRST, index: 7, chord: "C" }]],
      [[{ type: "addChord", line: FIRST, index: count, chord: "D" }]],
    ]);
  });

  it("offers the song's chords as suggestions and warns about unknown text", () => {
    const { onEdit } = setup(HE);
    fireEvent.click(pos(FIRST, 1));
    const options = screen
      .getAllByTestId("chord-option")
      .map((o) => o.textContent);
    expect(options).toEqual(expect.arrayContaining(["Am", "G", "F", "E"]));
    type(chordInput(), "xyz");
    expect(screen.getByTestId("chord-warning")).toHaveTextContent(
      STRINGS.chordUnknown,
    );
    type(chordInput(), "[");
    expect(screen.getByTestId("chord-apply")).toBeDisabled();
    press(chordInput(), "Enter");
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("changes a clicked chord", () => {
    const { onEdit } = setup(HE);
    fireEvent.click(chordButton(FIRST, 1));
    expect(chordInput()).toHaveValue("G");
    submitChord("G7");
    expect(onEdit.mock.calls).toEqual([
      [[{ type: "setChord", line: FIRST, anchor: 1, chord: "G7" }]],
    ]);
    expect(picker()).toBeNull();
  });

  it("removes a clicked chord and closes the picker", () => {
    const { onEdit } = setup(HE);
    fireEvent.click(chordButton(FIRST, 1));
    fireEvent.click(screen.getByTestId("chord-remove"));
    expect(onEdit.mock.calls).toEqual([
      [[{ type: "removeChord", line: FIRST, anchor: 1 }]],
    ]);
    expect(picker()).toBeNull();
    expect(wrapper(FIRST)).toHaveFocus();
  });

  it("closes the picker with Escape and with Close, focusing the row, without an edit", () => {
    const { onEdit } = setup(HE);
    fireEvent.click(pos(FIRST, 2));
    press(chordInput(), "Escape");
    expect(picker()).toBeNull();
    expect(wrapper(FIRST)).toHaveFocus();
    fireEvent.click(chordButton(FIRST, 0));
    fireEvent.click(screen.getByTestId("chord-close"));
    expect(picker()).toBeNull();
    expect(wrapper(FIRST)).toHaveFocus();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("keeps a single picker open", () => {
    setup(HE);
    fireEvent.click(pos(FIRST, 2));
    fireEvent.click(chordButton(FIRST + 1, 0));
    expect(screen.getAllByTestId("chord-picker")).toHaveLength(1);
    expect(row(FIRST + 1).contains(picker())).toBe(true);
    expect(chordInput()).toHaveValue("F");
  });

  it("moves a chord on a Hebrew line: left is the next index, right the previous", () => {
    const song = edited(HE, [
      { type: "addChord", line: FIRST, index: 3, chord: "C" },
    ]);
    const { onEdit } = setup(song);
    expect(song.lines[FIRST]).toMatchObject({
      chords: [{ index: 0 }, { index: 3, chord: "C" }, { index: 15 }],
    });
    fireEvent.click(chordButton(FIRST, 1));
    fireEvent.click(screen.getByTestId("chord-move-left"));
    fireEvent.click(screen.getByTestId("chord-move-right"));
    expect(onEdit.mock.calls).toEqual([
      [[{ type: "moveChord", line: FIRST, anchor: 1, index: 4 }]],
      [[{ type: "moveChord", line: FIRST, anchor: 1, index: 2 }]],
    ]);
    // The picker stays open on the chord.
    expect(chordInput()).toHaveValue("C");
  });

  it("moves a chord on an English line: left is the previous index, right the next", () => {
    const song = edited(EN, [
      { type: "addChord", line: 1, index: 3, chord: "C" },
    ]);
    const { onEdit } = setup(song);
    fireEvent.click(chordButton(1, 1));
    expect(chordInput()).toHaveValue("C");
    fireEvent.click(screen.getByTestId("chord-move-left"));
    fireEvent.click(screen.getByTestId("chord-move-right"));
    expect(onEdit.mock.calls).toEqual([
      [[{ type: "moveChord", line: 1, anchor: 1, index: 2 }]],
      [[{ type: "moveChord", line: 1, anchor: 1, index: 4 }]],
    ]);
  });

  it("does not send a move past either visual end", () => {
    const { onEdit } = setup(EN);
    // Am sits at index 0, the visual left end of an English line.
    fireEvent.click(chordButton(1, 0));
    fireEvent.click(screen.getByTestId("chord-move-left"));
    expect(onEdit).not.toHaveBeenCalled();
    // On the Hebrew line index 0 is the visual right end.
    const hebrew = setup(HE);
    fireEvent.click(chordButton(FIRST, 0));
    fireEvent.click(screen.getAllByTestId("chord-move-right").at(-1)!);
    expect(hebrew.onEdit).not.toHaveBeenCalled();
  });

  describe("mixed Hebrew and English line", () => {
    it("has the phrase at grapheme 11 and chords Am@0, G@11, F@21", () => {
      const graphemes = splitGraphemes(lyricAt(MIXED, FIRST));
      expect(graphemes).toHaveLength(33);
      expect(graphemes.slice(11, 24).join("")).toBe("rock and roll");
      expect(MIXED.lines[FIRST]).toMatchObject({
        chords: [
          { index: 0, chord: "Am" },
          { index: 11, chord: "G" },
          { index: 21, chord: "F" },
        ],
      });
    });

    it("inside the English phrase left is the previous index", () => {
      const { onEdit } = setup(MIXED);
      fireEvent.click(chordButton(FIRST, 2));
      expect(chordInput()).toHaveValue("F");
      fireEvent.click(screen.getByTestId("chord-move-left"));
      fireEvent.click(screen.getByTestId("chord-move-right"));
      expect(onEdit.mock.calls).toEqual([
        [[{ type: "moveChord", line: FIRST, anchor: 2, index: 20 }]],
        [[{ type: "moveChord", line: FIRST, anchor: 2, index: 22 }]],
      ]);
    });

    it("on a Hebrew letter of the same line left is the next index", () => {
      const song = edited(MIXED, [
        { type: "addChord", line: FIRST, index: 2, chord: "C" },
      ]);
      const { onEdit } = setup(song);
      fireEvent.click(chordButton(FIRST, 1));
      expect(chordInput()).toHaveValue("C");
      fireEvent.click(screen.getByTestId("chord-move-left"));
      fireEvent.click(screen.getByTestId("chord-move-right"));
      expect(onEdit.mock.calls).toEqual([
        [[{ type: "moveChord", line: FIRST, anchor: 1, index: 3 }]],
        [[{ type: "moveChord", line: FIRST, anchor: 1, index: 1 }]],
      ]);
    });

    it("at the phrase boundary left goes to the visual neighbour, not index 10", () => {
      const { onEdit } = setup(MIXED);
      fireEvent.click(chordButton(FIRST, 1));
      expect(chordInput()).toHaveValue("G");
      fireEvent.click(screen.getByTestId("chord-move-left"));
      expect(onEdit.mock.calls).toEqual([
        [[{ type: "moveChord", line: FIRST, anchor: 1, index: 24 }]],
      ]);
    });

    it("twelve presses of move right travel 12..23 and keep following the chord past another one", () => {
      const { onEdit, live } = setupLive(MIXED);
      fireEvent.click(chordButton(FIRST, 1));
      const moves = () =>
        onEdit.mock.calls.map(([ops]) => {
          const op = ops[0];
          if (ops.length !== 1 || op?.type !== "moveChord") {
            throw new Error("not a single moveChord");
          }
          return op;
        });
      for (let i = 0; i < 11; i++) {
        fireEvent.click(screen.getByTestId("chord-move-right"));
      }
      // G passed F at index 21: it is now the third anchor.
      expect(live.song.lines[FIRST]).toMatchObject({
        chords: [
          { index: 0, chord: "Am" },
          { index: 21, chord: "F" },
          { index: 22, chord: "G" },
        ],
      });
      expect(screen.getAllByTestId("chord-picker")).toHaveLength(1);
      expect(chordInput()).toHaveValue("G");
      fireEvent.click(screen.getByTestId("chord-move-right"));
      expect(moves().map((op) => op.index)).toEqual([
        12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
      ]);
      expect(moves().map((op) => op.anchor)).toEqual([
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2,
      ]);
      expect(live.song.lines[FIRST]).toMatchObject({
        chords: [
          { index: 0, chord: "Am" },
          { index: 21, chord: "F" },
          { index: 23, chord: "G" },
        ],
      });
      // Remove still acts on G.
      fireEvent.click(screen.getByTestId("chord-remove"));
      expect(onEdit.mock.calls.at(-1)).toEqual([
        [{ type: "removeChord", line: FIRST, anchor: 2 }],
      ]);
    });
  });
});

describe("VisualEditor lyric editing", () => {
  it("edits the lyrics in an auto-direction input and commits on blur", () => {
    const { onEdit } = setup(EN);
    const input = startEdit(1);
    expect(input).toHaveFocus();
    expect(input).toHaveValue("hello world");
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveAttribute("dir", "auto");
    expect(input).toHaveAttribute("aria-label", STRINGS.lyricsInput);
    expect(input).toHaveAttribute("spellcheck", "false");
    expect(input).toHaveAttribute("data-ui-chrome");
    expect(row(1).querySelector("[data-line]")).toBeNull();
    type(input, "hello there");
    expect(onEdit).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onEdit.mock.calls).toEqual([
      [[{ type: "setLyric", line: 1, text: "hello there" }]],
    ]);
    expect(inRow(1).queryByTestId("line-input")).toBeNull();
    expect(find(row(1), '[data-line="lyric"]')).toBeInTheDocument();
  });

  it("does not call onEdit when the draft is unchanged", () => {
    const { onEdit } = setup(EN);
    const input = startEdit(1);
    type(input, "changed");
    type(input, "hello world");
    fireEvent.blur(input);
    expect(inRow(1).queryByTestId("line-input")).toBeNull();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("Escape discards the draft and focuses the row", () => {
    const { onEdit } = setup(EN);
    const input = startEdit(1);
    type(input, "discard me");
    press(input, "Escape");
    expect(inRow(1).queryByTestId("line-input")).toBeNull();
    expect(wrapper(1)).toHaveFocus();
    expect(onEdit).not.toHaveBeenCalled();
    expect(startEdit(1)).toHaveValue("hello world");
  });

  it("enters lyric-edit mode by double click and, on an empty row, by a click", () => {
    setup(parsed("words\n\n"));
    fireEvent.doubleClick(pos(0, 2));
    expect(lineInput(0)).toHaveFocus();
    press(lineInput(0), "Escape");
    fireEvent.click(pos(1, 0));
    expect(lineInput(1)).toHaveFocus();
    expect(lineInput(1)).toHaveValue("");
    expect(picker()).toBeNull();
  });

  it("Enter at the end inserts a line below in one call", () => {
    const { onEdit } = setup(EN);
    const input = startEdit(1);
    expect(input.selectionStart).toBe("hello world".length);
    press(input, "Enter");
    expect(onEdit.mock.calls).toEqual([[[{ type: "insertLine", at: 2 }]]]);
  });

  it("Enter at the end of a changed draft sets the lyric, then inserts, in one call", () => {
    const { onEdit } = setup(EN);
    const input = startEdit(1);
    type(input, "hello you");
    caretTo(input, "hello you".length);
    press(input, "Enter");
    expect(onEdit.mock.calls).toEqual([
      [
        [
          { type: "setLyric", line: 1, text: "hello you" },
          { type: "insertLine", at: 2 },
        ],
      ],
    ]);
  });

  it("Enter in the middle splits the line at the caret in one call", () => {
    const { onEdit } = setup(EN);
    const input = startEdit(1);
    caretTo(input, 5);
    press(input, "Enter");
    expect(onEdit.mock.calls).toEqual([
      [[{ type: "splitLine", line: 1, index: 5 }]],
    ]);
  });

  it("Enter on a niqqud line splits at the grapheme index, not the code-unit offset", () => {
    const { onEdit } = setup(NIQQUD);
    const graphemes = splitGraphemes(lyricAt(NIQQUD, FIRST));
    const offset = graphemes.slice(0, 2).join("").length;
    expect(offset).toBe(4);
    const input = startEdit(FIRST);
    caretTo(input, offset);
    press(input, "Enter");
    expect(onEdit.mock.calls).toEqual([
      [[{ type: "splitLine", line: FIRST, index: 2 }]],
    ]);
  });

  it("Backspace at the start joins the line to the one above in one call", () => {
    const { onEdit, live } = setupLive(EN);
    const input = startEdit(2);
    caretTo(input, 0);
    expect(press(input, "Backspace")).toBe(false);
    expect(onEdit.mock.calls).toEqual([[[{ type: "joinLines", line: 1 }]]]);
    expect(lyricAt(live.song, 1)).toBe("hello worldsecond line");
    // Row 1 is edited with the caret where its text used to end.
    expect(lineInput(1)).toHaveFocus();
    expect(lineInput(1)).toHaveValue("hello worldsecond line");
    expect(lineInput(1).selectionStart).toBe("hello world".length);
    expect(lineInput(1).selectionEnd).toBe("hello world".length);
  });

  it("Backspace at the start of a changed draft sets the lyric first", () => {
    const { onEdit } = setup(EN);
    const input = startEdit(2);
    type(input, "new");
    caretTo(input, 0);
    press(input, "Backspace");
    expect(onEdit.mock.calls).toEqual([
      [
        [
          { type: "setLyric", line: 2, text: "new" },
          { type: "joinLines", line: 1 },
        ],
      ],
    ]);
  });

  it("Backspace is left alone away from the start, with a selection, on the first line and under a non-lyric row", () => {
    const { onEdit } = setup(parsed("one\n{comment: c}\ntwo\n"));
    let input = startEdit(2);
    caretTo(input, 0);
    expect(press(input, "Backspace")).toBe(true);
    press(input, "Escape");
    input = startEdit(0);
    caretTo(input, 0);
    expect(press(input, "Backspace")).toBe(true);
    caretTo(input, 1);
    expect(press(input, "Backspace")).toBe(true);
    input.setSelectionRange(0, 2);
    expect(press(input, "Backspace")).toBe(true);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("ArrowDown / ArrowUp commit and move lyric-edit mode to the next / previous text row", () => {
    const { onEdit, live } = setupLive(parsed("one\n{comment: c}\ntwo\n"));
    let input = startEdit(0);
    type(input, "uno");
    press(input, "ArrowDown");
    expect(onEdit.mock.calls).toEqual([
      [[{ type: "setLyric", line: 0, text: "uno" }]],
    ]);
    expect(lyricAt(live.song, 0)).toBe("uno");
    // The comment row is skipped.
    input = lineInput(2);
    expect(input).toHaveFocus();
    expect(screen.getAllByTestId("line-input")).toHaveLength(1);
    press(input, "ArrowUp");
    expect(lineInput(0)).toHaveFocus();
    expect(lineInput(0)).toHaveValue("uno");
    // Unchanged drafts move without an edit; the first row has no row above.
    press(lineInput(0), "ArrowUp");
    expect(lineInput(0)).toHaveFocus();
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("adds a line below and edits it", () => {
    const { onEdit, live } = setupLive(EN);
    fireEvent.click(inRow(1).getByTestId("line-add-below"));
    expect(onEdit.mock.calls).toEqual([[[{ type: "insertLine", at: 2 }]]]);
    expect(live.song.lines[2]).toEqual({ kind: "empty" });
    expect(lineInput(2)).toHaveFocus();
    expect(lineInput(2)).toHaveValue("");
  });

  it("removes a line", () => {
    const { onEdit } = setup(EN);
    fireEvent.click(inRow(2).getByTestId("line-remove"));
    expect(onEdit.mock.calls).toEqual([[[{ type: "removeLine", line: 2 }]]]);
  });

  it("typing in the phantom row sets the lyric of a new last line", () => {
    const { onEdit } = setup(EN);
    const last = EN.lines.length;
    fireEvent.click(wrapper(last));
    const input = lineInput(last);
    expect(input).toHaveFocus();
    type(input, "appended");
    fireEvent.blur(input);
    expect(onEdit.mock.calls).toEqual([
      [[{ type: "setLyric", line: last, text: "appended" }]],
    ]);
  });

  it("Backspace in the untouched phantom row moves to the line above without an edit", () => {
    const { onEdit } = setup(EN);
    const last = EN.lines.length;
    fireEvent.click(wrapper(last));
    press(lineInput(last), "Backspace");
    expect(lineInput(last - 1)).toHaveFocus();
    expect(lineInput(last - 1).selectionStart).toBe("second line".length);
    expect(onEdit).not.toHaveBeenCalled();
  });
});

describe("VisualEditor chords, comment and section rows", () => {
  const SONG = parsed("[Am] [G]\n{comment: hello}\nwords\n");

  it("commits a changed chords line on blur and on Enter", () => {
    const { onEdit } = setup(SONG);
    const input = inRow(0).getByTestId("chords-input");
    type(input, "Am  G   D7 ");
    fireEvent.blur(input);
    expect(onEdit.mock.calls).toEqual([
      [[{ type: "setChordsLine", line: 0, chords: ["Am", "G", "D7"] }]],
    ]);
    type(input, "C");
    press(input, "Enter");
    // The blur after Enter does not commit the same draft again.
    fireEvent.blur(input);
    expect(onEdit.mock.calls.slice(1)).toEqual([
      [[{ type: "setChordsLine", line: 0, chords: ["C"] }]],
    ]);
  });

  it("does not commit an unchanged or escaped chords line", () => {
    const { onEdit } = setup(SONG);
    const input = inRow(0).getByTestId("chords-input");
    fireEvent.blur(input);
    type(input, "Em");
    press(input, "Escape");
    expect(input).toHaveValue("Am G");
    fireEvent.blur(input);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("adds lyrics to a chords row with setLyric (blur and Enter)", () => {
    const { onEdit } = setup(SONG);
    fireEvent.click(inRow(0).getByTestId("line-edit-text"));
    let input = lineInput(0);
    expect(input).toHaveFocus();
    expect(input).toHaveValue("");
    expect(inRow(0).getByTestId("chords-input")).toBeInTheDocument();
    type(input, "new words");
    fireEvent.blur(input);
    expect(inRow(0).queryByTestId("line-input")).toBeNull();
    fireEvent.click(inRow(0).getByTestId("line-edit-text"));
    input = lineInput(0);
    type(input, "more");
    press(input, "Enter");
    expect(inRow(0).queryByTestId("line-input")).toBeNull();
    expect(onEdit.mock.calls).toEqual([
      [[{ type: "setLyric", line: 0, text: "new words" }]],
      [[{ type: "setLyric", line: 0, text: "more" }]],
    ]);
  });

  it("a chords row with lyrics becomes a lyric row with the chords at its start", () => {
    const { live } = setupLive(SONG);
    fireEvent.click(inRow(0).getByTestId("line-edit-text"));
    type(lineInput(0), "new words");
    fireEvent.blur(lineInput(0));
    expect(serializeSong(live.song).split("\n")[0]).toBe("[Am][G]new words");
    expect(row(0)).toHaveAttribute("data-kind", "lyric");
    expect(chordButton(0, 1)).toHaveTextContent("G");
  });

  it("adds nothing to a chords row for an empty or escaped draft", () => {
    const { onEdit } = setup(SONG);
    fireEvent.click(inRow(0).getByTestId("line-edit-text"));
    fireEvent.blur(lineInput(0));
    expect(inRow(0).queryByTestId("line-input")).toBeNull();
    fireEvent.click(inRow(0).getByTestId("line-edit-text"));
    press(lineInput(0), "Enter");
    expect(inRow(0).queryByTestId("line-input")).toBeNull();
    fireEvent.click(inRow(0).getByTestId("line-edit-text"));
    type(lineInput(0), "typed");
    press(lineInput(0), "Escape");
    expect(inRow(0).queryByTestId("line-input")).toBeNull();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("commits a changed comment and ignores an unchanged or escaped one", () => {
    const { onEdit } = setup(SONG);
    const input = inRow(1).getByTestId("comment-input");
    fireEvent.blur(input);
    type(input, "nope");
    press(input, "Escape");
    expect(input).toHaveValue("hello");
    fireEvent.blur(input);
    expect(onEdit).not.toHaveBeenCalled();
    type(input, "hello again");
    press(input, "Enter");
    expect(onEdit.mock.calls).toEqual([
      [[{ type: "setComment", line: 1, text: "hello again" }]],
    ]);
    fireEvent.click(inRow(1).getByTestId("line-remove"));
    expect(onEdit.mock.calls.at(-1)).toEqual([
      [{ type: "removeLine", line: 1 }],
    ]);
  });

  it("renames a section by type and by label", () => {
    const { onEdit } = setup(SECTIONS);
    type(inRow(12).getByTestId("section-kind"), "bridge");
    const label = inRow(7).getByTestId("section-label");
    type(label, "פתיחה");
    fireEvent.blur(label);
    expect(onEdit.mock.calls).toEqual([
      [[{ type: "renameSection", line: 12, section: "bridge", label: "" }]],
      [[{ type: "renameSection", line: 7, section: "verse", label: "פתיחה" }]],
    ]);
  });

  it("moves and removes a section", () => {
    const { onEdit } = setup(SECTIONS);
    fireEvent.click(inRow(12).getByTestId("section-down"));
    fireEvent.click(inRow(12).getByTestId("section-up"));
    fireEvent.click(inRow(20).getByTestId("section-remove"));
    expect(onEdit.mock.calls).toEqual([
      [[{ type: "moveSection", line: 12, direction: "down" }]],
      [[{ type: "moveSection", line: 12, direction: "up" }]],
      [[{ type: "removeSection", line: 20 }]],
    ]);
  });

  it("adds a section of the chosen type after the most recently focused row", () => {
    const { onEdit } = setup(SECTIONS);
    const footer = screen.getByTestId("add-section").parentElement;
    expect(footer).toHaveAttribute("data-ui-chrome");
    const kind = screen.getByTestId("add-section-kind");
    expect(kind).toHaveAccessibleName(STRINGS.sectionKind);
    expect(kind).toHaveValue("verse");
    expect(
      within(kind)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual([
      STRINGS.sectionVerse,
      STRINGS.sectionChorus,
      STRINGS.sectionBridge,
    ]);
    const add = screen.getByTestId("add-section");
    expect(add).toHaveTextContent(STRINGS.addSection);
    // No row was focused yet: at the end.
    fireEvent.click(add);
    focus(wrapper(8));
    type(kind, "chorus");
    fireEvent.click(add);
    // Focus inside a row of any kind counts.
    focus(inRow(17).getByTestId("comment-input"));
    type(kind, "bridge");
    fireEvent.click(add);
    expect(onEdit.mock.calls).toEqual([
      [[{ type: "addSection", at: SECTIONS.lines.length, section: "verse" }]],
      [[{ type: "addSection", at: 9, section: "chorus" }]],
      [[{ type: "addSection", at: 18, section: "bridge" }]],
    ]);
  });
});

describe("VisualEditor keyboard", () => {
  it("ArrowLeft on a focused Hebrew row moves the caret from 0 to 1", () => {
    const { onEdit } = setup(HE);
    focus(wrapper(FIRST));
    expect(caretPos(FIRST)).toBe("0");
    press(wrapper(FIRST), "ArrowLeft");
    expect(caretPos(FIRST)).toBe("1");
    press(wrapper(FIRST), "ArrowRight");
    press(wrapper(FIRST), "ArrowRight");
    // Index 0 is the visual right end.
    expect(caretPos(FIRST)).toBe("0");
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("the caret follows the visual order of a mixed line and Home / End jump", () => {
    setup(MIXED);
    const line = wrapper(FIRST);
    focus(line);
    for (let i = 0; i < 11; i++) press(line, "ArrowLeft");
    // Past the Hebrew: the visual neighbour is the last letter of "roll".
    expect(caretPos(FIRST)).toBe("23");
    press(line, "ArrowLeft");
    expect(caretPos(FIRST)).toBe("22");
    press(line, "End");
    expect(caretPos(FIRST)).toBe("33");
    press(line, "ArrowLeft");
    expect(caretPos(FIRST)).toBe("33");
    press(line, "Home");
    expect(caretPos(FIRST)).toBe("0");
  });

  it("ArrowRight moves forward on an English row; the caret shows only while focused", () => {
    setup(EN);
    focus(wrapper(1));
    press(wrapper(1), "ArrowRight");
    expect(caretPos(1)).toBe("1");
    expect(caretPos(2)).toBeUndefined();
    press(wrapper(1), "ArrowDown");
    expect(wrapper(2)).toHaveFocus();
    expect(caretPos(1)).toBeUndefined();
    expect(caretPos(2)).toBe("0");
    press(wrapper(2), "ArrowUp");
    expect(wrapper(1)).toHaveFocus();
    // Back on the row it starts at 0 again.
    expect(caretPos(1)).toBe("0");
  });

  it("adds a chord with the keyboard only", () => {
    const { onEdit } = setup(EN);
    focus(wrapper(1));
    press(wrapper(1), "ArrowRight");
    press(wrapper(1), "ArrowRight");
    press(wrapper(1), "Enter");
    expect(chordInput()).toHaveFocus();
    type(chordInput(), "Em");
    press(chordInput(), "Enter");
    expect(onEdit.mock.calls).toEqual([
      [[{ type: "addChord", line: 1, index: 2, chord: "Em" }]],
    ]);
    expect(wrapper(1)).toHaveFocus();
    // The caret is where the chord went.
    expect(caretPos(1)).toBe("2");
  });

  it("edits and splits a lyric with the keyboard only", () => {
    const { onEdit } = setup(EN);
    focus(wrapper(1));
    press(wrapper(1), "F2");
    const input = lineInput(1);
    expect(input).toHaveFocus();
    type(input, "hello big world");
    caretTo(input, 9);
    press(input, "Enter");
    expect(onEdit.mock.calls).toEqual([
      [
        [
          { type: "setLyric", line: 1, text: "hello big world" },
          { type: "splitLine", line: 1, index: 9 },
        ],
      ],
    ]);
  });

  it("removes the chord at the caret with Delete", () => {
    const { onEdit } = setup(EN);
    focus(wrapper(1));
    press(wrapper(1), "ArrowRight");
    // No chord at index 1.
    press(wrapper(1), "Delete");
    expect(onEdit).not.toHaveBeenCalled();
    press(wrapper(1), "Home");
    press(wrapper(1), "Delete");
    expect(onEdit.mock.calls).toEqual([
      [[{ type: "removeChord", line: 1, anchor: 0 }]],
    ]);
  });

  it("leaves the keys of a chord button inside the row alone", () => {
    const { onEdit } = setup(EN);
    focus(wrapper(1));
    const button = chordButton(1, 0);
    focus(button);
    press(button, "Enter");
    press(button, "Delete");
    press(button, "F2");
    expect(picker()).toBeNull();
    expect(inRow(1).queryByTestId("line-input")).toBeNull();
    expect(onEdit).not.toHaveBeenCalled();
  });
});

describe("VisualEditor controlled round trip and focus", () => {
  it("types a lyric in the phantom row of an empty song, moves on with Enter and adds a chord", () => {
    const { onEdit, live } = setupLive({ lines: [] });
    expect(screen.getByTestId("visual-hint")).toBeInTheDocument();
    fireEvent.click(wrapper(0));
    type(lineInput(0), "hello world");
    caretTo(lineInput(0), "hello world".length);
    press(lineInput(0), "Enter");
    expect(onEdit.mock.calls).toEqual([
      [
        [
          { type: "setLyric", line: 0, text: "hello world" },
          { type: "insertLine", at: 1 },
        ],
      ],
    ]);
    // Focus lands on the next row, in lyric-edit mode at its start.
    expect(lineInput(1)).toHaveFocus();
    expect(lineInput(1).selectionStart).toBe(0);
    expect(screen.getAllByTestId("line-input")).toHaveLength(1);
    expect(screen.queryByTestId("visual-hint")).toBeNull();
    press(lineInput(1), "Escape");

    fireEvent.click(pos(0, 6));
    submitChord("Am");
    expect(onEdit).toHaveBeenCalledTimes(2);
    expect(serializeSong(live.song)).toBe("hello [Am]world\n\n");
    const line = find(row(0), '[data-line="lyric"][data-editing]');
    expect(
      [...line.querySelectorAll("[data-pos]")]
        .map((el) => el.firstChild?.nodeValue ?? "")
        .join(""),
    ).toBe("hello world");
    expect(find(line, '[data-pos="6"] [data-chord-button]')).toHaveTextContent(
      "Am",
    );
    expect(row(0)).toHaveAttribute("data-kind", "lyric");
    expect(row(2)).toHaveAttribute("data-phantom", "");
  });

  it("Enter in the middle continues on the new row with the rest of the text", () => {
    const { live } = setupLive(EN);
    const input = startEdit(1);
    caretTo(input, 6);
    press(input, "Enter");
    expect(lyricAt(live.song, 1)).toBe("hello ");
    expect(lineInput(2)).toHaveFocus();
    expect(lineInput(2)).toHaveValue("world");
    expect(lineInput(2).selectionStart).toBe(0);
    expect(inRow(1).queryByTestId("line-input")).toBeNull();
  });

  it("drops the pending focus when the edit is rejected and the song stays the same", () => {
    const { onEdit, rerender } = setup(EN);
    const input = startEdit(1);
    press(input, "Enter");
    expect(onEdit).toHaveBeenCalledTimes(1);
    // The row stays as it is.
    expect(lineInput(1)).toBe(input);
    expect(screen.getAllByTestId("line-input")).toHaveLength(1);
    // A later, unrelated change of the song does not move editing to row 2.
    rerender(
      <VisualEditor
        song={edited(EN, [{ type: "setLyric", line: 2, text: "other" }])}
        onEdit={onEdit}
      />,
    );
    expect(screen.queryByTestId("line-input")).toBeNull();
  });

  it("re-validates the picker row when the song changes", () => {
    const { onEdit, rerender } = setup(EN);
    fireEvent.click(pos(2, 1));
    expect(row(2).contains(picker())).toBe(true);
    // The row is still a lyric line: the picker stays.
    rerender(
      <VisualEditor
        song={edited(EN, [{ type: "setLyric", line: 1, text: "x" }])}
        onEdit={onEdit}
      />,
    );
    expect(row(2).contains(picker())).toBe(true);
    // Row 2 is now a comment: the picker closes.
    rerender(
      <VisualEditor
        song={parsed("{meta: direction ltr}\nhello\n{comment: c}\n")}
        onEdit={onEdit}
      />,
    );
    expect(picker()).toBeNull();
    // Fewer rows than before: nothing points past the end.
    rerender(<VisualEditor song={{ lines: [] }} onEdit={onEdit} />);
    expect(rows()).toHaveLength(1);
    expect(onEdit).not.toHaveBeenCalled();
  });
});

describe("VisualEditor and changes from outside (song details, undo)", () => {
  const TWO = "Hello world\nSecond line\n";
  const show = (view: ReturnType<typeof setup>, text: string): SongModel => {
    const song = parsed(text);
    view.rerender(<VisualEditor song={song} onEdit={view.onEdit} />);
    return song;
  };

  it("keeps every row's DOM node when a title line is inserted above and removed again", () => {
    const view = setup(parsed("Hello world\n"));
    const before = rows();
    const line = wrapper(0);
    expect(before.map((r) => r.getAttribute("data-line-index"))).toEqual([
      "0",
      "1",
    ]);
    show(view, "{title: X}\nHello world\n");
    const after = rows();
    expect(after).toHaveLength(2);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(wrapper(1)).toBe(line);
    // The rows now carry the indices of their lines in the new song.
    expect(after.map((r) => r.getAttribute("data-line-index"))).toEqual([
      "1",
      "2",
    ]);
    show(view, "Hello world\n");
    expect(rows()[0]).toBe(before[0]);
    expect(wrapper(0)).toBe(line);
  });

  it("the click that follows a song-details commit lands on the same row", () => {
    const view = setup(parsed("Hello world\n\n"));
    const empty = wrapper(1);
    show(view, "{title: X}\nHello world\n\n");
    // The node under the pointer is still in the document and still the row.
    expect(empty.isConnected).toBe(true);
    fireEvent.click(empty);
    expect(lineInput(2)).toHaveFocus();
    expect(view.onEdit).not.toHaveBeenCalled();
  });

  it("an open add-chord picker stays on its line when an artist line is inserted above", () => {
    const view = setup(parsed(TWO));
    fireEvent.click(pos(1, 3));
    const input = chordInput();
    type(input, "E");
    show(view, `{artist: A}\n${TWO}`);
    // Same picker (its typed text is kept), now in the row of "Second line".
    expect(chordInput()).toBe(input);
    expect(input).toHaveValue("E");
    expect(row(2).contains(picker())).toBe(true);
    expect(row(1).contains(picker())).toBe(false);
    expect(row(2)).toHaveTextContent("Second line");
    submitChord("Em");
    expect(view.onEdit.mock.calls).toEqual([
      [[{ type: "addChord", line: 2, index: 3, chord: "Em" }]],
    ]);
  });

  it("the chord lands on the same lyric line in a controlled round trip", () => {
    const song = parsed(TWO);
    const next = parsed(`{artist: A}\n${TWO}`);
    const onEdit = vi.fn<OnEdit>();
    const { rerender } = render(<VisualEditor song={song} onEdit={onEdit} />);
    fireEvent.click(pos(1, 0));
    rerender(<VisualEditor song={next} onEdit={onEdit} />);
    submitChord("Em");
    const ops = onEdit.mock.calls[0]?.[0] ?? [];
    expect(serializeSong(edited(next, ops))).toBe(
      "{artist: A}\nHello world\n[Em]Second line\n",
    );
  });

  it("an open chord picker follows its chord when a line above is removed (undo)", () => {
    const view = setup(parsed(`{artist: A}\nHello [C]world\n[G]Second line\n`));
    fireEvent.click(chordButton(2, 0));
    expect(chordInput()).toHaveValue("G");
    // Undo of the step that added the artist line.
    show(view, "Hello [C]world\n[G]Second line\n");
    expect(row(1).contains(picker())).toBe(true);
    expect(chordInput()).toHaveValue("G");
    submitChord("G7");
    fireEvent.click(chordButton(1, 0));
    fireEvent.click(screen.getByTestId("chord-move-right"));
    fireEvent.click(screen.getByTestId("chord-remove"));
    expect(view.onEdit.mock.calls).toEqual([
      [[{ type: "setChord", line: 1, anchor: 0, chord: "G7" }]],
      [[{ type: "moveChord", line: 1, anchor: 0, index: 1 }]],
      [[{ type: "removeChord", line: 1, anchor: 0 }]],
    ]);
  });

  it("an open picker follows its line when undo removes or redo adds a lyric line above", () => {
    const view = setup(parsed("one\ntwo\nthree\n"));
    fireEvent.click(pos(2, 1));
    // Undo of an inserted line: "three" is now line 1.
    show(view, "one\nthree\n");
    expect(row(1).contains(picker())).toBe(true);
    // Redo: back on line 2; two more lines on top: line 4.
    show(view, "one\ntwo\nthree\n");
    expect(row(2).contains(picker())).toBe(true);
    show(view, "zero\n\none\ntwo\nthree\n");
    expect(row(4).contains(picker())).toBe(true);
    submitChord("D");
    expect(view.onEdit.mock.calls).toEqual([
      [[{ type: "addChord", line: 4, index: 1, chord: "D" }]],
    ]);
  });

  it("closes the picker when its own line is gone after an outside change", () => {
    const view = setup(parsed("one\ntwo\nthree\n"));
    fireEvent.click(pos(1, 1));
    show(view, "one\nthree\n");
    expect(picker()).toBeNull();
    expect(view.onEdit).not.toHaveBeenCalled();
  });

  it("Add section still lands after the last focused row when a line is inserted or removed above", () => {
    const view = setup(parsed(TWO));
    focus(wrapper(0));
    show(view, `{title: T}\n{artist: A}\n${TWO}`);
    fireEvent.click(screen.getByTestId("add-section"));
    show(view, `{artist: A}\n${TWO}`);
    fireEvent.click(screen.getByTestId("add-section"));
    expect(view.onEdit.mock.calls).toEqual([
      [[{ type: "addSection", at: 3, section: "verse" }]],
      [[{ type: "addSection", at: 2, section: "verse" }]],
    ]);
  });

  it("the focused row keeps its focus and caret position", () => {
    const view = setup(parsed(TWO));
    const line = wrapper(1);
    focus(line);
    press(line, "ArrowRight");
    press(line, "ArrowRight");
    expect(caretPos(1)).toBe("2");
    show(view, `{title: T}\n${TWO}`);
    expect(wrapper(2)).toBe(line);
    expect(line).toHaveFocus();
    expect(caretPos(2)).toBe("2");
    expect(caretPos(1)).toBeUndefined();
    press(line, "Enter");
    submitChord("Am");
    expect(view.onEdit.mock.calls).toEqual([
      [[{ type: "addChord", line: 2, index: 2, chord: "Am" }]],
    ]);
  });

  it("its own edits keep the pending focus when the song they produce arrives", () => {
    // Guard for the own/outside distinction: Enter still moves to the new row.
    const { live } = setupLive(parsed(`{title: T}\n${TWO}`));
    const input = startEdit(1);
    caretTo(input, 5);
    press(input, "Enter");
    expect(lyricAt(live.song, 2)).toBe(" world");
    expect(lineInput(2)).toHaveFocus();
  });

  it("a moved section keeps the picker on its line after undo", () => {
    const VERSE = "{start_of_verse}\none\n{end_of_verse}\n";
    const CHORUS = "{start_of_chorus}\ntwo\n{end_of_chorus}\n";
    // The chorus was moved up; the picker is opened on "one" (line 4).
    const view = setup(parsed(`${CHORUS}${VERSE}`));
    expect(row(4)).toHaveTextContent("one");
    fireEvent.click(pos(4, 1));
    expect(row(4).contains(picker())).toBe(true);
    // Toolbar Undo of the move: same line count, "one" is line 1 again.
    const undone = show(view, `${VERSE}${CHORUS}`);
    expect(undone.lines).toHaveLength(6);
    expect(row(1)).toHaveTextContent("one");
    expect(row(1).contains(picker())).toBe(true);
    expect(row(4).contains(picker())).toBe(false);
    expect(chordInput()).toHaveFocus();
    submitChord("Am");
    expect(view.onEdit.mock.calls).toEqual([
      [[{ type: "addChord", line: 1, index: 1, chord: "Am" }]],
    ]);
  });

  it("the caret and the last focused row follow their line through a same-count reorder", () => {
    const view = setup(parsed("one\ntwo\nthree\n"));
    const line = wrapper(0);
    focus(line);
    press(line, "ArrowRight");
    expect(caretPos(0)).toBe("1");
    show(view, "three\ntwo\none\n");
    expect(row(2)).toHaveTextContent("one");
    expect(caretPos(2)).toBe("1");
    expect(caretPos(0)).toBeUndefined();
    fireEvent.click(screen.getByTestId("add-section"));
    expect(view.onEdit.mock.calls).toEqual([
      [[{ type: "addSection", at: 3, section: "verse" }]],
    ]);
  });
});

describe("VisualEditor and its own edits that shift lines", () => {
  const FOUR = "one\ntwo\nthree\nfour\n";
  const VERSE = "{start_of_verse}\none\n{end_of_verse}\n";
  const CHORUS = "{start_of_chorus}\ntwo\n{end_of_chorus}\n";
  const text = (live: { song: SongModel }) => serializeSong(live.song);

  it("focus moves to the chords input after a chord is added to an empty row", () => {
    const { live } = setupLive(parsed("one\n\n"));
    expect(row(1)).toHaveAttribute("data-kind", "empty");
    focus(wrapper(1));
    press(wrapper(1), "Enter");
    expect(row(1).contains(picker())).toBe(true);
    submitChord("Am");
    expect(text(live)).toBe("one\n[Am]\n");
    expect(row(1)).toHaveAttribute("data-kind", "chords");
    expect(picker()).toBeNull();
    const chords = inRow(1).getByTestId("chords-input");
    expect(chords).toHaveValue("Am");
    expect(chords).toHaveFocus();
    expect(document.body).not.toHaveFocus();
  });

  it("focus moves to the chords input after a chord is added to the extra last row", () => {
    const { live } = setupLive(parsed("one\n"));
    expect(row(1)).toHaveAttribute("data-phantom", "");
    focus(wrapper(1));
    press(wrapper(1), "Enter");
    submitChord("G");
    expect(text(live)).toBe("one\n[G]\n");
    expect(row(1)).toHaveAttribute("data-kind", "chords");
    expect(inRow(1).getByTestId("chords-input")).toHaveFocus();
    expect(row(2)).toHaveAttribute("data-phantom", "");
  });

  it("an open picker stays on its line when another row is removed", () => {
    const { live } = setupLive(parsed(FOUR));
    fireEvent.click(pos(2, 0));
    expect(row(2)).toHaveTextContent("three");
    expect(row(2).contains(picker())).toBe(true);
    fireEvent.click(inRow(0).getByTestId("line-remove"));
    expect(text(live)).toBe("two\nthree\nfour\n");
    // The picker is now in the row of "three" (line 1), not on "four".
    expect(chordInput()).toHaveFocus();
    expect(row(1)).toHaveTextContent("three");
    expect(row(1).contains(picker())).toBe(true);
    expect(row(2).contains(picker())).toBe(false);
    submitChord("C");
    expect(text(live)).toBe("two\n[C]three\nfour\n");
  });

  it("an open picker stays on its line when a row below is removed", () => {
    const { live } = setupLive(parsed(FOUR));
    fireEvent.click(pos(1, 0));
    fireEvent.click(inRow(3).getByTestId("line-remove"));
    expect(row(1).contains(picker())).toBe(true);
    submitChord("C");
    expect(text(live)).toBe("one\n[C]two\nthree\n");
  });

  it("the picker closes when its own row is removed", () => {
    const { live, onEdit } = setupLive(parsed(FOUR));
    fireEvent.click(pos(2, 0));
    expect(row(2).contains(picker())).toBe(true);
    fireEvent.click(inRow(2).getByTestId("line-remove"));
    expect(text(live)).toBe("one\ntwo\nfour\n");
    expect(picker()).toBeNull();
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("an open picker stays on its line when a line is added above, and the new row is edited", () => {
    const { live } = setupLive(parsed(FOUR));
    fireEvent.click(pos(2, 0));
    fireEvent.click(inRow(0).getByTestId("line-add-below"));
    expect(text(live)).toBe("one\n\ntwo\nthree\nfour\n");
    // The pending focus is unchanged: the new row is in lyric-edit mode.
    expect(lineInput(1)).toHaveFocus();
    expect(row(3)).toHaveTextContent("three");
    expect(row(3).contains(picker())).toBe(true);
    submitChord("C");
    expect(text(live)).toBe("one\n\ntwo\n[C]three\nfour\n");
  });

  it("an open picker stays on its line when a section is added and removed", () => {
    const { live } = setupLive(parsed(`${VERSE}${CHORUS}last\n`));
    fireEvent.click(pos(6, 0));
    const onLast = (i: number) => {
      expect(row(i)).toHaveTextContent("last");
      expect(row(i).contains(picker())).toBe(true);
      expect(screen.getAllByTestId("chord-picker")).toHaveLength(1);
    };
    onLast(6);
    // Add section: no row was focused, so it lands at the end, after "last".
    const before = live.song.lines.length;
    fireEvent.click(screen.getByTestId("add-section"));
    expect(live.song.lines.length).toBeGreaterThan(before);
    expect(live.song.lines[7]).toMatchObject({ kind: "section" });
    onLast(6);
    // Remove the verse with its three lines: the chorus is first.
    fireEvent.click(inRow(0).getByTestId("section-remove"));
    expect(row(1)).toHaveTextContent("two");
    onLast(3);
    // Add section from the row of "two": it lands after the chorus.
    focus(wrapper(1));
    const count = live.song.lines.length;
    fireEvent.click(screen.getByTestId("add-section"));
    const added = live.song.lines.length - count;
    expect(added).toBeGreaterThan(0);
    expect(live.song.lines[3]).toMatchObject({ kind: "section" });
    onLast(3 + added);
    submitChord("C");
    expect(text(live)).toContain("\n[C]last\n");
  });

  it("an open picker follows its line when its section is moved", () => {
    const { live } = setupLive(parsed(`${VERSE}${CHORUS}`));
    fireEvent.click(pos(4, 0));
    expect(row(4)).toHaveTextContent("two");
    fireEvent.click(inRow(3).getByTestId("section-up"));
    expect(text(live)).toBe(`${CHORUS}${VERSE}`);
    expect(row(1)).toHaveTextContent("two");
    expect(row(1).contains(picker())).toBe(true);
    submitChord("C");
    expect(text(live)).toBe(
      "{start_of_chorus}\n[C]two\n{end_of_chorus}\n" + VERSE,
    );
  });

  it("the last focused row follows its line when a row above is removed", () => {
    const { live, onEdit } = setupLive(parsed(FOUR));
    focus(wrapper(2));
    fireEvent.click(inRow(0).getByTestId("line-remove"));
    expect(text(live)).toBe("two\nthree\nfour\n");
    fireEvent.click(screen.getByTestId("add-section"));
    // After "three", which is line 1 now.
    expect(onEdit.mock.calls.at(-1)).toEqual([
      [{ type: "addSection", at: 2, section: "verse" }],
    ]);
  });

  it("the caret follows its line through Enter-split and Backspace-join on another row", () => {
    const { live } = setupLive(parsed(FOUR));
    const line = wrapper(2);
    focus(line);
    press(line, "ArrowRight");
    press(line, "ArrowRight");
    expect(caretPos(2)).toBe("2");
    const input = startEdit(0);
    caretTo(input, 1);
    press(input, "Enter");
    expect(text(live)).toBe("o\nne\ntwo\nthree\nfour\n");
    // Pending focus unchanged: the new row, caret at its start.
    expect(lineInput(1)).toHaveFocus();
    expect(lineInput(1).selectionStart).toBe(0);
    fireEvent.blur(lineInput(1));
    // "three" is line 3 now and still has its caret position.
    focus(wrapper(3));
    expect(row(3)).toHaveTextContent("three");
    expect(caretPos(3)).toBe("2");
    const second = startEdit(1);
    caretTo(second, 0);
    press(second, "Backspace");
    expect(text(live)).toBe(FOUR);
    expect(lineInput(0)).toHaveFocus();
    expect(lineInput(0).selectionStart).toBe(1);
    fireEvent.blur(lineInput(0));
    // "three" is line 2 again.
    focus(wrapper(2));
    expect(caretPos(2)).toBe("2");
  });

  it("typing in the extra last row keeps the last focused row on the typed line", () => {
    const { live, onEdit } = setupLive(parsed("one\n"));
    focus(wrapper(1));
    fireEvent.click(wrapper(1));
    type(lineInput(1), "hello");
    fireEvent.blur(lineInput(1));
    expect(text(live)).toBe("one\nhello\n");
    fireEvent.click(screen.getByTestId("add-section"));
    expect(onEdit.mock.calls.at(-1)).toEqual([
      [{ type: "addSection", at: 2, section: "verse" }],
    ]);
  });
});

describe("VisualEditor overlap pass", () => {
  const passes = () =>
    Number(
      screen.getByTestId("editor-visual").getAttribute("data-overlap-pass"),
    );

  it("runs again when a row returns from lyric-edit mode without a song change", () => {
    const { onEdit } = setup(parsed("[Am]a[G]b\n"));
    const first = passes();
    expect(first).toBeGreaterThan(0);
    const input = startEdit(0);
    press(input, "Escape");
    // The ChordLine is a new element: it needs its overlap padding again.
    expect(find(row(0), '[data-line="lyric"]')).toBeInTheDocument();
    const afterEscape = passes();
    expect(afterEscape).toBeGreaterThan(first);
    fireEvent.blur(startEdit(0));
    expect(inRow(0).queryByTestId("line-input")).toBeNull();
    expect(passes()).toBeGreaterThan(afterEscape);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("does not run on a render that changes neither the song nor lyric-edit mode", () => {
    setup(parsed("[Am]a[G]b\n"));
    const first = passes();
    focus(wrapper(0));
    press(wrapper(0), "ArrowRight");
    expect(caretPos(0)).toBe("1");
    expect(passes()).toBe(first);
  });
});

describe("VisualEditor double click, empty rows and row identity", () => {
  const VERSE = "{start_of_verse}\none\n{end_of_verse}\n";
  const CHORUS = "{start_of_chorus}\ntwo\n{end_of_chorus}\n";

  it("a single click opens the picker at the clicked position", () => {
    const { onEdit } = setup(parsed("words\n"));
    fireEvent.click(pos(0, 2), { detail: 1 });
    expect(row(0).contains(picker())).toBe(true);
    submitChord("Am");
    expect(onEdit.mock.calls).toEqual([
      [[{ type: "addChord", line: 0, index: 2, chord: "Am" }]],
    ]);
  });

  it("a real double click (click, click, dblclick) leaves no picker and does not remount it", () => {
    const { onEdit } = setup(parsed("words\n"));
    fireEvent.click(pos(0, 2), { detail: 1 });
    const first = chordInput();
    // The second click neither reopens nor remounts the picker.
    fireEvent.click(pos(0, 2), { detail: 2 });
    expect(chordInput()).toBe(first);
    fireEvent.doubleClick(pos(0, 2), { detail: 2 });
    expect(picker()).toBeNull();
    expect(lineInput(0)).toHaveFocus();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("Enter on the untouched phantom row emits nothing and adds no line", () => {
    const { onEdit, live } = setupLive(EN);
    const last = EN.lines.length;
    const count = rows().length;
    fireEvent.click(wrapper(last));
    press(lineInput(last), "Enter");
    expect(onEdit).not.toHaveBeenCalled();
    expect(live.song.lines).toHaveLength(EN.lines.length);
    expect(rows()).toHaveLength(count);
  });

  it("Enter on the phantom row with typed text still adds the line and a new row", () => {
    const { live } = setupLive(EN);
    const last = EN.lines.length;
    fireEvent.click(wrapper(last));
    type(lineInput(last), "new");
    press(lineInput(last), "Enter");
    expect(lyricAt(live.song, last)).toBe("new");
    expect(live.song.lines).toHaveLength(last + 2);
  });

  it("an empty row has an add-chord button that opens the picker at 0", () => {
    const { onEdit } = setup(parsed("words\n\n"));
    const button = inRow(1).getByTestId("row-add-chord");
    expect(button).toHaveAccessibleName(STRINGS.chordAddEmpty);
    expect(button).toHaveAttribute("data-ui-chrome");
    // Neither a lyric row nor the extra last row has one.
    expect(inRow(0).queryByTestId("row-add-chord")).toBeNull();
    expect(inRow(2).queryByTestId("row-add-chord")).toBeNull();
    fireEvent.click(button);
    expect(row(1).contains(picker())).toBe(true);
    expect(screen.queryByTestId("line-input")).toBeNull();
    submitChord("Am");
    expect(onEdit.mock.calls).toEqual([
      [[{ type: "addChord", line: 1, index: 0, chord: "Am" }]],
    ]);
  });

  it("clicking elsewhere on an empty row still starts lyric editing", () => {
    setup(parsed("words\n\n"));
    fireEvent.click(wrapper(1));
    expect(lineInput(1)).toHaveFocus();
    expect(picker()).toBeNull();
    expect(inRow(1).queryByTestId("row-add-chord")).toBeNull();
  });

  it("the picker keeps its draft and focus when an own edit shifts its row", () => {
    const { live } = setupLive(parsed(`${VERSE}${CHORUS}`));
    fireEvent.click(pos(4, 0));
    const input = chordInput();
    type(input, "E");
    const up = inRow(3).getByTestId("section-up");
    focus(up);
    fireEvent.click(up);
    expect(serializeSong(live.song)).toBe(`${CHORUS}${VERSE}`);
    expect(row(1)).toHaveTextContent("two");
    expect(row(1).contains(picker())).toBe(true);
    // The same picker element, not a new one: draft kept, focus not stolen.
    expect(chordInput()).toBe(input);
    expect(input).toHaveValue("E");
    expect(up).toHaveFocus();
  });

  it("the picker keeps its draft and focus when a row above is removed", () => {
    setupLive(parsed("one\ntwo\nthree\n"));
    fireEvent.click(pos(2, 0));
    const input = chordInput();
    type(input, "G");
    const edit = inRow(1).getByTestId("line-edit-text");
    focus(edit);
    fireEvent.click(inRow(0).getByTestId("line-remove"));
    expect(chordInput()).toBe(input);
    expect(input).toHaveValue("G");
    expect(row(1)).toHaveTextContent("three");
    expect(row(1).contains(picker())).toBe(true);
    expect(edit).toHaveFocus();
  });

  it("the picker keeps its draft when an outside reorder or insertion shifts its row", () => {
    const onEdit = vi.fn<OnEdit>();
    const view = render(
      <VisualEditor song={parsed(`${VERSE}${CHORUS}`)} onEdit={onEdit} />,
    );
    fireEvent.click(pos(4, 0));
    const input = chordInput();
    type(input, "D");
    view.rerender(
      <VisualEditor song={parsed(`${CHORUS}${VERSE}`)} onEdit={onEdit} />,
    );
    expect(chordInput()).toBe(input);
    expect(input).toHaveValue("D");
    expect(row(1).contains(picker())).toBe(true);
    view.rerender(
      <VisualEditor
        song={parsed(`{title: T}\n${CHORUS}${VERSE}`)}
        onEdit={onEdit}
      />,
    );
    expect(chordInput()).toBe(input);
    expect(input).toHaveValue("D");
    expect(row(2).contains(picker())).toBe(true);
  });
});
