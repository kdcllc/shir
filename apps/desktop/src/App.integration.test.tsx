import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { viewSong } from "chord-core";
import type { SongModel } from "chord-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { loadLibrary } from "./library";
import { FileReadError, pickSongFiles, readTextFile } from "./files";
import { getSong, listSongs, saveSong } from "./storage";
import type { Song, SongSummary } from "./storage";
import { STRINGS } from "./strings";

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
  pickSongFiles: vi.fn(),
  readTextFile: vi.fn(),
  saveExportDocx: vi.fn(),
}));

const library = loadLibrary();

function modelChords(song: SongModel): string[] {
  const out: string[] = [];
  for (const line of song.lines) {
    if (line.kind === "lyric") out.push(...line.chords.map((c) => c.chord));
    else if (line.kind === "chords") out.push(...line.chords);
  }
  return out;
}

function renderedChords(): string[] {
  return [...document.querySelectorAll("[data-song] .chord")].map(
    (el) => el.textContent ?? "",
  );
}

describe("App integration: every bundled song", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(listSongs).mockRejectedValue(new Error("unavailable"));
  });
  afterEach(() => {
    cleanup();
    errorSpy.mockRestore();
  });

  it("has a non-trivial library", () => {
    expect(library.length).toBeGreaterThan(1);
  });

  it("covers key, capo and diagnostics branches", () => {
    const diagCount = (e: (typeof library)[number]): number =>
      e.diagnostics.length +
      viewSong(e.song, { capo: e.song.capo ?? 0 }).diagnostics.length;
    expect(
      library.some(
        (e) =>
          viewSong(e.song, { capo: e.song.capo ?? 0 }).soundingKey !==
          undefined,
      ),
    ).toBe(true);
    expect(library.some((e) => (e.song.capo ?? 0) > 0)).toBe(true);
    expect(library.some((e) => diagCount(e) > 0)).toBe(true);
    expect(library.some((e) => diagCount(e) === 0)).toBe(true);
  });

  it.each(library.map((e) => [e.id, e] as const))("%s", async (_id, entry) => {
    render(<App />);
    await screen.findAllByTestId("song-item");
    const index = library.findIndex((s) => s.id === entry.id);
    fireEvent.click(screen.getAllByTestId("song-item")[index]!);

    const capo = entry.song.capo ?? 0;
    expect(screen.getByTestId("song-title").textContent).toBe(entry.title);

    const base = viewSong(entry.song, { capo });
    expect(renderedChords()).toEqual(modelChords(base.song));

    const diagCount = entry.diagnostics.length + base.diagnostics.length;
    if (diagCount > 0) {
      expect(screen.getAllByTestId("diagnostic-item")).toHaveLength(diagCount);
    } else {
      expect(screen.queryByTestId("diagnostics")).toBeNull();
    }
    expect(screen.queryByTestId("diagnostics") !== null).toBe(diagCount > 0);

    if (entry.song.key !== undefined) {
      fireEvent.click(screen.getByTestId("transpose-up"));
      fireEvent.click(screen.getByTestId("transpose-up"));
      fireEvent.click(screen.getByTestId("transpose-up"));
      expect(screen.getByTestId("transpose-value").textContent).toBe("+3");
      expect(renderedChords()).toEqual(
        modelChords(viewSong(entry.song, { transpose: 3, capo }).song),
      );

      fireEvent.change(screen.getByTestId("capo-select"), {
        target: { value: "0" },
      });
      const sounding = viewSong(entry.song, {
        transpose: 3,
        capo: 0,
      }).soundingKey;
      expect(sounding).toBeDefined();
      expect(screen.getByTestId("sounding-key").textContent).toBe(sounding);
      expect(screen.getByTestId("shape-key").textContent).toBe(sounding);
      expect(screen.getByTestId("sounding-key").textContent).not.toBe(
        STRINGS.noKey,
      );
    }

    expect(errorSpy).not.toHaveBeenCalled();
  });
});

function summaryOf(id: string, title: string): SongSummary {
  return {
    id,
    title,
    artist: null,
    key: null,
    language: "en",
    updatedAt: "2026-01-01T00:00:00Z",
  } as SongSummary;
}

