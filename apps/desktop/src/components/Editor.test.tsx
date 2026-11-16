import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STRINGS } from "../strings";
import { Editor } from "./Editor";
import type { EditorProps } from "./Editor";

const HE_SHEET = "Am      G\nשלום עולם יפה";
const HE_MIRROR = "שלום [G]עולם י[Am]פה";
const HE_LOGICAL = "[Am]שלום עול[G]ם יפה";

function setup(props: Partial<EditorProps> = {}) {
  const onSave = vi.fn(() => Promise.resolve());
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

const input = () => screen.getByTestId("editor-input") as HTMLTextAreaElement;
const type = (value: string) =>
  fireEvent.change(input(), { target: { value } });

function mockClipboard(readText: () => Promise<string>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { readText },
    configurable: true,
  });
}

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("Editor", () => {
  it("has a labelled monospace-friendly textarea with dir=auto and no spellcheck", () => {
    setup();
    expect(input().tagName).toBe("TEXTAREA");
    expect(input()).toHaveAttribute("dir", "auto");
    expect(input()).toHaveAttribute("spellcheck", "false");
    expect(screen.getByLabelText(STRINGS.editorLabel)).toBe(input());
  });

  describe("preview debounce", () => {
    beforeEach(() => vi.useFakeTimers());

    it("updates the preview only after 300 ms", () => {
      setup({ initialText: "old" });
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
      type("{capo: abc}\n[C]x");
      act(() => void vi.advanceTimersByTime(300));
      expect(screen.queryAllByTestId("diagnostic-item").length).toBeGreaterThan(
        0,
      );
    });
  });

  it("tracks dirty against the baseline", () => {
    const { onDirtyChange } = setup({ initialText: "abc" });
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
      fireEvent.click(screen.getByTestId("editor-paste"));
      await waitFor(() => expect(input().value).toBe(HE_MIRROR));
      expect(onDirtyChange).toHaveBeenLastCalledWith(true);
      expect(screen.getByTestId("editor-flip")).toBeInTheDocument();
    });

    it("shows pasteFailed when the clipboard rejects", async () => {
      mockClipboard(() => Promise.reject(new Error("denied")));
      setup({ initialText: "keep" });
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
  });

  describe("Convert", () => {
    it("leaves ChordPro unchanged and says so", () => {
      setup({ initialText: "[C]hello [G]world" });
      fireEvent.click(screen.getByTestId("editor-convert"));
      expect(input().value).toBe("[C]hello [G]world");
      expect(screen.getByTestId("editor-status").textContent).toBe(
        STRINGS.alreadyChordPro,
      );
      expect(screen.queryByTestId("editor-flip")).toBeNull();
    });

    it("converts chords over lyrics, with warnings listed", () => {
      setup({ initialText: "Am      G\nshort" });
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
      fireEvent.click(screen.getByTestId("editor-convert"));
      expect(screen.queryByTestId("editor-flip")).toBeNull();
    });
  });

  describe("Flip alignment", () => {
    it("toggles between mirror and logical from the kept source, and typing hides it", () => {
      setup({ initialText: HE_SHEET });
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
      expect(screen.getByTestId("reviewing-file").textContent).toContain(
        "song.txt",
      );
      fireEvent.click(screen.getByTestId("editor-flip"));
      expect(input().value).toBe(`{title: song}\n${HE_LOGICAL}`);
    });
  });

  describe("Save", () => {
    it("is disabled while pending and passes the text", async () => {
      let finish!: () => void;
      const onSave = vi.fn(
        () => new Promise<void>((resolve) => (finish = resolve)),
      );
      setup({ initialText: "[C]x", onSave });
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
      type("ab");
      fireEvent.click(screen.getByTestId("editor-save"));
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toBe(`${STRINGS.saveFailed}: disk full`);
      expect(screen.getByTestId("editor-save")).toBeEnabled();
      expect(onDirtyChange).toHaveBeenLastCalledWith(true);
      expect(input().value).toBe("ab");
    });
  });
});
