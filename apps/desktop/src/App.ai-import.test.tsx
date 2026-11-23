import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { documentToText, importText } from "chord-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { i18n } from "./i18n";
import {
  DocumentReadError,
  FileReadError,
  extractDocument,
  pickDocumentFile,
  pickSongFiles,
  readTextFile,
} from "./files";
import { withTitleFallback } from "./importFiles";
import { getSong, listSongs, saveSong } from "./storage";
import type { Song } from "./storage";
import { STRINGS } from "./strings";

// Passthrough: every test keeps the real `documentToText`; a test overrides it once.
vi.mock("chord-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("chord-core")>();
  return { ...actual, documentToText: vi.fn(actual.documentToText) };
});
vi.mock("./uiReady", () => ({ signalUiReady: vi.fn() }));
vi.mock("./storage", () => ({
  listSongs: vi.fn(),
  getSong: vi.fn(),
  searchSongs: vi.fn(),
  saveSong: vi.fn(),
  deleteSong: vi.fn(),
  listSetlists: vi.fn(() => Promise.resolve([])),
  getSetlist: vi.fn(),
  createSetlist: vi.fn(),
  renameSetlist: vi.fn(),
  deleteSetlist: vi.fn(() => Promise.resolve()),
  duplicateSetlist: vi.fn(),
  addSetlistItems: vi.fn(),
  removeSetlistItem: vi.fn(),
  reorderSetlistItems: vi.fn(),
  updateSetlistItem: vi.fn(),
}));
vi.mock("./files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./files")>()),
  extractDocument: vi.fn(),
  pickDocumentFile: vi.fn(),
  pickSongFiles: vi.fn(),
  readTextFile: vi.fn(),
  saveExportDocx: vi.fn(),
}));

const SONG_ONE = "{title: Garden Gate}\n[C]Open the [G]gate\n";
const SONG_TWO = "{title: River Bend}\n[Am]Follow the [F]water\n";
const REPLY = `\`\`\`chordpro\n${SONG_ONE}{new_song}\n${SONG_TWO}\`\`\``;

const DOC = {
  format: "docx" as const,
  blocks: [
    { kind: "paragraph" as const, text: "Am      G" },
    { kind: "paragraph" as const, text: "שלום עולם יפה" },
  ],
  warnings: [{ kind: "Skipped" as const, message: "raw skipped text" }],
};

function stored(id: string, chordpro: string): Song {
  return { id, chordpro, createdAt: "", updatedAt: "" } as unknown as Song;
}

const byId = (id: string) => screen.getByTestId(id);
const click = (id: string) => fireEvent.click(byId(id));
const reviewing = () => byId("reviewing-file").textContent ?? "";

let errorSpy: ReturnType<typeof vi.spyOn>;
let nextId = 0;

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  nextId = 0;
  vi.mocked(listSongs).mockResolvedValue([]);
  vi.mocked(getSong).mockImplementation((id) =>
    Promise.reject(new Error(`no song ${id}`)),
  );
  vi.mocked(saveSong).mockReset();
  vi.mocked(saveSong).mockImplementation((chordpro, id) =>
    Promise.resolve(stored(id ?? `new${++nextId}`, chordpro)),
  );
  vi.mocked(pickSongFiles).mockReset();
  vi.mocked(readTextFile).mockReset();
  vi.mocked(extractDocument).mockReset();
  vi.mocked(pickDocumentFile).mockReset();
  vi.mocked(documentToText).mockReset();
});

afterEach(() => {
  expect(errorSpy).not.toHaveBeenCalled();
  errorSpy.mockRestore();
});

async function renderDb() {
  render(<App />);
  await screen.findByTestId("ai-import");
}

/** Pastes `reply` into the open dialog, reads the songs and starts the review. */
function reviewReply(reply: string) {
  fireEvent.change(byId("ai-reply"), { target: { value: reply } });
  click("ai-parse");
  click("ai-review");
}

