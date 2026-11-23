import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseSong,
  serializeSong,
  songChords,
  transposeSong,
} from "chord-core";
import { loadLibrary, songMeta } from "../library";
import { STRINGS } from "../strings";
import { Editor } from "./Editor";
import type { EditorProps } from "./Editor";

const HE_SHEET = "Am      G\nשלום עולם יפה";
const HE_MIRROR = "שלום [G]עולם י[Am]פה";
const HE_LOGICAL = "[Am]שלום עול[G]ם יפה";

function setup(props: Partial<EditorProps> = {}) {
  const onSave = vi.fn<EditorProps["onSave"]>(() => Promise.resolve());
  const onCancel = vi.fn();
  const onDirtyChange = vi.fn();
  render(
    <Editor
      initialText=""
      onSave={onSave}
      onCancel={onCancel}
      onDirtyChange={onDirtyChange}
      {...props}
    />,
  );
  return { onSave, onCancel, onDirtyChange };
}

const byId = (id: string) => screen.getByTestId(id);
const click = (id: string) => fireEvent.click(byId(id));
const showSource = () => click("editor-tab-source");
const showVisual = () => click("editor-tab-visual");

const input = () => screen.getByTestId("editor-input") as HTMLTextAreaElement;
const type = (value: string) =>
  fireEvent.change(input(), { target: { value } });

/** The editor text as the Source tab shows it; returns to the Visual tab. */
function textNow(): string {
  showSource();
  const value = input().value;
  showVisual();
  return value;
}

function row(i: number): HTMLElement {
  const el = document.querySelector(
    `[data-testid="visual-line"][data-line-index="${i}"]`,
  );
  if (!(el instanceof HTMLElement)) throw new Error(`no visual line ${i}`);
  return el;
}

const lyricRows = () =>
  screen
    .getAllByTestId("visual-line")
    .filter((el) => el.getAttribute("data-kind") === "lyric");

/** Opens the lyric input of line `i` (it keeps the focus). */
function openLyric(i: number): HTMLInputElement {
  fireEvent.click(within(row(i)).getByTestId("line-edit-text"));
  return within(row(i)).getByTestId<HTMLInputElement>("line-input");
}

/** A Visual edit: sets the lyric of line `i` and commits it by blur. */
function editLyric(i: number, value: string) {
  const el = openLyric(i);
  fireEvent.change(el, { target: { value } });
  fireEvent.blur(el);
}

/** A song-details edit of a text field, committed by blur. */
function setMeta(id: string, value: string) {
  const el = byId(id);
  fireEvent.change(el, { target: { value } });
  fireEvent.blur(el);
}

const savedText = (onSave: ReturnType<typeof setup>["onSave"]): string => {
  const call = onSave.mock.calls.at(-1);
  if (call === undefined) throw new Error("onSave was not called");
  return call[0];
};

function mockClipboard(readText: () => Promise<string>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { readText },
    configurable: true,
  });
}

