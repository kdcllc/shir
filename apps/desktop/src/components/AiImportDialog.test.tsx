import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AI_SONG_DELIMITER } from "chord-core";
import type { AiReplySong } from "chord-core";
import { i18n } from "../i18n";
import { STRINGS } from "../strings";
import { AiImportDialog } from "./AiImportDialog";
import type { AiImportDialogProps } from "./AiImportDialog";

const ONE = "{title: Garden Gate}\n[C]Open the [G]gate";
const TWO = "{title: River Bend}\n[Am]Follow the [F]water";
const REPLY = `\`\`\`chordpro\n${ONE}\n${AI_SONG_DELIMITER}\n${TWO}\n\`\`\``;

type Picked = Awaited<ReturnType<AiImportDialogProps["pickDocument"]>>;

function setup(props: Partial<AiImportDialogProps> = {}) {
  const pickDocument = vi.fn<AiImportDialogProps["pickDocument"]>(() =>
    Promise.resolve(undefined),
  );
  const onImport = vi.fn<(songs: AiReplySong[]) => void>();
  const onCancel = vi.fn();
  render(
    <AiImportDialog
      pickDocument={pickDocument}
      onImport={onImport}
      onCancel={onCancel}
      {...props}
    />,
  );
  return { pickDocument, onImport, onCancel };
}

const byId = (id: string) => screen.getByTestId(id);
const prompt = () => byId("ai-prompt") as HTMLTextAreaElement;

function clipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("AiImportDialog", () => {
  it("is a labelled modal dialog", () => {
    setup();
    const dialog = byId("ai-import-dialog");
    expect(dialog).toHaveAttribute("role", "dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const label = document.getElementById(
      dialog.getAttribute("aria-labelledby") ?? "",
    );
    expect(label?.textContent).toBe(STRINGS.importWithAi);
  });

  it("opens in attach mode with the attach prompt", () => {
    setup();
    expect(byId("ai-source-attach")).toBeChecked();
    expect(prompt().value).toContain("attached file");
    expect(prompt().value).not.toContain("SHIR_DOCUMENT");
    expect(prompt()).toHaveAttribute("dir", "ltr");
    expect(prompt()).toHaveAttribute("readonly");
  });

  it("opens in text mode with the initial document", () => {
    setup({ initial: { sourceName: "sheet.docx", text: "Am  G\nla la la" } });
    expect(byId("ai-source-document")).toBeChecked();
    expect(prompt().value).toContain("la la la");
    expect(prompt().value).toContain("sheet.docx");
  });

  it("shows a hint and disables Copy in text mode before a document is picked", () => {
    setup();
    fireEvent.click(byId("ai-source-document"));
    expect(screen.queryByTestId("ai-prompt")).toBeNull();
    expect(byId("ai-prompt-hint").textContent).toBe(STRINGS.aiPromptHint);
    expect(byId("ai-copy")).toBeDisabled();
  });

  it("switches to text mode after a pick and shows the file, count and warnings", async () => {
    const picked: Picked = {
      sourceName: "tune.pdf",
      text: "Dm  C\nsing along",
      warnings: ["a warning"],
    };
    const pickDocument = vi.fn<AiImportDialogProps["pickDocument"]>(() =>
      Promise.resolve(picked),
    );
    setup({ pickDocument });
    fireEvent.click(byId("ai-pick-document"));
    await screen.findByTestId("ai-picked");
    expect(byId("ai-source-document")).toBeChecked();
    expect(pickDocument).toHaveBeenCalledTimes(1);
    expect(prompt().value).toContain("sing along");
    expect(byId("ai-picked").textContent).toContain("tune.pdf");
    expect(byId("ai-picked").textContent).toContain("16");
    expect(byId("ai-pick-warnings").textContent).toBe("a warning");
    expect(byId("ai-copy")).toBeEnabled();
  });

  it("counts the picked text in graphemes, not UTF-16 units", async () => {
    const text = "שָׁלוֹם עוֹלָם";
    expect(text.length).toBe(14);
    setup({
      pickDocument: () =>
        Promise.resolve({ sourceName: "shalom.docx", text, warnings: [] }),
    });
    fireEvent.click(byId("ai-pick-document"));
    const picked = await screen.findByTestId("ai-picked");
    expect(picked.textContent).toContain(i18n.t("aiCharCount", { count: 9 }));
  });

  it("gives each text area one accessible name and no label element", async () => {
    setup({
      pickDocument: () =>
        Promise.resolve({
          sourceName: "tune.pdf",
          text: "Dm  C\nsing along",
          warnings: [],
        }),
    });
    const reply = screen.getByRole("textbox", { name: STRINGS.aiReplyLabel });
    expect(reply).toBe(byId("ai-reply"));
    expect((reply as HTMLTextAreaElement).labels).toHaveLength(0);
    fireEvent.click(byId("ai-pick-document"));
    await screen.findByTestId("ai-picked");
    const promptBox = screen.getByRole("textbox", {
      name: STRINGS.aiPromptLabel,
    });
    expect(promptBox).toBe(prompt());
    expect((promptBox as HTMLTextAreaElement).labels).toHaveLength(0);
  });

  const PDF_LINE =
    "The text was extracted from a PDF, so chord positions above lyrics may be approximate";

  it("adds the approximate-positions line to the prompt of a PDF", () => {
    setup({
      initial: { sourceName: "tune.pdf", text: "Am\nla la", format: "pdf" },
    });
    expect(prompt().value).toContain(PDF_LINE);
  });

  it("leaves the approximate-positions line out for other or absent formats", () => {
    for (const format of ["docx", undefined] as const) {
      const view = render(
        <AiImportDialog
          initial={{ sourceName: "tune.docx", text: "Am\nla la", format }}
          pickDocument={() => Promise.resolve(undefined)}
          onImport={() => undefined}
          onCancel={() => undefined}
        />,
      );
      expect(prompt().value).not.toContain(PDF_LINE);
      view.unmount();
    }
  });

  it("keeps the previous source when the picker is cancelled", async () => {
    const { pickDocument } = setup();
    fireEvent.click(byId("ai-pick-document"));
    await waitFor(() => expect(pickDocument).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(byId("ai-pick-document")).toBeEnabled());
    expect(screen.queryByTestId("ai-pick-error")).toBeNull();
    expect(byId("ai-prompt-hint")).toBeInTheDocument();
  });

  it("shows the message of a failed pick", async () => {
    setup({ pickDocument: () => Promise.reject(new Error("too big, sorry")) });
    fireEvent.click(byId("ai-pick-document"));
    expect((await screen.findByTestId("ai-pick-error")).textContent).toBe(
      "too big, sorry",
    );
  });

  it("copies the prompt and says so", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    clipboard(writeText);
    setup();
    fireEvent.click(byId("ai-copy"));
    expect((await screen.findByTestId("ai-copied")).textContent).toBe(
      STRINGS.aiCopied,
    );
    expect(writeText).toHaveBeenCalledWith(prompt().value);
  });

  it("selects the prompt and shows the Ctrl+C hint when the clipboard fails", async () => {
    clipboard(() => Promise.reject(new Error("denied")));
    setup();
    fireEvent.click(byId("ai-copy"));
    expect((await screen.findByTestId("ai-copy-failed")).textContent).toBe(
      STRINGS.aiCopyFailed,
    );
    expect(prompt().selectionStart).toBe(0);
    expect(prompt().selectionEnd).toBe(prompt().value.length);
    expect(screen.queryByTestId("ai-copied")).toBeNull();
  });

  it("treats a missing clipboard API as a failed copy", async () => {
    setup();
    fireEvent.click(byId("ai-copy"));
    await screen.findByTestId("ai-copy-failed");
  });

  it("drops the copy status when the source changes", async () => {
    clipboard(() => Promise.resolve());
    setup();
    fireEvent.click(byId("ai-copy"));
    await screen.findByTestId("ai-copied");
    fireEvent.click(byId("ai-source-document"));
    expect(screen.queryByTestId("ai-copied")).toBeNull();
  });

  it("keeps Read songs disabled while the reply is blank", () => {
    setup();
    expect(byId("ai-parse")).toBeDisabled();
    expect(byId("ai-reply")).toHaveAttribute("dir", "auto");
    fireEvent.change(byId("ai-reply"), { target: { value: "  \n " } });
    expect(byId("ai-parse")).toBeDisabled();
  });

  it("lists both songs of a two-song reply and reviews them", () => {
    const { onImport } = setup();
    fireEvent.change(byId("ai-reply"), { target: { value: REPLY } });
    fireEvent.click(byId("ai-parse"));
    const items = screen.getAllByTestId("ai-song");
    expect(items.map((i) => i.textContent)).toEqual([
      "Garden Gate",
      "River Bend",
    ]);
    expect(byId("ai-review").textContent).toBe("Review 2 songs");
    fireEvent.click(byId("ai-review"));
    expect(onImport).toHaveBeenCalledTimes(1);
    const songs = onImport.mock.calls[0]![0];
    expect(songs.map((s) => s.chordpro)).toEqual([`${ONE}\n`, `${TWO}\n`]);
  });

  it("numbers songs without a title and counts diagnostics", () => {
    setup();
    fireEvent.change(byId("ai-reply"), {
      target: { value: "[C]no title here\n{end_of_verse}" },
    });
    fireEvent.click(byId("ai-parse"));
    const text = byId("ai-song").textContent ?? "";
    expect(text).toContain("Song 1");
    expect(text).toMatch(/\d+ problems?/);
  });

  it("reports a reply without songs", () => {
    setup();
    fireEvent.change(byId("ai-reply"), { target: { value: "```\n```" } });
    fireEvent.click(byId("ai-parse"));
    expect(byId("ai-parse-error").textContent).toBe(STRINGS.aiParseError);
    expect(screen.queryByTestId("ai-songs")).toBeNull();
  });

  it("clears the list when the reply is edited", () => {
    setup();
    fireEvent.change(byId("ai-reply"), { target: { value: REPLY } });
    fireEvent.click(byId("ai-parse"));
    fireEvent.change(byId("ai-reply"), { target: { value: `${REPLY}\n` } });
    expect(screen.queryByTestId("ai-songs")).toBeNull();
  });

  it("shows a notice when the reply was truncated", () => {
    setup();
    const many = Array.from(
      { length: 501 },
      (_, i) => `{title: Tune ${i}}\n[C]la`,
    ).join(`\n${AI_SONG_DELIMITER}\n`);
    fireEvent.change(byId("ai-reply"), { target: { value: many } });
    fireEvent.click(byId("ai-parse"));
    expect(byId("ai-truncated").textContent).toBe(STRINGS.aiTruncated);
    expect(screen.getAllByTestId("ai-song")).toHaveLength(500);
  });

  it("Escape cancels", () => {
    const { onCancel } = setup();
    fireEvent.keyDown(byId("ai-import-dialog"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("Cancel cancels", () => {
    const { onCancel } = setup();
    fireEvent.click(byId("ai-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("takes focus on mount", () => {
    setup();
    expect(document.activeElement).toBe(byId("ai-import-dialog"));
  });

  it("Tab wraps from the last control to the first and Shift+Tab back", () => {
    setup();
    const dialog = byId("ai-import-dialog");
    const last = byId("ai-cancel");
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(byId("ai-pick-document"));
    fireEvent.keyDown(document.activeElement!, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
    dialog.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("restores focus to the opener on unmount", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const view = render(
      <AiImportDialog
        pickDocument={() => Promise.resolve(undefined)}
        onImport={() => undefined}
        onCancel={() => undefined}
      />,
    );
    act(() => view.unmount());
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