/** Saves the song under review and waits for the call. */
async function saveCurrent(calls: number) {
  click("editor-save");
  await waitFor(() => expect(saveSong).toHaveBeenCalledTimes(calls));
}

describe("Import with AI", () => {
  it("opens the dialog from the toolbar after Open files", async () => {
    await renderDb();
    const buttons = [...byId("open-files").parentElement!.children];
    expect(buttons.map((b) => b.getAttribute("data-testid"))).toEqual([
      "new-song",
      "open-files",
      "ai-import",
    ]);
    expect(byId("ai-import").textContent).toBe(STRINGS.importWithAi);
    click("ai-import");
    expect(byId("ai-import-dialog")).toBeInTheDocument();
    click("ai-cancel");
    expect(screen.queryByTestId("ai-import-dialog")).toBeNull();
  });

  it("reviews a pasted two-song reply and saves each song's exact text", async () => {
    await renderDb();
    click("ai-import");
    reviewReply(REPLY);
    await screen.findByTestId("editor");
    expect(screen.queryByTestId("ai-import-dialog")).toBeNull();
    expect(reviewing()).toContain("AI · Garden Gate");
    expect(saveSong).not.toHaveBeenCalled();

    await saveCurrent(1);
    await waitFor(() => expect(reviewing()).toContain("AI · River Bend"));
    await saveCurrent(2);
    await waitFor(() => expect(screen.queryByTestId("editor")).toBeNull());

    expect(vi.mocked(saveSong).mock.calls.map((c) => c[0])).toEqual([
      SONG_ONE,
      SONG_TWO,
    ]);
    expect(vi.mocked(saveSong).mock.calls.map((c) => c[1])).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("Cancel on the first song skips it and opens the second", async () => {
    await renderDb();
    click("ai-import");
    reviewReply(REPLY);
    await screen.findByTestId("editor");
    click("editor-cancel");
    click("confirm-discard-yes");
    await waitFor(() => expect(reviewing()).toContain("AI · River Bend"));
    expect(saveSong).not.toHaveBeenCalled();
    await saveCurrent(1);
    expect(vi.mocked(saveSong).mock.calls[0]![0]).toBe(SONG_TWO);
  });

  it("extracts a document in the dialog and puts its text in the prompt", async () => {
    vi.mocked(pickDocumentFile).mockResolvedValue("/m/sheet.docx");
    vi.mocked(extractDocument).mockResolvedValue(DOC);
    await renderDb();
    click("ai-import");
    click("ai-pick-document");
    await screen.findByTestId("ai-picked");
    expect(byId("ai-picked").textContent).toContain("sheet.docx");
    expect(byId("ai-pick-warnings").textContent).toBe(STRINGS.docWarnSkipped);
    expect((byId("ai-prompt") as HTMLTextAreaElement).value).toContain(
      "שלום עולם יפה",
    );
    expect(pickDocumentFile).toHaveBeenCalledWith(STRINGS.fileFilterDocuments);
    expect(extractDocument).toHaveBeenCalledWith("/m/sheet.docx");
  });

  it("a PDF picked in the dialog puts the approximate-positions line in the prompt", async () => {
    vi.mocked(pickDocumentFile).mockResolvedValue("/m/tune.pdf");
    vi.mocked(extractDocument).mockResolvedValue({
      format: "pdf",
      blocks: [{ kind: "paragraph", text: "Am  G" }],
      warnings: [],
    });
    await renderDb();
    click("ai-import");
    click("ai-pick-document");
    await screen.findByTestId("ai-picked");
    expect((byId("ai-prompt") as HTMLTextAreaElement).value).toContain(
      "The text was extracted from a PDF, so chord positions above lyrics may be approximate",
    );
  });

  it("a failed native picker shows the localized message, not the raw text", async () => {
    vi.mocked(pickDocumentFile).mockRejectedValue(
      new FileReadError("Ipc", "raw plugin text"),
    );
    await renderDb();
    click("ai-import");
    click("ai-pick-document");
    const error = await screen.findByTestId("ai-pick-error");
    expect(error.textContent).toBe(STRINGS.importPickFailed);
    expect(error.textContent).not.toContain("raw plugin text");
    expect(extractDocument).not.toHaveBeenCalled();
  });

  it("a cancelled document pick leaves the dialog as it was", async () => {
    vi.mocked(pickDocumentFile).mockResolvedValue(undefined);
    await renderDb();
    click("ai-import");
    click("ai-pick-document");
    await waitFor(() => expect(pickDocumentFile).toHaveBeenCalled());
    expect(screen.queryByTestId("ai-pick-error")).toBeNull();
    expect(extractDocument).not.toHaveBeenCalled();
  });

  it("shows a document pick failure in the interface language", async () => {
    vi.mocked(pickDocumentFile).mockResolvedValue("/m/big.pdf");
    vi.mocked(extractDocument).mockRejectedValue(
      new DocumentReadError("TooLarge", "raw backend text"),
    );
    await renderDb();
    click("ai-import");
    click("ai-pick-document");
    expect((await screen.findByTestId("ai-pick-error")).textContent).toBe(
      STRINGS.docTooLarge,
    );
  });

  it("a pdf without text in the dialog gets the NoText message", async () => {
    vi.mocked(pickDocumentFile).mockResolvedValue("/m/scan.pdf");
    vi.mocked(extractDocument).mockResolvedValue({
      format: "pdf",
      blocks: [],
      warnings: [{ kind: "PdfNoText", message: "raw" }],
    });
    await renderDb();
    click("ai-import");
    click("ai-pick-document");
    expect((await screen.findByTestId("ai-pick-error")).textContent).toBe(
      STRINGS.docNoText,
    );
  });
});

const UNTITLED_REPLY = `\`\`\`chordpro\n${SONG_ONE}{new_song}\n[Am]Morning light on the [F]hill\n\`\`\``;

describe("AI songs without a title", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("saves the plain ordinal title and keeps the source in the review label", async () => {
    await renderDb();
    click("ai-import");
    reviewReply(UNTITLED_REPLY);
    await screen.findByTestId("editor");
    await saveCurrent(1);
    await waitFor(() => expect(reviewing()).toContain("AI · Song 2"));
    await saveCurrent(2);
    const saved = vi.mocked(saveSong).mock.calls.map((c) => c[0]);
    expect(saved[0]).toBe(SONG_ONE);
    expect(saved[1]).toBe(
      "{title: Song 2}\n[Am]Morning light on the [F]hill\n",
    );
  });

  it("saves the Hebrew ordinal title in the Hebrew locale", async () => {
    await i18n.changeLanguage("he");
    await renderDb();
    click("ai-import");
    reviewReply(UNTITLED_REPLY);
    await screen.findByTestId("editor");
    await saveCurrent(1);
    await waitFor(() => expect(reviewing()).toContain("שיר 2"));
    await saveCurrent(2);
    const second = vi.mocked(saveSong).mock.calls[1]?.[0] ?? "";
    expect(second.split("\n")[0]).toBe("{title: שיר 2}");
  });
});

describe("document review", () => {
  async function openDocx() {
    vi.mocked(pickSongFiles).mockResolvedValue(["/m/sheet.docx"]);
    vi.mocked(extractDocument).mockResolvedValue(DOC);
    await renderDb();
    click("open-files");
    await screen.findByTestId("editor");
  }

  it("a .docx opens in the editor with its notes and Flip", async () => {
    await openDocx();
    expect(reviewing()).toContain("sheet.docx");
    const notes = within(byId("editor-notes"))
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(notes).toEqual([STRINGS.docWarnSkipped, STRINGS.docNoteOneSong]);
    expect(byId("editor-flip")).toBeInTheDocument();
    expect(byId("editor-convert-ai").textContent).toBe(STRINGS.convertWithAi);

    click("editor-tab-source");
    const before = (byId("editor-input") as HTMLTextAreaElement).value;
    click("editor-flip");
    expect((byId("editor-input") as HTMLTextAreaElement).value).not.toBe(
      before,
    );
  });

  it("Convert with AI opens the dialog with the document and replaces it with the AI songs", async () => {
    await openDocx();
    click("editor-convert-ai");
    expect(byId("ai-source-document")).toBeChecked();
    const prompt = (byId("ai-prompt") as HTMLTextAreaElement).value;
    expect(prompt).toContain("שלום עולם יפה");
    expect(prompt).toContain("sheet.docx");

    reviewReply(REPLY);
    expect(screen.queryByTestId("confirm-discard-yes")).toBeNull();
    await waitFor(() =>
      expect(reviewing()).toContain("sheet.docx · Garden Gate"),
    );
    expect(screen.queryByTestId("editor-convert-ai")).toBeNull();
    expect(screen.queryByTestId("editor-notes")).toBeNull();

    await saveCurrent(1);
    await waitFor(() => expect(reviewing()).toContain("River Bend"));
    await saveCurrent(2);
    await waitFor(() => expect(screen.queryByTestId("editor")).toBeNull());
    expect(vi.mocked(saveSong).mock.calls.map((c) => c[0])).toEqual([
      SONG_ONE,
      SONG_TWO,
    ]);
    expect(screen.queryByTestId("import-skipped")).toBeNull();
  });

  it("Convert with AI asks before discarding only after the document was edited", async () => {
    await openDocx();
    click("editor-tab-source");
    fireEvent.change(byId("editor-input"), {
      target: { value: "{title: Edited}\n[C]edited" },
    });
    click("editor-convert-ai");
    reviewReply(REPLY);
    click("confirm-discard-yes");
    await waitFor(() =>
      expect(reviewing()).toContain("sheet.docx · Garden Gate"),
    );
    expect(screen.queryByTestId("editor-convert-ai")).toBeNull();
  });

  it("Convert with AI asks before discarding after Flip changed the text", async () => {
    await openDocx();
    click("editor-flip");
    click("editor-convert-ai");
    reviewReply(REPLY);
    expect(screen.getByTestId("confirm-discard-yes")).toBeInTheDocument();
    click("confirm-discard-yes");
    await waitFor(() =>
      expect(reviewing()).toContain("sheet.docx · Garden Gate"),
    );
  });

  it("a queued document's logical column order reaches the editor seed", async () => {
    const text = "Am      G\nשלום עולם יפה\n";
    vi.mocked(documentToText).mockImplementationOnce(() => ({
      text,
      rtlColumns: "logical",
    }));
    await openDocx();
    expect(documentToText).toHaveBeenCalled();
    const logical = withTitleFallback(
      importText(text, { rtlColumns: "logical" }).chordpro,
      "/m/sheet.docx",
    );
    const mirror = withTitleFallback(
      importText(text, { rtlColumns: "mirror" }).chordpro,
      "/m/sheet.docx",
    );
    expect(mirror).not.toBe(logical);
    click("editor-tab-source");
    expect((byId("editor-input") as HTMLTextAreaElement).value).toBe(logical);
    click("editor-flip");
    expect((byId("editor-input") as HTMLTextAreaElement).value).toBe(mirror);
  });

  it("Convert with AI passes the document format to the prompt", async () => {
    const line =
      "The text was extracted from a PDF, so chord positions above lyrics may be approximate";
    await renderDb();
    vi.mocked(pickSongFiles).mockResolvedValue(["/m/tune.pdf"]);
    vi.mocked(extractDocument).mockResolvedValue({
      format: "pdf",
      blocks: [{ kind: "paragraph", text: "Am  G\nla la" }],
      warnings: [],
    });
    click("open-files");
    await screen.findByTestId("editor");
    click("editor-convert-ai");
    expect((byId("ai-prompt") as HTMLTextAreaElement).value).toContain(line);
  });

  it("the AI songs go ahead of the rest of the queue", async () => {
    vi.mocked(pickSongFiles).mockResolvedValue([
      "/m/sheet.docx",
      "/m/other.docx",
    ]);
    vi.mocked(extractDocument).mockResolvedValue(DOC);
    await renderDb();
    click("open-files");
    await screen.findByTestId("editor");
    click("editor-convert-ai");
    reviewReply(SONG_ONE);
    expect(screen.queryByTestId("confirm-discard-yes")).toBeNull();
    await waitFor(() =>
      expect(reviewing()).toContain("sheet.docx · Garden Gate"),
    );
    await saveCurrent(1);
    await waitFor(() => expect(reviewing()).toContain("other.docx"));
  });

  it("a title with a slash is shown whole in the review and in the skipped list", async () => {
    await openDocx();
    click("editor-convert-ai");
    reviewReply("```chordpro\n{title: Left/Right}\n[C]Open the [G]gate\n```");
    await waitFor(() =>
      expect(reviewing()).toContain("sheet.docx · Left/Right"),
    );
    click("editor-cancel");
    click("confirm-discard-yes");
    await waitFor(() => expect(screen.queryByTestId("editor")).toBeNull());
    const skipped = byId("import-skipped");
    const entry = within(skipped).getAllByRole("listitem")[0]!;
    expect(entry.textContent).toBe("sheet.docx · Left/Right");
    expect(
      [...entry.querySelectorAll("bdi")].map((b) => b.textContent),
    ).toEqual(["sheet.docx", "Left/Right"]);
  });

  it("closing the dialog keeps the document under review", async () => {
    await openDocx();
    click("editor-convert-ai");
    click("ai-cancel");
    expect(reviewing()).toContain("sheet.docx");
  });
});

describe("failed documents in the import report", () => {
  async function importFailure(path: string, reason: unknown) {
    vi.mocked(pickSongFiles).mockResolvedValue([path]);
    if (reason === "no-text") {
      vi.mocked(extractDocument).mockResolvedValue({
        format: "pdf",
        blocks: [],
        warnings: [{ kind: "PdfNoText", message: "raw no text" }],
      });
    } else {
      vi.mocked(extractDocument).mockRejectedValue(reason);
    }
    await renderDb();
    click("open-files");
    return (await screen.findByTestId("import-failed")).textContent;
  }

  it("an unreadable .pdf shows the NoText message", async () => {
    expect(await importFailure("/m/scan.pdf", "no-text")).toBe(
      `scan.pdf: ${STRINGS.docNoText}`,
    );
  });

  it.each([
    ["TooLarge", STRINGS.docTooLarge],
    ["TextTooLarge", STRINGS.docTextTooLarge],
    ["Unsupported", STRINGS.docUnsupported],
    ["Corrupt", STRINGS.docCorrupt],
    ["Io", STRINGS.docIo],
  ] as const)("%s is localized", async (kind, message) => {
    expect(
      await importFailure("/m/f.docx", new DocumentReadError(kind, "raw")),
    ).toBe(`f.docx: ${message}`);
  });

  it("a failure after extraction shows the damaged-file message", async () => {
    vi.mocked(documentToText).mockImplementationOnce(() => {
      throw new Error("boom");
    });
    vi.mocked(pickSongFiles).mockResolvedValue(["/m/f.docx"]);
    vi.mocked(extractDocument).mockResolvedValue(DOC);
    await renderDb();
    click("open-files");
    expect((await screen.findByTestId("import-failed")).textContent).toBe(
      `f.docx: ${STRINGS.docCorrupt}`,
    );
  });

  it("an IPC failure keeps the raw message", async () => {
    expect(
      await importFailure("/m/f.docx", new DocumentReadError("Ipc", "boom")),
    ).toBe("f.docx: boom");
  });

  it("a text file failure keeps the raw message", async () => {
    vi.mocked(pickSongFiles).mockResolvedValue(["/m/a.txt"]);
    vi.mocked(readTextFile).mockRejectedValue(new Error("not utf-8"));
    await renderDb();
    click("open-files");
    expect((await screen.findByTestId("import-failed")).textContent).toBe(
      "a.txt: not utf-8",
    );
  });
});