function storedSong(id: string, chordpro: string): Song {
  return { id, chordpro, createdAt: "", updatedAt: "" } as unknown as Song;
}

const EN_SHEET = "Am     G\nWalking down the lane\n";
const HE_SHEET = " C     G   Am\nשלום לכם בבית\n";
const HE_LOGICAL = "ש[C]לום לכ[G]ם בב[Am]ית";

describe("G6 editor", () => {
  const db = new Map<string, string>();
  let summaries: SongSummary[];
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    db.clear();
    db.set("a", "{title: Alpha}\n[C]Alpha line");
    db.set("b", "{title: Beta}\n[Am]Beta line");
    summaries = [summaryOf("a", "Alpha"), summaryOf("b", "Beta")];
    vi.mocked(listSongs).mockReset();
    vi.mocked(listSongs).mockImplementation(() => Promise.resolve(summaries));
    vi.mocked(getSong).mockReset();
    vi.mocked(getSong).mockImplementation((id) =>
      Promise.resolve(storedSong(id, db.get(id) ?? "")),
    );
    vi.mocked(saveSong).mockReset();
    vi.mocked(pickSongFiles).mockReset();
    vi.mocked(readTextFile).mockReset();
  });
  afterEach(() => {
    cleanup();
    errorSpy.mockRestore();
    Reflect.deleteProperty(navigator, "clipboard");
  });

  /** Saves resolve with a new song that the next listSongs call also returns. */
  function mockSaves(titles: string[]) {
    let n = 0;
    vi.mocked(saveSong).mockImplementation((chordpro) => {
      const id = `new${++n}`;
      const title = titles[n - 1] ?? id;
      db.set(id, chordpro);
      summaries = [...summaries, summaryOf(id, title)];
      return Promise.resolve(storedSong(id, chordpro));
    });
  }

  async function renderDb() {
    render(<App />);
    await screen.findAllByTestId("song-item");
  }

  it("New, Paste chords over lyrics, preview shows chords, Save stores the converted ChordPro and selects the song", async () => {
    mockSaves(["Walking"]);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { readText: () => Promise.resolve(EN_SHEET) },
    });
    await renderDb();

    fireEvent.click(screen.getByTestId("new-song"));
    fireEvent.click(screen.getByTestId("editor-paste"));

    // The editor opens on the Visual tab: the pasted song shows as a row.
    const visual = screen.getByTestId("editor-visual");
    await waitFor(() =>
      expect(
        [...visual.querySelectorAll("[data-chord-button]")].map(
          (c) => c.textContent,
        ),
      ).toEqual(["Am", "G"]),
    );
    fireEvent.click(screen.getByTestId("editor-tab-source"));
    const input = screen.getByTestId<HTMLTextAreaElement>("editor-input");
    await waitFor(() => expect(input.value).toContain("[Am]Walking [G]down"));
    const preview = screen.getByTestId("editor-preview");
    await waitFor(() =>
      expect(
        [...preview.querySelectorAll(".chord")].map((c) => c.textContent),
      ).toEqual(["Am", "G"]),
    );

    fireEvent.click(screen.getByTestId("editor-save"));
    await waitFor(() =>
      expect(screen.getByTestId("song-title").textContent).toBe("Walking"),
    );
    expect(saveSong).toHaveBeenCalledTimes(1);
    expect(vi.mocked(saveSong).mock.calls[0]![0]).toBe(
      "[Am]Walking [G]down the lane\n",
    );
    expect(vi.mocked(saveSong).mock.calls[0]![1]).toBeUndefined();
    expect(screen.queryByTestId("editor")).toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("Open files with one unreadable file saves the other, summarises 1 of 2 and names the failure", async () => {
    mockSaves(["first"]);
    vi.mocked(pickSongFiles).mockResolvedValue(["/m/first.txt", "/m/bad.txt"]);
    vi.mocked(readTextFile).mockImplementation((path) =>
      path.endsWith("bad.txt")
        ? Promise.reject(new FileReadError("NotUtf8", "not valid UTF-8"))
        : Promise.resolve(EN_SHEET),
    );
    await renderDb();

    fireEvent.click(screen.getByTestId("open-files"));

    await waitFor(() =>
      expect(screen.getByTestId("import-summary").textContent).toBe(
        "Imported 1 of 2 files",
      ),
    );
    expect(saveSong).toHaveBeenCalledTimes(1);
    expect(vi.mocked(saveSong).mock.calls[0]![0]).toBe(
      "{title: first}\n[Am]Walking [G]down the lane\n",
    );
    const failed = screen.getAllByTestId("import-failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]!.textContent).toContain("bad.txt");
    expect(failed[0]!.textContent).toContain("not valid UTF-8");
    expect(
      within(screen.getByTestId("import-converted")).getByText("first.txt"),
    );
    expect(screen.queryByTestId("editor")).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId("song-title").textContent).toBe("first"),
    );
  });

  it("Open files saves the English sheet at once and queues the Hebrew one; Flip then Save adds the second save", async () => {
    mockSaves(["en", "he"]);
    vi.mocked(pickSongFiles).mockResolvedValue(["/m/en.txt", "/m/he.txt"]);
    vi.mocked(readTextFile).mockImplementation((path) =>
      Promise.resolve(path.endsWith("he.txt") ? HE_SHEET : EN_SHEET),
    );
    await renderDb();

    fireEvent.click(screen.getByTestId("open-files"));

    // The queued file opens on the Visual tab, with Flip available.
    const visual = await screen.findByTestId("editor-visual");
    expect(screen.getByTestId("editor-tab-visual")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      visual.querySelectorAll('[data-testid="visual-line"][data-kind="lyric"]'),
    ).toHaveLength(1);
    expect(screen.getByTestId("editor-flip")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("editor-tab-source"));
    const input = screen.getByTestId<HTMLTextAreaElement>("editor-input");
    expect(saveSong).toHaveBeenCalledTimes(1);
    expect(vi.mocked(saveSong).mock.calls[0]![0]).toBe(
      "{title: en}\n[Am]Walking [G]down the lane\n",
    );
    expect(screen.getByTestId("reviewing-file").textContent).toContain(
      "he.txt",
    );
    expect(screen.getByTestId("import-queued").textContent).toBe(
      "1 file needs review",
    );
    expect(screen.getByTestId("import-summary").textContent).toBe(
      "Imported 1 of 2 files",
    );
    const mirrored = input.value;
    expect(mirrored.startsWith("{title: he}\n")).toBe(true);

    fireEvent.click(screen.getByTestId("editor-flip"));
    const flipped = `{title: he}\n${HE_LOGICAL}\n`;
    expect(input.value).toBe(flipped);
    expect(input.value).not.toBe(mirrored);
    expect(saveSong).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("editor-save"));
    await waitFor(() => expect(saveSong).toHaveBeenCalledTimes(2));
    expect(vi.mocked(saveSong).mock.calls[1]![0]).toBe(flipped);
    await waitFor(() => expect(screen.queryByTestId("editor")).toBeNull());
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("Edit, change, pick another song, confirm Discard leaves the editor without saving", async () => {
    await renderDb();
    await waitFor(() =>
      expect(screen.getByTestId("song-title").textContent).toBe("Alpha"),
    );

    fireEvent.click(screen.getByTestId("edit-song"));
    fireEvent.click(await screen.findByTestId("editor-tab-source"));
    const input = screen.getByTestId<HTMLTextAreaElement>("editor-input");
    expect(input.value).toBe(db.get("a"));
    fireEvent.change(input, { target: { value: `${db.get("a")!} edited` } });

    fireEvent.click(screen.getAllByTestId("song-item")[1]!);
    await screen.findByTestId("confirm-keep");
    expect(screen.getByTestId("editor")).toBeTruthy();
    fireEvent.click(screen.getByTestId("confirm-discard-yes"));

    await waitFor(() =>
      expect(screen.getByTestId("song-title").textContent).toBe("Beta"),
    );
    expect(screen.queryByTestId("editor")).toBeNull();
    expect(screen.queryByTestId("confirm-keep")).toBeNull();
    expect(saveSong).not.toHaveBeenCalled();
  });
});