async function paste(sheet: string) {
  mockClipboard(() => Promise.resolve(sheet));
  click("editor-paste");
  await waitFor(() => expect(byId("editor-undo")).toBeEnabled());
}

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("Editor", () => {
  it("has a labelled monospace-friendly textarea with dir=auto and no spellcheck", () => {
    setup();
    showSource();
    expect(input().tagName).toBe("TEXTAREA");
    expect(input()).toHaveAttribute("dir", "auto");
    expect(input()).toHaveAttribute("spellcheck", "false");
    expect(screen.getByLabelText(STRINGS.editorLabel)).toBe(input());
  });

  describe("preview debounce", () => {
    beforeEach(() => vi.useFakeTimers());

    it("updates the preview only after 300 ms", () => {
      setup({ initialText: "old" });
      showSource();
      const preview = screen.getByTestId("editor-preview");
      expect(preview.textContent).toContain("old");
      type("fresh");
      act(() => void vi.advanceTimersByTime(299));
      expect(preview.textContent).toContain("old");
      expect(preview.textContent).not.toContain("fresh");
      act(() => void vi.advanceTimersByTime(1));
      expect(preview.textContent).toContain("fresh");
      expect(preview.textContent).not.toContain("old");
    });

    it("restarts the timer on each keystroke", () => {
      setup({ initialText: "x" });
      showSource();
      type("one");
      act(() => void vi.advanceTimersByTime(200));
      type("two");
      act(() => void vi.advanceTimersByTime(200));
      expect(screen.getByTestId("editor-preview").textContent).not.toContain(
        "two",
      );
      act(() => void vi.advanceTimersByTime(100));
      expect(screen.getByTestId("editor-preview").textContent).toContain("two");
    });

    it("shows diagnostics of the previewed text", () => {
      setup({ initialText: "" });
      showSource();
      type("{capo: abc}\n[C]x");
      act(() => void vi.advanceTimersByTime(300));
      expect(screen.queryAllByTestId("diagnostic-item").length).toBeGreaterThan(
        0,
      );
    });
  });

  it("tracks dirty against the baseline", () => {
    const { onDirtyChange } = setup({ initialText: "abc" });
    showSource();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    type("abcd");
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    type("abc");
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("a baseline different from the initial text starts dirty", () => {
    const { onDirtyChange } = setup({ initialText: "abc", baseline: "" });
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  });

  it("Cancel calls onCancel", () => {
    const { onCancel } = setup();
    fireEvent.click(screen.getByTestId("editor-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  describe("Paste", () => {
    it("imports the clipboard and replaces the text", async () => {
      mockClipboard(() => Promise.resolve(HE_SHEET));
      const { onDirtyChange } = setup({ initialText: "old" });
      showSource();
      fireEvent.click(screen.getByTestId("editor-paste"));
      await waitFor(() => expect(input().value).toBe(HE_MIRROR));
      expect(onDirtyChange).toHaveBeenLastCalledWith(true);
      expect(screen.getByTestId("editor-flip")).toBeInTheDocument();
    });

    it("shows pasteFailed when the clipboard rejects", async () => {
      mockClipboard(() => Promise.reject(new Error("denied")));
      setup({ initialText: "keep" });
      showSource();
      fireEvent.click(screen.getByTestId("editor-paste"));
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toBe(STRINGS.pasteFailed);
      expect(input().value).toBe("keep");
    });

    it("shows pasteFailed when the clipboard API is missing", async () => {
      setup({ initialText: "keep" });
      expect(navigator.clipboard).toBeUndefined();
      fireEvent.click(screen.getByTestId("editor-paste"));
      expect((await screen.findByRole("alert")).textContent).toBe(
        STRINGS.pasteFailed,
      );
    });

    it("into an empty editor on the Visual tab shows the converted song as rows", async () => {
      setup();
      expect(lyricRows()).toHaveLength(0);
      await paste("Am      G\nhello big world\nsecond line");
      expect(byId("editor-visual")).toBeInTheDocument();
      expect(lyricRows()).toHaveLength(2);
      expect(
        [...row(0).querySelectorAll("[data-chord-button]")].map(
          (c) => c.textContent,
        ),
      ).toEqual(["Am", "G"]);
      expect(textNow()).toContain("[Am]hello");
    });
  });

  describe("Convert", () => {
    it("leaves ChordPro unchanged and says so", () => {
      setup({ initialText: "[C]hello [G]world" });
      showSource();
      fireEvent.click(screen.getByTestId("editor-convert"));
      expect(input().value).toBe("[C]hello [G]world");
      expect(screen.getByTestId("editor-status").textContent).toBe(
        STRINGS.alreadyChordPro,
      );
      expect(screen.queryByTestId("editor-flip")).toBeNull();
    });

    it("converts chords over lyrics, with warnings listed", () => {
      setup({ initialText: "Am      G\nshort" });
      showSource();
      fireEvent.click(screen.getByTestId("editor-convert"));
      expect(input().value).toBe("[Am]short[G]");
      expect(screen.getByTestId("editor-status").textContent).toBe("");
      const items = screen.getAllByTestId("import-warning");
      expect(items).toHaveLength(1);
      expect(items[0]!.textContent).toContain("1");
      expect(screen.getByTestId("import-warnings").textContent).toContain(
        STRINGS.importWarnings,
      );
    });

    it("shows Flip only when the import has RTL chords", () => {
      setup({ initialText: "Am      G\nhello big world" });
      showSource();
      fireEvent.click(screen.getByTestId("editor-convert"));
      expect(screen.queryByTestId("editor-flip")).toBeNull();
    });

    it("is absent on the Visual tab and present on the Source tab", () => {
      setup({ initialText: "[C]x" });
      expect(screen.queryByTestId("editor-convert")).toBeNull();
      showSource();
      expect(byId("editor-convert").textContent).toBe(STRINGS.convert);
      showVisual();
      expect(screen.queryByTestId("editor-convert")).toBeNull();
    });

    it("is one undo step", () => {
      setup({ initialText: "Am      G\nshort" });
      showSource();
      click("editor-convert");
      expect(input().value).toBe("[Am]short[G]");
      click("editor-undo");
      expect(input().value).toBe("Am      G\nshort");
      expect(byId("editor-undo")).toBeDisabled();
    });
  });

  describe("Flip alignment", () => {
    it("toggles between mirror and logical from the kept source, and typing hides it", () => {
      setup({ initialText: HE_SHEET });
      showSource();
      fireEvent.click(screen.getByTestId("editor-convert"));
      expect(input().value).toBe(HE_MIRROR);
      fireEvent.click(screen.getByTestId("editor-flip"));
      expect(input().value).toBe(HE_LOGICAL);
      fireEvent.click(screen.getByTestId("editor-flip"));
      expect(input().value).toBe(HE_MIRROR);
      type(`${input().value}!`);
      expect(screen.queryByTestId("editor-flip")).toBeNull();
    });

    it("a seeded queued file flips and re-applies the title fallback", () => {
      const source = HE_SHEET;
      setup({
        initialText: `{title: song}\n${HE_MIRROR}`,
        baseline: "",
        titlePath: "C:\\x\\song.txt",
        seed: {
          source,
          result: {
            chordpro: `{title: song}\n${HE_MIRROR}`,
            format: "chords-over-lyrics",
            warnings: [],
            hasRtlChords: true,
          },
        },
        fileName: "song.txt",
      });
      showSource();
      expect(screen.getByTestId("reviewing-file").textContent).toContain(
        "song.txt",
      );
      fireEvent.click(screen.getByTestId("editor-flip"));
      expect(input().value).toBe(`{title: song}\n${HE_LOGICAL}`);
    });

    it("a queued file opens on the Visual tab with its warnings listed and Flip available", () => {
      setup({
        initialText: `{title: song}\n${HE_MIRROR}`,
        baseline: "",
        titlePath: "/x/song.txt",
        seed: {
          source: HE_SHEET,
          result: {
            chordpro: `{title: song}\n${HE_MIRROR}`,
            format: "chords-over-lyrics",
            warnings: [
              { line: 7, code: "chord-past-end", message: "check this line" },
            ],
            hasRtlChords: true,
          },
        },
        fileName: "song.txt",
      });
      expect(byId("editor-tab-visual")).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(byId("editor-visual")).toBeInTheDocument();
      expect(screen.queryByTestId("editor-source")).toBeNull();
      const warnings = screen.getAllByTestId("import-warning");
      expect(warnings).toHaveLength(1);
      expect(warnings[0]!.textContent).toContain("check this line");
      expect(lyricRows()).toHaveLength(1);
      click("editor-flip");
      expect(textNow()).toBe(`{title: song}\n${HE_LOGICAL}`);
    });

    it("appears after an RTL paste on the Visual tab, re-imports with the other mode, and a Visual edit hides it", async () => {
      setup();
      expect(screen.queryByTestId("editor-flip")).toBeNull();
      await paste(HE_SHEET);
      expect(byId("editor-flip").textContent).toBe(STRINGS.flipAlignment);
      expect(textNow()).toBe(HE_MIRROR);
      click("editor-flip");
      expect(textNow()).toBe(HE_LOGICAL);
      expect(byId("editor-flip")).toBeInTheDocument();

      editLyric(0, "שלום עולם");
      const edited = textNow();
      expect(edited).not.toBe(HE_LOGICAL);
      expect(parseSong(edited).song.lines[0]).toMatchObject({
        kind: "lyric",
        lyric: "שלום עולם",
      });
      expect(screen.queryByTestId("editor-flip")).toBeNull();
    });

    it("a Visual action that changes nothing keeps it", async () => {
      setup();
      await paste(HE_SHEET);
      const before = textNow();
      const el = openLyric(0);
      fireEvent.blur(el);
      expect(textNow()).toBe(before);
      expect(byId("editor-flip")).toBeInTheDocument();
    });

    it.each([
      ["a song-details edit", () => setMeta("meta-title", "שיר")],
      ["Transpose", () => click("editor-transpose-up")],
      ["Undo", () => click("editor-undo")],
    ])("is hidden by %s", async (_name, action) => {
      setup();
      await paste(HE_SHEET);
      expect(byId("editor-flip")).toBeInTheDocument();
      action();
      expect(screen.queryByTestId("editor-flip")).toBeNull();
    });

    it("is hidden by Redo when the same sheet is pasted again after an undo", async () => {
      setup();
      await paste(HE_SHEET);
      editLyric(0, "שלום עולם");
      click("editor-undo");
      // The same result as the current text: no new entry, the redo stack survives.
      click("editor-paste");
      await screen.findByTestId("editor-flip");
      expect(byId("editor-redo")).toBeEnabled();
      click("editor-redo");
      expect(screen.queryByTestId("editor-flip")).toBeNull();
    });
  });

  describe("Save", () => {
    it("is disabled while pending and passes the text", async () => {
      let finish!: () => void;
      const onSave = vi.fn(
        () => new Promise<void>((resolve) => (finish = resolve)),
      );
      setup({ initialText: "[C]x", onSave });
      showSource();
      type("[C]y");
      const save = screen.getByTestId("editor-save");
      fireEvent.click(save);
      expect(onSave).toHaveBeenCalledExactlyOnceWith("[C]y");
      expect(save).toBeDisabled();
      await act(async () => finish());
      expect(save).toBeEnabled();
    });

    it("shows the error, stays dirty and re-enables Save on failure", async () => {
      const onSave = vi.fn(() => Promise.reject(new Error("disk full")));
      const { onDirtyChange } = setup({ initialText: "a", onSave });
      showSource();
      type("ab");
      fireEvent.click(screen.getByTestId("editor-save"));
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toBe(`${STRINGS.saveFailed}: disk full`);
      expect(screen.getByTestId("editor-save")).toBeEnabled();
      expect(onDirtyChange).toHaveBeenLastCalledWith(true);
      expect(input().value).toBe("ab");
    });

    it("without any edit saves the original text byte for byte", () => {
      // Not canonical: a short directive name, odd spacing, CRLF, no final newline.
      const raw = "{t:  My  Song }\r\n[C]hello   [G]world";
      expect(serializeSong(parseSong(raw).song)).not.toBe(raw);
      const { onSave, onDirtyChange } = setup({ initialText: raw });
      expect(byId("editor-visual")).toBeInTheDocument();
      click("editor-save");
      expect(onSave).toHaveBeenCalledExactlyOnceWith(raw);
      expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    });

    it("is still byte for byte after a visit to the Source tab and back", () => {
      // No CR here: a text area reports its value with LF line ends.
      const raw = "{t:  My  Song }\n[C]hello   [G]world";
      expect(serializeSong(parseSong(raw).song)).not.toBe(raw);
      const { onSave, onDirtyChange } = setup({ initialText: raw });
      showSource();
      expect(input().value).toBe(raw);
      showVisual();
      click("editor-save");
      expect(onSave).toHaveBeenCalledExactlyOnceWith(raw);
      expect(onDirtyChange).toHaveBeenLastCalledWith(false);
      expect(byId("editor-undo")).toBeDisabled();
    });

    it("while a lyric input has focus saves the typed text (blur, then click)", () => {
      const { onSave } = setup({ initialText: "hello\n" });
      const el = openLyric(0);
      expect(document.activeElement).toBe(el);
      fireEvent.change(el, { target: { value: "hello world" } });
      // What a mouse click on Save does: the input loses focus, then the click.
      fireEvent.blur(el);
      click("editor-save");
      expect(onSave).toHaveBeenCalledExactlyOnceWith("hello world\n");
    });
  });
});

describe("Editor tabs", () => {
  it("has a labelled chrome tab list with the Visual tab selected on mount", () => {
    setup({ initialText: "hello\n" });
    const list = screen.getByRole("tablist");
    expect(list).toHaveAccessibleName(STRINGS.editorTabs);
    expect(list).toHaveAttribute("data-ui-chrome");
    const tabs = within(list).getAllByRole("tab");
    expect(tabs.map((t) => t.getAttribute("data-testid"))).toEqual([
      "editor-tab-visual",
      "editor-tab-source",
    ]);
    expect(tabs.map((t) => t.textContent)).toEqual([
      STRINGS.tabVisual,
      STRINGS.tabSource,
    ]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveAttribute("aria-selected", "false");
    // Only the selected panel is rendered.
    const visual = byId("editor-visual");
    expect(visual).toHaveAttribute("role", "tabpanel");
    expect(tabs[0]).toHaveAttribute("aria-controls", visual.id);
    expect(visual.id).not.toBe("");
    expect(byId("meta-form")).toBeInTheDocument();
    expect(screen.queryByTestId("editor-source")).toBeNull();
    expect(screen.queryByTestId("editor-input")).toBeNull();
    expect(screen.queryByTestId("editor-preview")).toBeNull();
  });

  it("the Source tab shows only the source panel, named by its tab", () => {
    setup({ initialText: "hello\n" });
    showSource();
    expect(byId("editor-tab-source")).toHaveAttribute("aria-selected", "true");
    expect(byId("editor-tab-visual")).toHaveAttribute("aria-selected", "false");
    const source = byId("editor-source");
    expect(source).toHaveAttribute("role", "tabpanel");
    expect(source.tagName).toBe("DIV");
    expect(source).toHaveAccessibleName(STRINGS.tabSource);
    expect(byId("editor-tab-source")).toHaveAttribute(
      "aria-controls",
      source.id,
    );
    expect(source).toContainElement(input());
    expect(source).toContainElement(byId("editor-preview"));
    expect(byId("editor-preview")).toHaveAccessibleName(STRINGS.previewLabel);
    expect(screen.queryByTestId("editor-visual")).toBeNull();
    expect(screen.queryByTestId("meta-form")).toBeNull();
  });

  it("only the selected tab has aria-controls, and it names a rendered panel", () => {
    setup({ initialText: "hello\n" });
    const visual = byId("editor-tab-visual");
    const source = byId("editor-tab-source");
    const controlled = (tab: HTMLElement) =>
      document.getElementById(tab.getAttribute("aria-controls") ?? "");

    expect(visual).toHaveAttribute("aria-selected", "true");
    expect(controlled(visual)).toBe(byId("editor-visual"));
    expect(source).not.toHaveAttribute("aria-controls");

    showSource();
    expect(source).toHaveAttribute("aria-selected", "true");
    expect(controlled(source)).toBe(byId("editor-source"));
    expect(visual).not.toHaveAttribute("aria-controls");

    showVisual();
    expect(controlled(visual)).toBe(byId("editor-visual"));
    expect(source).not.toHaveAttribute("aria-controls");
  });

  it("is always Visual on mount: the choice is not persisted", () => {
    const first = render(
      <Editor initialText="a\n" onSave={vi.fn()} onCancel={vi.fn()} />,
    );
    showSource();
    first.unmount();
    setup({ initialText: "a\n" });
    expect(byId("editor-tab-visual")).toHaveAttribute("aria-selected", "true");
    expect(byId("editor-visual")).toBeInTheDocument();
  });

  it("ArrowRight and ArrowLeft on the tab list switch tabs and move the focus", () => {
    setup({ initialText: "hello\n" });
    const visual = byId("editor-tab-visual");
    const source = byId("editor-tab-source");
    act(() => visual.focus());
    fireEvent.keyDown(visual, { key: "ArrowRight" });
    expect(source).toHaveAttribute("aria-selected", "true");
    expect(byId("editor-source")).toBeInTheDocument();
    expect(document.activeElement).toBe(source);
    expect(source).toHaveAttribute("tabindex", "0");
    expect(visual).toHaveAttribute("tabindex", "-1");

    fireEvent.keyDown(source, { key: "ArrowLeft" });
    expect(visual).toHaveAttribute("aria-selected", "true");
    expect(byId("editor-visual")).toBeInTheDocument();
    expect(document.activeElement).toBe(visual);

    fireEvent.keyDown(visual, { key: "ArrowLeft" });
    expect(source).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(source, { key: "ArrowDown" });
    expect(source).toHaveAttribute("aria-selected", "true");
  });

  it("both tabs edit one text", () => {
    setup({ initialText: "hello\n" });
    editLyric(0, "hello there");
    showSource();
    expect(input().value).toBe("hello there\n");

    type("hello there\nfrom source\n");
    showVisual();
    const rows = lyricRows();
    expect(rows).toHaveLength(2);
    expect(rows[1]!.textContent).toContain("from source");
  });

  it("switching tabs keeps the text, the history and the dirty state", () => {
    const { onDirtyChange } = setup({ initialText: "hello\n" });
    editLyric(0, "changed");
    editLyric(0, "again");
    click("editor-undo");
    // One step to undo, one to redo, and the text differs from the baseline.
    const state = () => ({
      undo: !byId("editor-undo").hasAttribute("disabled"),
      redo: !byId("editor-redo").hasAttribute("disabled"),
      dirty: onDirtyChange.mock.lastCall?.[0],
    });
    const before = state();
    expect(before).toEqual({ undo: true, redo: true, dirty: true });

    showSource();
    expect(input().value).toBe("changed\n");
    expect(state()).toEqual(before);
    showVisual();
    expect(state()).toEqual(before);
    click("editor-redo");
    expect(textNow()).toBe("again\n");
    click("editor-undo");
    click("editor-undo");
    expect(textNow()).toBe("hello\n");
    expect(state()).toEqual({ undo: false, redo: true, dirty: false });
  });

  it("the Visual tab parses without debounce and shows the parse diagnostics", () => {
    vi.useFakeTimers();
    setup({ initialText: "" });
    expect(screen.queryByTestId("diagnostics")).toBeNull();
    showSource();
    type("{capo: abc}\n[C]x\n");
    showVisual();
    // No timer has run: the Visual tab shows the current text at once.
    expect(lyricRows()).toHaveLength(1);
    expect(screen.queryAllByTestId("diagnostic-item").length).toBeGreaterThan(
      0,
    );
  });

  it("the Source preview is current when the tab opens", () => {
    vi.useFakeTimers();
    setup({ initialText: "old\n" });
    editLyric(0, "fresh");
    showSource();
    expect(byId("editor-preview").textContent).toContain("fresh");
  });
});

describe("Editor toolbar", () => {
  const ids = () =>
    [...byId("editor-save").closest("[data-ui-chrome]")!.querySelectorAll("*")]
      .map((el) => el.getAttribute("data-testid"))
      .filter((id) => id !== null);

  it("is chrome and lists its controls in order, with STRINGS labels", async () => {
    setup();
    await paste(HE_SHEET);
    expect(ids()).toEqual([
      "editor-save",
      "editor-cancel",
      "editor-undo",
      "editor-redo",
      "editor-transpose-down",
      "editor-transpose-up",
      "editor-paste",
      "editor-flip",
    ]);
    showSource();
    expect(ids()).toEqual([
      "editor-save",
      "editor-cancel",
      "editor-undo",
      "editor-redo",
      "editor-transpose-down",
      "editor-transpose-up",
      "editor-paste",
      "editor-convert",
      "editor-flip",
    ]);
    expect(byId("editor-undo").textContent).toBe(STRINGS.undo);
    expect(byId("editor-redo").textContent).toBe(STRINGS.redo);
    const down = byId("editor-transpose-down");
    const up = byId("editor-transpose-up");
    expect(down.textContent).toBe(STRINGS.transposeDownGlyph);
    expect(down).toHaveAccessibleName(STRINGS.transposeSongDown);
    expect(up.textContent).toBe(STRINGS.transposeUpGlyph);
    expect(up).toHaveAccessibleName(STRINGS.transposeSongUp);
    expect(screen.getByRole("group", { name: STRINGS.transpose })).toBe(
      down.parentElement,
    );
  });

  it("Undo and Redo are disabled when there is nothing to undo or redo", () => {
    setup({ initialText: "hello\n" });
    expect(byId("editor-undo")).toBeDisabled();
    expect(byId("editor-redo")).toBeDisabled();
    editLyric(0, "bye");
    expect(byId("editor-undo")).toBeEnabled();
    expect(byId("editor-redo")).toBeDisabled();
    click("editor-undo");
    expect(byId("editor-undo")).toBeDisabled();
    expect(byId("editor-redo")).toBeEnabled();
  });
});

describe("Editor song details", () => {
  it("shows the first non-empty value of each directive, trimmed", () => {
    setup({
      initialText:
        "{title: }\n{title:   Real  }\n{title: Second}\n{artist: Me}\n{key: Am}\n{capo: 2}\n{tempo: 90}\nla\n",
    });
    expect(byId("meta-title")).toHaveValue("Real");
    expect(byId("meta-artist")).toHaveValue("Me");
    expect(byId("meta-key")).toHaveValue("Am");
    expect(byId("meta-capo")).toHaveValue("2");
    expect(byId("meta-tempo")).toHaveValue("90");
  });

  it("is empty for a song without those directives", () => {
    setup({ initialText: "la\n" });
    for (const id of ["meta-title", "meta-artist", "meta-key", "meta-tempo"])
      expect(byId(id)).toHaveValue("");
    expect(byId("meta-capo")).toHaveValue("0");
  });

  it("writes the five directives of a new song, and clearing the artist removes its line", async () => {
    const { onSave } = setup();
    setMeta("meta-title", "My Song");
    setMeta("meta-artist", "Some Band");
    setMeta("meta-key", "Em");
    fireEvent.change(byId("meta-capo"), { target: { value: "3" } });
    setMeta("meta-tempo", "120");
    click("editor-save");

    const first = savedText(onSave);
    const song = parseSong(first).song;
    expect({
      title: songMeta(song, "title"),
      artist: songMeta(song, "artist"),
      key: songMeta(song, "key"),
      capo: songMeta(song, "capo"),
      tempo: songMeta(song, "tempo"),
    }).toEqual({
      title: "My Song",
      artist: "Some Band",
      key: "Em",
      capo: "3",
      tempo: "120",
    });
    expect(song.title).toBe("My Song");
    expect(song.capo).toBe(3);
    expect(first).toMatch(/\{artist:/);

    await waitFor(() => expect(byId("editor-save")).toBeEnabled());
    setMeta("meta-artist", "");
    click("editor-save");
    expect(onSave).toHaveBeenCalledTimes(2);
    const second = savedText(onSave);
    expect(second).not.toMatch(/\{artist\b/);
    expect(songMeta(parseSong(second).song, "artist")).toBeUndefined();
    expect(songMeta(parseSong(second).song, "title")).toBe("My Song");
  });

  it("an edit that changes nothing records no undo step", () => {
    const { onDirtyChange } = setup({
      initialText: "{title: Song}\n[Am] [G]\nla\n",
    });
    const chords = byId("chords-input");
    expect(chords).toHaveValue("Am G");
    // Whitespace only: the visual editor reports the same chords again.
    fireEvent.change(chords, { target: { value: " Am   G " } });
    fireEvent.blur(chords);
    setMeta("meta-title", "  Song  ");
    expect(byId("editor-undo")).toBeDisabled();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    expect(textNow()).toBe("{title: Song}\n[Am] [G]\nla\n");
  });
});

describe("Editor undo and redo", () => {
  /** One click undoes `action`, one click restores it. */
  function expectOneStep(start: string, action: () => void) {
    action();
    const after = textNow();
    expect(after).not.toBe(start);
    click("editor-undo");
    expect(textNow()).toBe(start);
    expect(byId("editor-undo")).toBeDisabled();
    click("editor-redo");
    expect(textNow()).toBe(after);
    expect(byId("editor-redo")).toBeDisabled();
  }

  const START = "{title: Song}\n{key: G}\n[G]one [C]two\n";

  it("a Visual edit is one step", () => {
    setup({ initialText: START });
    expectOneStep(START, () => editLyric(2, "one two three"));
  });

  it("a multi-op Visual action (Enter splits the line) is one step", () => {
    setup({ initialText: "one two\n" });
    const el = openLyric(0);
    fireEvent.change(el, { target: { value: "one twox" } });
    el.setSelectionRange(3, 3);
    fireEvent.keyDown(el, { key: "Enter" });
    const after = parseSong(textNow()).song.lines;
    expect(after.filter((l) => l.kind === "lyric")).toHaveLength(2);
    click("editor-undo");
    expect(textNow()).toBe("one two\n");
    expect(byId("editor-undo")).toBeDisabled();
  });

  it("a song-details edit is one step", () => {
    setup({ initialText: START });
    expectOneStep(START, () => setMeta("meta-artist", "Band"));
  });

  it("a transpose is one step", () => {
    setup({ initialText: START });
    expectOneStep(START, () => click("editor-transpose-down"));
  });

  it("a paste is one step", async () => {
    setup({ initialText: START });
    mockClipboard(() => Promise.resolve("Am      G\nhello big world"));
    click("editor-paste");
    await waitFor(() => expect(byId("editor-undo")).toBeEnabled());
    const after = textNow();
    expect(after).toContain("[Am]hello");
    click("editor-undo");
    expect(textNow()).toBe(START);
    click("editor-redo");
    expect(textNow()).toBe(after);
  });

  it("undo to the first entry clears dirty", () => {
    const { onDirtyChange } = setup({ initialText: START });
    editLyric(2, "x");
    setMeta("meta-artist", "Band");
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    click("editor-undo");
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    click("editor-undo");
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    expect(byId("editor-undo")).toBeDisabled();
  });

  describe("typing in Source", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    });

    it("fast typing is undone as one step", () => {
      setup({ initialText: "start" });
      showSource();
      type("start a");
      act(() => void vi.advanceTimersByTime(100));
      type("start ab");
      act(() => void vi.advanceTimersByTime(499));
      type("start abc");
      click("editor-undo");
      expect(input().value).toBe("start");
      expect(byId("editor-undo")).toBeDisabled();
      click("editor-redo");
      expect(input().value).toBe("start abc");
    });

    it("a pause of 500 ms starts a new step", () => {
      setup({ initialText: "start" });
      showSource();
      type("start a");
      act(() => void vi.advanceTimersByTime(500));
      type("start ab");
      click("editor-undo");
      expect(input().value).toBe("start a");
      click("editor-undo");
      expect(input().value).toBe("start");
    });

    it("typing right after a Visual edit does not join that edit", () => {
      setup({ initialText: "start\n" });
      editLyric(0, "visual");
      showSource();
      type("visual!\n");
      click("editor-undo");
      expect(input().value).toBe("visual\n");
      click("editor-undo");
      expect(input().value).toBe("start\n");
    });
  });

  describe("keyboard", () => {
    /** Fires the key; true when the default action was prevented. */
    const key = (el: Element, init: KeyboardEventInit) =>
      !fireEvent.keyDown(el, init);

    function twoSteps() {
      setup({ initialText: "start" });
      showSource();
      type("one");
      click("editor-undo");
      type("two");
      // history: start -> two
    }

    it("Ctrl+Z in the text area undoes and Ctrl+Shift+Z redoes", () => {
      twoSteps();
      expect(key(input(), { key: "z", ctrlKey: true })).toBe(true);
      expect(input().value).toBe("start");
      expect(key(input(), { key: "Z", ctrlKey: true, shiftKey: true })).toBe(
        true,
      );
      expect(input().value).toBe("two");
    });

    it("Cmd+Z undoes, Cmd+Shift+Z and Ctrl+Y redo", () => {
      twoSteps();
      expect(key(input(), { key: "z", metaKey: true })).toBe(true);
      expect(input().value).toBe("start");
      expect(key(input(), { key: "z", metaKey: true, shiftKey: true })).toBe(
        true,
      );
      expect(input().value).toBe("two");
      click("editor-undo");
      expect(key(input(), { key: "y", ctrlKey: true })).toBe(true);
      expect(input().value).toBe("two");
    });

    it("Ctrl+Shift+Y does not redo", () => {
      twoSteps();
      click("editor-undo");
      // Precondition: there is a step to redo.
      expect(input().value).toBe("start");
      expect(byId("editor-redo")).toBeEnabled();
      expect(key(input(), { key: "Y", ctrlKey: true, shiftKey: true })).toBe(
        false,
      );
      expect(key(input(), { key: "y", ctrlKey: true, shiftKey: true })).toBe(
        false,
      );
      expect(input().value).toBe("start");
      expect(byId("editor-redo")).toBeEnabled();
      // Ctrl+Y without Shift still redoes.
      expect(key(input(), { key: "y", ctrlKey: true })).toBe(true);
      expect(input().value).toBe("two");
    });

    it("prevents the native undo even with nothing to undo, and ignores other keys", () => {
      setup({ initialText: "start" });
      showSource();
      expect(key(input(), { key: "z", ctrlKey: true })).toBe(true);
      expect(input().value).toBe("start");
      type("one");
      expect(key(input(), { key: "z" })).toBe(false);
      expect(key(input(), { key: "s", ctrlKey: true })).toBe(false);
      expect(key(input(), { key: "z", ctrlKey: true, altKey: true })).toBe(
        false,
      );
      expect(input().value).toBe("one");
    });

    it("applies everywhere else in the editor (a visual row, a button)", () => {
      setup({ initialText: "hello\n" });
      editLyric(0, "bye");
      const wrapper = row(0).querySelector("[data-row-focus]")!;
      expect(key(wrapper, { key: "z", ctrlKey: true })).toBe(true);
      expect(textNow()).toBe("hello\n");
      expect(key(byId("editor-save"), { key: "y", ctrlKey: true })).toBe(true);
      expect(textNow()).toBe("bye\n");
    });

    it("Ctrl+Z inside line-input keeps the native undo and the history", () => {
      setup({ initialText: "hello\n" });
      editLyric(0, "bye");
      const el = openLyric(0);
      fireEvent.change(el, { target: { value: "bye draft" } });
      expect(el.tagName).toBe("INPUT");
      expect(key(el, { key: "z", ctrlKey: true })).toBe(false);
      expect(key(el, { key: "z", metaKey: true })).toBe(false);
      expect(key(el, { key: "y", ctrlKey: true })).toBe(false);
      // The history did not move: Undo is still possible, Redo is not, and
      // the draft is still being edited.
      expect(byId("editor-undo")).toBeEnabled();
      expect(byId("editor-redo")).toBeDisabled();
      expect(within(row(0)).getByTestId("line-input")).toHaveValue("bye draft");
      fireEvent.blur(el);
      expect(textNow()).toBe("bye draft\n");
    });

    it("a shortcut inside a song-details field or the chord picker input does nothing else", () => {
      setup({ initialText: "{title: Song}\nhello\n" });
      editLyric(1, "bye");
      const before = textNow();

      const title = byId("meta-title");
      fireEvent.change(title, { target: { value: "Draft" } });
      expect(key(title, { key: "z", ctrlKey: true })).toBe(false);
      expect(key(title, { key: "z", ctrlKey: true, shiftKey: true })).toBe(
        false,
      );
      expect(title).toHaveValue("Draft");
      expect(byId("editor-redo")).toBeDisabled();
      fireEvent.keyDown(title, { key: "Escape" });
      expect(title).toHaveValue("Song");

      fireEvent.click(row(1).querySelector('[data-pos="0"]')!);
      const chord = byId("chord-input");
      fireEvent.change(chord, { target: { value: "Am" } });
      expect(key(chord, { key: "z", ctrlKey: true })).toBe(false);
      expect(byId("chord-picker")).toBeInTheDocument();
      expect(chord).toHaveValue("Am");
      expect(byId("editor-undo")).toBeEnabled();
      expect(byId("editor-redo")).toBeDisabled();
      fireEvent.keyDown(chord, { key: "Escape" });
      expect(textNow()).toBe(before);
    });
  });
});

describe("Editor transpose", () => {
  it("is permanent: Save receives the transposed chords and key", () => {
    const text = "{title: Song}\n{key: G}\n[G]one [C]two [D]three\n";
    const { onSave, onDirtyChange } = setup({ initialText: text });
    click("editor-transpose-up");
    click("editor-save");

    const saved = savedText(onSave);
    const expected = serializeSong(transposeSong(parseSong(text).song, 1).song);
    expect(expected).not.toBe(text);
    expect(saved).toBe(expected);
    const song = parseSong(saved).song;
    const chords = songChords(song);
    expect(chords).toHaveLength(3);
    expect(chords[0]).toMatch(/^(G#|Ab)$/);
    expect(chords[1]).toMatch(/^(C#|Db)$/);
    expect(chords[2]).toMatch(/^(D#|Eb)$/);
    expect(songMeta(song, "key")).toMatch(/^(G#|Ab)$/);
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  });

  it("down then up are two steps that return to the same chords", () => {
    const text = "{key: G}\n[G]one [C]two\n";
    setup({ initialText: text });
    click("editor-transpose-down");
    expect(textNow()).toBe(
      serializeSong(transposeSong(parseSong(text).song, -1).song),
    );
    click("editor-transpose-up");
    expect(songChords(parseSong(textNow()).song)).toEqual(["G", "C"]);
    click("editor-undo");
    click("editor-undo");
    expect(textNow()).toBe(text);
    expect(byId("editor-undo")).toBeDisabled();
  });

  it("works from the Source tab on the current text", () => {
    setup({ initialText: "" });
    showSource();
    type("[C]x");
    click("editor-transpose-up");
    expect(songChords(parseSong(input().value).song)).toEqual(["C#"]);
  });

  it("a song without chords or key is left as it is", () => {
    const raw = "just   words";
    const { onDirtyChange } = setup({ initialText: raw });
    click("editor-transpose-up");
    expect(textNow()).toBe(raw);
    expect(byId("editor-undo")).toBeDisabled();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });
});

describe("Editor Hebrew flow", () => {
  function fixtureText(name: string): string {
    const entry = loadLibrary().find((s) => s.id === `test-songs:${name}`);
    if (entry === undefined) throw new Error(`no fixture ${name}`);
    return serializeSong(entry.song);
  }

  it("opens he_plain as RTL rows and saves a Hebrew title set through the form", () => {
    const text = fixtureText("he_plain");
    const lyrics = parseSong(text).song.lines.filter((l) => l.kind === "lyric");
    expect(lyrics.length).toBeGreaterThan(0);
    const { onSave } = setup({ initialText: text });

    expect(byId("editor-visual")).toHaveAttribute("dir", "rtl");
    expect(lyricRows()).toHaveLength(lyrics.length);
    expect(byId("meta-title")).toHaveValue("שיר הבוקר");
    expect(byId("meta-title")).toHaveAttribute("dir", "auto");

    setMeta("meta-title", "שיר הערב");
    click("editor-save");
    const saved = parseSong(savedText(onSave)).song;
    expect(songMeta(saved, "title")).toBe("שיר הערב");
    expect(saved.direction).toBe("rtl");
    expect(saved.lines.filter((l) => l.kind === "lyric")).toEqual(lyrics);
  });

  it("lyric inputs use dir=auto", () => {
    setup({ initialText: fixtureText("he_plain") });
    const first = lyricRows()[0]!;
    fireEvent.click(within(first).getByTestId("line-edit-text"));
    expect(within(first).getByTestId("line-input")).toHaveAttribute(
      "dir",
      "auto",
    );
  });
});

describe("review file label", () => {
  it("fileLabel renders source and title in two separate bdi and ignores fileName", () => {
    setup({
      initialText: "{title: Morning Field}\n[C]Open the [G]gate\n",
      fileLabel: { source: "שיר.pdf", title: "Morning Field" },
      fileName: "ignored.txt",
    });
    const bdis = byId("reviewing-file").querySelectorAll("bdi");
    expect([...bdis].map((b) => b.textContent)).toEqual([
      "שיר.pdf",
      "Morning Field",
    ]);
    expect(byId("reviewing-file").textContent).not.toContain("ignored.txt");
  });

  it("without fileLabel one bdi holds fileName", () => {
    setup({ initialText: "[C]hi\n", fileName: "song.txt" });
    const bdis = byId("reviewing-file").querySelectorAll("bdi");
    expect([...bdis].map((b) => b.textContent)).toEqual(["song.txt"]);
  });
});

describe("document review additions", () => {
  const seedResult = {
    chordpro: HE_LOGICAL,
    format: "chords-over-lyrics" as const,
    warnings: [],
    hasRtlChords: true,
  };

  it("starts Flip from the seed's rtlColumns: logical flips to mirror", () => {
    setup({
      initialText: HE_LOGICAL,
      baseline: "",
      seed: { source: HE_SHEET, result: seedResult, rtlColumns: "logical" },
    });
    click("editor-flip");
    expect(textNow()).toBe(HE_MIRROR);
    click("editor-flip");
    expect(textNow()).toBe(HE_LOGICAL);
  });

  it("a seed without rtlColumns flips from mirror to logical", () => {
    setup({
      initialText: HE_MIRROR,
      baseline: "",
      seed: {
        source: HE_SHEET,
        result: { ...seedResult, chordpro: HE_MIRROR },
      },
    });
    click("editor-flip");
    expect(textNow()).toBe(HE_LOGICAL);
  });

  it("shows Convert with AI only when the prop is set", () => {
    const onConvertWithAi = vi.fn();
    setup({ onConvertWithAi });
    showSource();
    const current = (byId("editor-input") as HTMLTextAreaElement).value;
    click("editor-convert-ai");
    expect(onConvertWithAi).toHaveBeenCalledTimes(1);
    expect(onConvertWithAi).toHaveBeenCalledWith(current);
    expect(byId("editor-convert-ai").textContent).toBe(STRINGS.convertWithAi);
  });

  it("has no Convert with AI button and no notes by default", () => {
    setup();
    expect(screen.queryByTestId("editor-convert-ai")).toBeNull();
    expect(screen.queryByTestId("editor-notes")).toBeNull();
  });

  it("lists the notes in the review banner", () => {
    setup({ notes: ["first note", "second note"] });
    const items = within(byId("editor-notes")).getAllByRole("listitem");
    expect(items.map((i) => i.textContent)).toEqual([
      "first note",
      "second note",
    ]);
  });

  it("an empty notes list shows no banner", () => {
    setup({ notes: [] });
    expect(screen.queryByTestId("editor-notes")).toBeNull();
  });
});
