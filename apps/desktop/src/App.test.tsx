import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { parseSong, viewSong } from "chord-core";
import type { SongModel } from "chord-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { loadLibrary } from "./library";
import { pickSongFiles, readTextFile, saveExportDocx } from "./files";
import {
  addSetlistItems,
  createSetlist,
  deleteSetlist,
  deleteSong,
  duplicateSetlist,
  getSetlist,
  getSong,
  listSetlists,
  listSongs,
  reorderSetlistItems,
  saveSong,
  searchSongs,
  updateSetlistItem,
} from "./storage";
import type {
  SearchHit,
  Setlist,
  SetlistSummary,
  Song,
  SongSummary,
} from "./storage";
import { STRINGS } from "./strings";
import { signalUiReady } from "./uiReady";

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
vi.mock("./files", () => ({
  extractDocument: vi.fn(),
  pickDocumentFile: vi.fn(),
  pickSongFiles: vi.fn(),
  readTextFile: vi.fn(),
  saveExportDocx: vi.fn(),
}));

/** Bundled mode: the library cannot be listed. Resolves once the list is shown. */
async function renderBundled() {
  vi.mocked(listSongs).mockRejectedValue(new Error("unavailable"));
  render(<App />);
  await screen.findAllByTestId("song-item");
}

function summary(id: string, title: string, artist: string | null = null) {
  return {
    id,
    title,
    artist,
    key: null,
    language: "en",
    updatedAt: "2026-01-01T00:00:00Z",
  } as SongSummary;
}

function stored(id: string, chordpro: string): Song {
  return { id, chordpro, createdAt: "", updatedAt: "" } as unknown as Song;
}

const DB_SONGS: Record<string, string> = {
  b: "{title: Beta}\n{key: Am}\n{capo: 2}\n[Am]Beta [G]line",
  a: "{title: Alpha}\n{key: C}\n[C]Alpha [F]line",
  c: "{title: שיר}\n[C]שלום",
};
const DB_LIST = [
  summary("b", "Beta", "Bea"),
  summary("a", "Alpha"),
  summary("c", "שיר"),
];

function useDb() {
  vi.mocked(listSongs).mockResolvedValue(DB_LIST);
  vi.mocked(getSong).mockImplementation((id) =>
    Promise.resolve(stored(id, DB_SONGS[id]!)),
  );
}

function titles(): string[] {
  return screen
    .getAllByTestId("song-item")
    .map((el) => el.querySelector("span")?.textContent ?? "");
}

function hit(id: string, title: string, snippet: string | null): SearchHit {
  return { song: summary(id, title), snippet };
}

function byId(id: string) {
  const entry = loadLibrary().find((s) => s.id === id);
  if (!entry) throw new Error(`missing ${id}`);
  return entry;
}

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

function pickSong(id: string) {
  const index = loadLibrary().findIndex((s) => s.id === id);
  fireEvent.click(screen.getAllByTestId("song-item")[index]!);
}

describe("App", () => {
  beforeEach(() => {
    vi.mocked(signalUiReady).mockClear();
    vi.mocked(listSongs).mockReset();
    vi.mocked(getSong).mockReset();
    vi.mocked(searchSongs).mockReset();
  });

  it("renders the Shir heading", async () => {
    await renderBundled();
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("Shir · שיר");
    expect(h1).toHaveAttribute("data-ui-chrome");
    expect(h1.querySelector("bdi")).toHaveAttribute("lang", "he");
  });

  it("lists every library song with the first selected", async () => {
    await renderBundled();
    const items = screen.getAllByTestId("song-item");
    expect(items).toHaveLength(loadLibrary().length);
    expect(items[0]).toHaveAttribute("aria-current", "true");
    expect(items[1]).not.toHaveAttribute("aria-current");
  });

  it("shows the first song's header initially", async () => {
    await renderBundled();
    expect(screen.getByTestId("song-title").textContent).toBe(
      "שיר הדגמה / Demo Song",
    );
    expect(screen.getByTestId("song-artist").textContent).toBe("Shir demo");
    expect(screen.getByTestId("sounding-key").textContent).toBe("Am");
  });

  it("selecting a song updates the header and capo", async () => {
    await renderBundled();
    pickSong("test-songs:sections_he");
    const entry = byId("test-songs:sections_he");
    expect(screen.getByTestId("song-title").textContent).toBe(entry.title);
    expect(screen.getByTestId("capo-select")).toHaveValue("2");
    expect(screen.getByTestId("capo-value").textContent).toBe("2");
  });

  it("switching to a capo-less song resets capo to 0", async () => {
    const lib = loadLibrary();
    const withCapo = lib.find((s) => s.song.capo === 2);
    const without = lib.find((s) => s.song.capo === undefined);
    expect(withCapo).toBeDefined();
    expect(without).toBeDefined();
    await renderBundled();
    pickSong(withCapo!.id);
    expect(screen.getByTestId("capo-select")).toHaveValue("2");
    pickSong(without!.id);
    expect(screen.getByTestId("capo-select")).toHaveValue("0");
    expect(screen.queryByTestId("capo-value")).toBeNull();
  });

  it("transpose +1 renders the chords viewSong predicts", async () => {
    await renderBundled();
    const entry = byId("samples:demo-shir-bilingual");
    const before = renderedChords();
    fireEvent.click(screen.getByTestId("transpose-up"));
    const expected = modelChords(
      viewSong(entry.song, { transpose: 1, capo: entry.song.capo ?? 0 }).song,
    );
    expect(expected.length).toBeGreaterThan(0);
    expect(renderedChords()).toEqual(expected);
    expect(renderedChords()).not.toEqual(before);
    expect(screen.getByTestId("transpose-value").textContent).toBe("+1");
  });

  it("capo changes update the shape key", async () => {
    await renderBundled();
    const entry = byId("samples:demo-shir-bilingual");
    const shape = (capo: number) =>
      viewSong(entry.song, { transpose: 0, capo }).shapeKey;
    expect(screen.getByTestId("shape-key").textContent).toBe(shape(0));
    fireEvent.change(screen.getByTestId("capo-select"), {
      target: { value: "3" },
    });
    expect(shape(3)).not.toBe(shape(0));
    expect(screen.getByTestId("shape-key").textContent).toBe(shape(3));
    expect(screen.getByTestId("capo-value").textContent).toBe("3");
  });

  it("Reset restores transpose and the song's capo", async () => {
    await renderBundled();
    pickSong("test-songs:sections_he");
    fireEvent.click(screen.getByTestId("transpose-up"));
    fireEvent.change(screen.getByTestId("capo-select"), {
      target: { value: "5" },
    });
    fireEvent.click(screen.getByTestId("reset-view"));
    expect(screen.getByTestId("transpose-value").textContent).toBe("0");
    expect(screen.getByTestId("capo-select")).toHaveValue("2");
  });

  it("switching songs resets transpose", async () => {
    await renderBundled();
    fireEvent.click(screen.getByTestId("transpose-up"));
    expect(screen.getByTestId("transpose-value").textContent).toBe("+1");
    pickSong("test-songs:en_plain");
    expect(screen.getByTestId("transpose-value").textContent).toBe("0");
  });

  it("malformed_input shows parse and view diagnostics", async () => {
    await renderBundled();
    pickSong("test-songs:malformed_input");
    const entry = byId("test-songs:malformed_input");
    const view = viewSong(entry.song, {
      transpose: 0,
      capo: entry.song.capo ?? 0,
    });
    const panel = screen.getByTestId("diagnostics");
    expect(within(panel).getAllByTestId("diagnostic-item")).toHaveLength(
      entry.diagnostics.length + view.diagnostics.length,
    );
    expect(entry.diagnostics.length).toBeGreaterThan(0);
  });

  it("slash_chords_key shows parse plus view diagnostics", async () => {
    await renderBundled();
    pickSong("test-songs:slash_chords_key");
    const entry = byId("test-songs:slash_chords_key");
    const view = viewSong(entry.song, { capo: entry.song.capo ?? 0 });
    expect(view.diagnostics.length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("diagnostic-item")).toHaveLength(
      entry.diagnostics.length + view.diagnostics.length,
    );
  });

  it("signals UI ready once after mount", async () => {
    await renderBundled();
    fireEvent.click(screen.getByTestId("transpose-up"));
    expect(signalUiReady).toHaveBeenCalledTimes(1);
  });

  it("does not mutate library songs when transposing", async () => {
    const before = structuredClone(loadLibrary());
    await renderBundled();
    fireEvent.click(screen.getByTestId("transpose-up"));
    fireEvent.click(screen.getByTestId("transpose-up"));
    expect(loadLibrary()).toEqual(before);
  });
});

describe("App bundled fallback", () => {
  beforeEach(() => {
    vi.mocked(listSongs).mockReset();
    vi.mocked(getSong).mockReset();
    vi.mocked(searchSongs).mockReset();
  });

  it("shows loading text and the empty pane while listSongs is pending", async () => {
    vi.mocked(listSongs).mockReturnValue(new Promise(() => undefined));
    render(<App />);
    expect(screen.getByText(STRINGS.loadingLibrary)).toHaveAttribute(
      "data-ui-chrome",
    );
    expect(screen.getByTestId("song-pane").textContent).toBe(
      STRINGS.noSongSelected,
    );
    expect(listSongs).toHaveBeenCalledTimes(1);
  });

  it("falls back with a notice, a disabled box and no storage calls", async () => {
    await renderBundled();
    expect(screen.getByTestId("search-input")).toBeDisabled();
    expect(screen.getByTestId("search-unavailable").textContent).toBe(
      STRINGS.searchUnavailable,
    );
    expect(screen.getByTestId("search-input")).toHaveAttribute(
      "data-ui-chrome",
    );
    expect(screen.getByTestId("search-unavailable")).toHaveAttribute(
      "data-ui-chrome",
    );
    expect(getSong).not.toHaveBeenCalled();
    expect(searchSongs).not.toHaveBeenCalled();
    expect(screen.getAllByRole("navigation")).toHaveLength(1);
    expect(screen.queryByTestId("song-index")).toBeNull();
  });
});

describe("App database mode", () => {
  beforeEach(() => {
    vi.mocked(signalUiReady).mockClear();
    vi.mocked(listSongs).mockReset();
    vi.mocked(getSong).mockReset();
    vi.mocked(searchSongs).mockReset();
    useDb();
  });

  async function renderDb() {
    render(<App />);
    await screen.findByTestId("song-index");
    await screen.findByTestId("song-title");
  }

  it("lists songs sorted by title, selects and renders the first", async () => {
    await renderDb();
    expect(listSongs).toHaveBeenCalledTimes(1);
    expect(titles()).toEqual(["שיר", "Alpha", "Beta"]);
    expect(screen.getAllByTestId("song-item")[0]).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(getSong).toHaveBeenCalledExactlyOnceWith("c");
    expect(screen.getByTestId("song-title").textContent).toBe("שיר");
    expect(screen.getByTestId("search-input")).toBeEnabled();
    expect(screen.queryByTestId("search-unavailable")).toBeNull();
    expect(screen.getAllByRole("navigation")).toHaveLength(1);
    expect(screen.getByRole("navigation")).toHaveAttribute(
      "aria-label",
      STRINGS.songList,
    );
    expect(signalUiReady).toHaveBeenCalledTimes(1);
  });

  it("selecting a song loads it, applies its capo and resets transpose", async () => {
    await renderDb();
    fireEvent.click(screen.getByTestId("transpose-up"));
    fireEvent.click(screen.getByText("Beta"));
    await waitFor(() =>
      expect(screen.getByTestId("song-title").textContent).toBe("Beta"),
    );
    expect(getSong).toHaveBeenLastCalledWith("b");
    expect(screen.getByTestId("capo-select")).toHaveValue("2");
    expect(screen.getByTestId("transpose-value").textContent).toBe("0");
    expect(screen.getByTestId("song-artist").textContent).toBe("Bea");
    const view = viewSong(
      {
        ...parseFor("b"),
      },
      { transpose: 0, capo: 2 },
    );
    expect(renderedChords()).toEqual(modelChords(view.song));
    fireEvent.click(screen.getByText("Alpha"));
    await waitFor(() =>
      expect(screen.getByTestId("capo-select")).toHaveValue("0"),
    );
  });

  it("shows libraryEmpty for an empty list", async () => {
    vi.mocked(listSongs).mockResolvedValue([]);
    render(<App />);
    expect(await screen.findByText(STRINGS.libraryEmpty)).toBeInTheDocument();
    expect(getSong).not.toHaveBeenCalled();
    expect(screen.getByTestId("search-input")).toBeEnabled();
  });

  it("shows songLoadFailed with role=alert when getSong fails", async () => {
    vi.mocked(getSong).mockRejectedValue(new Error("nope"));
    render(<App />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(STRINGS.songLoadFailed);
    expect(screen.getByTestId("song-pane")).toContainElement(alert);
  });

  it("ignores a stale getSong response that resolves last", async () => {
    await renderDb();
    let resolveBeta!: (s: Song) => void;
    let resolveAlpha!: (s: Song) => void;
    vi.mocked(getSong).mockImplementation((id) =>
      id === "b"
        ? new Promise<Song>((r) => (resolveBeta = r))
        : new Promise<Song>((r) => (resolveAlpha = r)),
    );
    fireEvent.click(screen.getByText("Beta"));
    fireEvent.click(screen.getByText("Alpha"));
    resolveAlpha(stored("a", DB_SONGS.a!));
    await waitFor(() =>
      expect(screen.getByTestId("song-title").textContent).toBe("Alpha"),
    );
    resolveBeta(stored("b", DB_SONGS.b!));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId("song-title").textContent).toBe("Alpha");
    expect(screen.getByTestId("capo-select")).toHaveValue("0");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("ignores a stale getSong rejection that settles after a newer song loaded", async () => {
    await renderDb();
    let rejectAlpha!: (e: Error) => void;
    vi.mocked(getSong).mockImplementation((id) =>
      id === "a"
        ? new Promise<Song>((_ok, fail) => (rejectAlpha = fail))
        : Promise.resolve(stored(id, DB_SONGS[id]!)),
    );
    fireEvent.click(screen.getByText("Alpha"));
    fireEvent.click(screen.getByText("Beta"));
    await waitFor(() =>
      expect(screen.getByTestId("song-title").textContent).toBe("Beta"),
    );
    rejectAlpha(new Error("late failure"));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId("song-title").textContent).toBe("Beta");
    expect(screen.queryByText(STRINGS.songLoadFailed)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("passes a search hit missing from the library to the header", async () => {
    await renderDb();
    vi.mocked(getSong).mockImplementation((id) =>
      Promise.resolve(
        stored(
          id,
          id === "z" ? "{title: Stored Title}\n[C]Zeta" : DB_SONGS[id]!,
        ),
      ),
    );
    vi.mocked(searchSongs).mockResolvedValue([
      { song: summary("z", "Zeta Hit", "Zed Artist"), snippet: null },
    ]);
    fireEvent.change(screen.getByTestId("search-input"), {
      target: { value: "zeta" },
    });
    await screen.findByTestId("search-results");
    fireEvent.click(screen.getByText("Zeta Hit"));
    await waitFor(() =>
      expect(screen.getByTestId("song-title").textContent).toBe("Zeta Hit"),
    );
    expect(screen.getByTestId("song-artist").textContent).toBe("Zed Artist");
  });

  it("selects the bundled-first song's title match on launch", async () => {
    const demo = loadLibrary()[0]!;
    vi.mocked(listSongs).mockResolvedValue([
      ...DB_LIST,
      summary("demo-db", demo.title),
    ]);
    vi.mocked(getSong).mockImplementation((id) =>
      Promise.resolve(
        stored(id, id === "demo-db" ? "{title: Demo}\n[C]x" : DB_SONGS[id]!),
      ),
    );
    render(<App />);
    await screen.findByTestId("song-title");
    expect(getSong).toHaveBeenCalledExactlyOnceWith("demo-db");
    const current = screen
      .getAllByTestId("song-item")
      .filter((el) => el.getAttribute("aria-current") === "true");
    expect(current).toHaveLength(1);
    expect(current[0]!.textContent).toContain(demo.title);
  });

  it("falls back to the first sorted song when no title matches", async () => {
    await renderDb();
    expect(getSong).toHaveBeenCalledExactlyOnceWith("c");
  });

  describe("search pending status", () => {
    function pending() {
      return screen.getByTestId("search-pending");
    }

    it("is a persistent empty polite live region hidden in print", async () => {
      await renderDb();
      expect(pending()).toHaveAttribute("role", "status");
      expect(pending()).toHaveAttribute("data-ui-chrome");
      expect(pending().textContent).toBe("");
    });

    it("is absent in bundled mode", async () => {
      await renderBundled();
      expect(screen.queryByTestId("search-pending")).toBeNull();
    });

    it("says Searching while debouncing and loading, then clears on results", async () => {
      await renderDb();
      let resolve!: (h: SearchHit[]) => void;
      vi.mocked(searchSongs).mockImplementation(
        () => new Promise<SearchHit[]>((r) => (resolve = r)),
      );
      fireEvent.change(screen.getByTestId("search-input"), {
        target: { value: "line" },
      });
      expect(pending().textContent).toBe(STRINGS.searching);
      await waitFor(() => expect(searchSongs).toHaveBeenCalledTimes(1));
      expect(pending().textContent).toBe(STRINGS.searching);
      resolve([hit("a", "Alpha", null)]);
      await screen.findByTestId("search-results");
      expect(pending().textContent).toBe("");
      expect(screen.getByTestId("search-results")).not.toHaveAttribute(
        "aria-busy",
      );
    });

    it("keeps previous results visible and busy while a new query is pending", async () => {
      await renderDb();
      vi.mocked(searchSongs).mockResolvedValue([hit("a", "Alpha", null)]);
      const input = screen.getByTestId("search-input");
      fireEvent.change(input, { target: { value: "alp" } });
      await screen.findByTestId("search-results");
      expect(pending().textContent).toBe("");

      let resolve!: (h: SearchHit[]) => void;
      vi.mocked(searchSongs).mockImplementation(
        () => new Promise<SearchHit[]>((r) => (resolve = r)),
      );
      fireEvent.change(input, { target: { value: "alph" } });
      expect(pending().textContent).toBe(STRINGS.searching);
      expect(screen.getByTestId("search-results")).toHaveAttribute(
        "aria-busy",
        "true",
      );
      expect(titles()).toEqual(["Alpha"]);
      await waitFor(() => expect(searchSongs).toHaveBeenCalledTimes(2));
      expect(screen.getByTestId("search-results")).toHaveAttribute(
        "aria-busy",
        "true",
      );
      resolve([hit("a", "Alpha", null)]);
      await waitFor(() => expect(pending().textContent).toBe(""));
      expect(screen.getByTestId("search-results")).not.toHaveAttribute(
        "aria-busy",
      );
    });

    it("clears when the query is cleared, on no results and on an error", async () => {
      await renderDb();
      const input = screen.getByTestId("search-input");
      fireEvent.change(input, { target: { value: "x" } });
      expect(pending().textContent).toBe(STRINGS.searching);
      fireEvent.change(input, { target: { value: "" } });
      expect(pending().textContent).toBe("");

      vi.mocked(searchSongs).mockResolvedValue([]);
      fireEvent.change(input, { target: { value: "zzz" } });
      await screen.findByTestId("search-empty");
      expect(pending().textContent).toBe("");

      vi.mocked(searchSongs).mockRejectedValue(new Error("fts"));
      fireEvent.change(input, { target: { value: "boom" } });
      await waitFor(() =>
        expect(
          within(screen.getByRole("navigation")).getByRole("alert"),
        ).toBeInTheDocument(),
      );
      expect(pending().textContent).toBe("");
    });
  });

  it("replaces the list with ranked hits, keeps the query on select, Esc restores", async () => {
    await renderDb();
    vi.mocked(searchSongs).mockResolvedValue([
      hit("c", "שיר", "שלום עולם"),
      hit("b", "Beta", null),
    ]);
    const input = screen.getByTestId("search-input");
    fireEvent.change(input, { target: { value: "  line " } });
    const results = await screen.findByTestId("search-results");
    expect(searchSongs).toHaveBeenCalledExactlyOnceWith("line");
    expect(screen.queryByTestId("song-index")).toBeNull();
    expect(results).toHaveAttribute("aria-label", STRINGS.searchResults);
    expect(titles()).toEqual(["שיר", "Beta"]);
    expect(screen.getByTestId("song-snippet").textContent).toBe("שלום עולם");

    fireEvent.click(screen.getByText("Beta"));
    await waitFor(() =>
      expect(screen.getByTestId("song-title").textContent).toBe("Beta"),
    );
    expect(input).toHaveValue("  line ");
    expect(screen.getByTestId("search-results")).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveValue("");
    expect(screen.getByTestId("song-index")).toBeInTheDocument();
    expect(screen.queryByTestId("search-results")).toBeNull();
    expect(titles()).toEqual(["שיר", "Alpha", "Beta"]);
  });

  it("clearing the query by typing restores the full list", async () => {
    await renderDb();
    vi.mocked(searchSongs).mockResolvedValue([hit("a", "Alpha", null)]);
    const input = screen.getByTestId("search-input");
    fireEvent.change(input, { target: { value: "alp" } });
    await screen.findByTestId("search-results");
    fireEvent.change(input, { target: { value: "" } });
    expect(screen.getByTestId("song-index")).toBeInTheDocument();
  });

  it("shows noResults for zero hits", async () => {
    await renderDb();
    vi.mocked(searchSongs).mockResolvedValue([]);
    fireEvent.change(screen.getByTestId("search-input"), {
      target: { value: "zzz" },
    });
    const empty = await screen.findByTestId("search-empty");
    expect(empty.textContent).toBe(STRINGS.noResults);
    expect(screen.queryByTestId("song-index")).toBeNull();
  });

  it("shows searchFailed with role=alert on a search error", async () => {
    await renderDb();
    vi.mocked(searchSongs).mockRejectedValue(new Error("fts"));
    fireEvent.change(screen.getByTestId("search-input"), {
      target: { value: "x" },
    });
    await waitFor(() =>
      expect(
        within(screen.getByRole("navigation")).getByRole("alert").textContent,
      ).toBe(STRINGS.searchFailed),
    );
  });
});

function parseFor(id: string) {
  return parseSong(DB_SONGS[id]!).song;
}

describe("App editor", () => {
  const HE_SHEET = "Am      G\nשלום עולם יפה";
  const HE_MIRROR = "שלום [G]עולם י[Am]פה";
  const HE_LOGICAL = "[Am]שלום עול[G]ם יפה";

  beforeEach(() => {
    vi.mocked(listSongs).mockReset();
    vi.mocked(getSong).mockReset();
    vi.mocked(searchSongs).mockReset();
    vi.mocked(saveSong).mockReset();
    vi.mocked(pickSongFiles).mockReset();
    vi.mocked(readTextFile).mockReset();
    DB_SONGS.n = "{title: Saved}\n[C]x";
    useDb();
  });

  afterEach(() => {
    delete DB_SONGS.n;
    vi.restoreAllMocks();
  });

  async function renderDb() {
    render(<App />);
    await screen.findByTestId("song-index");
    await screen.findByTestId("song-title");
  }

  /** The ChordPro text area; the editor opens on the Visual tab, so this selects the Source tab first. */
  const editor = () => {
    fireEvent.click(screen.getByTestId("editor-tab-source"));
    return screen.getByTestId("editor-input") as HTMLTextAreaElement;
  };
  const withSaved = () =>
    vi.mocked(listSongs).mockResolvedValue([...DB_LIST, summary("n", "Saved")]);

  function saveReturns(chordpro: string) {
    withSaved();
    vi.mocked(saveSong).mockResolvedValue(stored("n", chordpro) as never);
  }

  it("renders none of the editor entry points in bundled mode", async () => {
    await renderBundled();
    expect(screen.queryByTestId("new-song")).toBeNull();
    expect(screen.queryByTestId("open-files")).toBeNull();
    expect(screen.queryByTestId("edit-song")).toBeNull();
  });

  it("New song, type, Save calls saveSong and shows the saved song", async () => {
    await renderDb();
    saveReturns("{title: Saved}\n[C]x");
    fireEvent.click(screen.getByTestId("new-song"));
    expect(editor().value).toBe("");
    fireEvent.change(editor(), { target: { value: "{title: Saved}\n[C]x" } });
    fireEvent.click(screen.getByTestId("editor-save"));
    await waitFor(() =>
      expect(screen.getByTestId("song-title").textContent).toBe("Saved"),
    );
    expect(saveSong).toHaveBeenCalledTimes(1);
    expect(vi.mocked(saveSong).mock.calls[0]![0]).toBe("{title: Saved}\n[C]x");
    expect(vi.mocked(saveSong).mock.calls[0]![1]).toBeUndefined();
    expect(screen.queryByTestId("editor")).toBeNull();
    expect(titles()).toContain("Saved");
    expect(getSong).toHaveBeenLastCalledWith("n");
  });

  it("Edit loads the selected song's chordpro and saves with its id", async () => {
    await renderDb();
    fireEvent.click(screen.getByTestId("edit-song"));
    await waitFor(() => expect(editor().value).toBe(DB_SONGS.c));
    vi.mocked(saveSong).mockResolvedValue(
      stored("c", "{title: שיר}\n[C]x") as never,
    );
    fireEvent.change(editor(), { target: { value: "{title: שיר}\n[C]x" } });
    fireEvent.click(screen.getByTestId("editor-save"));
    await waitFor(() => expect(screen.queryByTestId("editor")).toBeNull());
    expect(vi.mocked(saveSong).mock.calls[0]).toEqual([
      "{title: שיר}\n[C]x",
      "c",
    ]);
  });

  it("a save failure shows the message and keeps the editor open and dirty", async () => {
    await renderDb();
    vi.mocked(saveSong).mockRejectedValue(new Error("disk full"));
    fireEvent.click(screen.getByTestId("new-song"));
    fireEvent.change(editor(), { target: { value: "abc" } });
    fireEvent.click(screen.getByTestId("editor-save"));
    const alert = await screen.findByTestId("editor-save-error");
    expect(alert.textContent).toBe(`${STRINGS.saveFailed}: disk full`);
    expect(editor().value).toBe("abc");
    fireEvent.click(screen.getByText("Alpha"));
    expect(screen.getByTestId("confirm-discard")).toBeInTheDocument();
  });

  it("dirty editor asks before switching songs", async () => {
    const confirm = vi.spyOn(window, "confirm");
    await renderDb();
    fireEvent.click(screen.getByTestId("new-song"));
    fireEvent.change(editor(), { target: { value: "typed" } });
    fireEvent.click(screen.getByText("Alpha"));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("confirm-keep"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(editor().value).toBe("typed");

    fireEvent.click(screen.getByText("Alpha"));
    fireEvent.click(screen.getByTestId("confirm-discard-yes"));
    await waitFor(() =>
      expect(screen.getByTestId("song-title").textContent).toBe("Alpha"),
    );
    expect(screen.queryByTestId("editor")).toBeNull();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("a clean editor leaves without a confirm", async () => {
    await renderDb();
    fireEvent.click(screen.getByTestId("new-song"));
    fireEvent.click(screen.getByText("Alpha"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId("song-title").textContent).toBe("Alpha"),
    );
  });

  it("Cancel and New song also ask when dirty", async () => {
    await renderDb();
    fireEvent.click(screen.getByTestId("new-song"));
    fireEvent.change(editor(), { target: { value: "typed" } });
    fireEvent.click(screen.getByTestId("editor-cancel"));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("confirm-keep"));
    fireEvent.click(screen.getByTestId("new-song"));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("imports ChordPro files at once and summarises", async () => {
    await renderDb();
    withSaved();
    vi.mocked(pickSongFiles).mockResolvedValue(["/a/one.cho", "/a/bad.cho"]);
    vi.mocked(readTextFile).mockImplementation((path) =>
      path.endsWith("bad.cho")
        ? Promise.reject(new Error("not utf8"))
        : Promise.resolve("{title: Saved}\n[C]x"),
    );
    vi.mocked(saveSong).mockResolvedValue(stored("n", "x") as never);
    fireEvent.click(screen.getByTestId("open-files"));
    const summary = await screen.findByTestId("import-summary");
    expect(summary.textContent).toBe("Imported 1 of 2 files");
    expect(screen.getByTestId("import-failed").textContent).toContain(
      "bad.cho",
    );
    expect(screen.getByTestId("import-failed").textContent).toContain(
      "not utf8",
    );
    await waitFor(() =>
      expect(screen.getByTestId("song-title").textContent).toBe("Saved"),
    );
    expect(screen.queryByTestId("editor")).toBeNull();
  });

  it("an empty pick shows nothing", async () => {
    await renderDb();
    vi.mocked(pickSongFiles).mockResolvedValue([]);
    fireEvent.click(screen.getByTestId("open-files"));
    await waitFor(() => expect(pickSongFiles).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("open-files")).toBeEnabled());
    expect(screen.queryByTestId("import-report")).toBeNull();
    expect(screen.queryByTestId("editor")).toBeNull();
  });

  it("review queue: queued Hebrew file saves only on Save with flipped text and fallback title", async () => {
    await renderDb();
    saveReturns("x");
    vi.mocked(pickSongFiles).mockResolvedValue(["C:\\songs\\shalom.txt"]);
    vi.mocked(readTextFile).mockResolvedValue(HE_SHEET);
    fireEvent.click(screen.getByTestId("open-files"));
    await screen.findByTestId("editor");
    expect(screen.getByTestId("editor-tab-visual")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("editor-visual")).toBeInTheDocument();
    expect(editor().value).toBe(`{title: shalom}\n${HE_MIRROR}`);
    expect(screen.getByTestId("reviewing-file").textContent).toContain(
      "shalom.txt",
    );
    expect(screen.getByTestId("import-queued").textContent).toBe(
      "1 file needs alignment review",
    );
    expect(saveSong).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("editor-flip"));
    expect(editor().value).toBe(`{title: shalom}\n${HE_LOGICAL}`);
    expect(saveSong).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("editor-save"));
    await waitFor(() => expect(screen.queryByTestId("editor")).toBeNull());
    expect(saveSong).toHaveBeenCalledTimes(1);
    const text = vi.mocked(saveSong).mock.calls[0]![0];
    expect(text).toBe(`{title: shalom}\n${HE_LOGICAL}`);
    expect(text.startsWith("{title: shalom}")).toBe(true);
  });

  it("review queue: Cancel skips a file, lists it and opens the next", async () => {
    await renderDb();
    saveReturns("x");
    vi.mocked(pickSongFiles).mockResolvedValue([
      "/a/first.txt",
      "/a/second.txt",
    ]);
    vi.mocked(readTextFile).mockResolvedValue(HE_SHEET);
    fireEvent.click(screen.getByTestId("open-files"));
    await screen.findByTestId("editor");
    expect(screen.getByTestId("reviewing-file").textContent).toContain(
      "first.txt",
    );

    fireEvent.click(screen.getByTestId("editor-cancel"));
    fireEvent.click(screen.getByTestId("confirm-discard-yes"));
    await waitFor(() =>
      expect(screen.getByTestId("reviewing-file").textContent).toContain(
        "second.txt",
      ),
    );
    expect(screen.getByTestId("import-skipped").textContent).toContain(
      "first.txt",
    );

    fireEvent.click(screen.getByTestId("editor-save"));
    await waitFor(() => expect(screen.queryByTestId("editor")).toBeNull());
    expect(saveSong).toHaveBeenCalledTimes(1);
  });

  it("lists converted LTR files that were saved at once", async () => {
    await renderDb();
    withSaved();
    vi.mocked(pickSongFiles).mockResolvedValue(["/a/eng.txt"]);
    vi.mocked(readTextFile).mockResolvedValue("Am      G\nhello big world");
    vi.mocked(saveSong).mockResolvedValue(stored("n", "x") as never);
    fireEvent.click(screen.getByTestId("open-files"));
    const converted = await screen.findByTestId("import-converted");
    expect(converted.textContent).toContain("eng.txt");
    expect(screen.queryByTestId("import-queued")).toBeNull();
  });
});

describe("App setlists (database mode)", () => {
  /** In-memory stand-in for the setlist commands. */
  let current: Setlist | undefined;
  let counter: number;

  const item = (songId: string): Setlist["items"][number] => ({
    id: `i${++counter}`,
    songId,
    position: 0,
    transpose: 0,
    capo: null,
    title: songId,
    artist: null,
    key: null,
    songCapo: null,
    language: "en",
  });
  const setItems = (items: Setlist["items"]): Setlist => {
    current = { ...current!, items };
    return current;
  };
  const summaries = (): SetlistSummary[] =>
    current === undefined
      ? []
      : [
          {
            id: current.id,
            name: current.name,
            itemCount: current.items.length,
            updatedAt: "",
          },
        ];

  beforeEach(() => {
    current = undefined;
    counter = 0;
    vi.mocked(signalUiReady).mockClear();
    vi.mocked(listSongs).mockReset();
    vi.mocked(getSong).mockReset();
    vi.mocked(searchSongs).mockReset();
    useDb();
    vi.mocked(listSetlists).mockImplementation(() =>
      Promise.resolve(summaries()),
    );
    vi.mocked(getSetlist).mockImplementation(() => Promise.resolve(current!));
    vi.mocked(createSetlist).mockImplementation((name) => {
      current = {
        id: "sl1",
        name,
        createdAt: "",
        updatedAt: "",
        items: [],
      };
      return Promise.resolve(current);
    });
    vi.mocked(addSetlistItems).mockImplementation((_id, songIds) =>
      Promise.resolve(setItems([...current!.items, ...songIds.map(item)])),
    );
    vi.mocked(reorderSetlistItems).mockImplementation((_id, order) =>
      Promise.resolve(
        setItems(order.map((id) => current!.items.find((i) => i.id === id)!)),
      ),
    );
    vi.mocked(updateSetlistItem).mockImplementation(
      (_id, itemId, transpose, capo) =>
        Promise.resolve(
          setItems(
            current!.items.map((i) =>
              i.id === itemId ? { ...i, transpose, capo } : i,
            ),
          ),
        ),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a setlist, adds two songs, moves one, transposes one and prints", async () => {
    render(<App />);
    await screen.findByTestId("song-title");
    expect(listSetlists).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("tab-songs")).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // Create from the Setlists tab; the new setlist opens in the main pane.
    fireEvent.click(screen.getByTestId("tab-setlists"));
    fireEvent.change(screen.getByTestId("setlist-name-input"), {
      target: { value: "Sunday" },
    });
    fireEvent.click(screen.getByTestId("setlist-create"));
    await screen.findByTestId("setlist-editor");
    expect(createSetlist).toHaveBeenCalledExactlyOnceWith("Sunday");
    expect(screen.queryByTestId("song-title")).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId("setlist-select")).toHaveAttribute(
        "aria-current",
        "true",
      ),
    );

    // Select two songs in select mode and add them in library order.
    fireEvent.click(screen.getByTestId("tab-songs"));
    fireEvent.click(screen.getByTestId("select-songs"));
    const rows = screen.getAllByTestId("song-item");
    expect(rows).toHaveLength(3);
    fireEvent.click(screen.getAllByTestId("song-check")[2]!);
    fireEvent.click(screen.getAllByTestId("song-check")[0]!);
    fireEvent.click(screen.getByTestId("add-selected-to-setlist"));
    fireEvent.click(screen.getAllByTestId("add-to-setlist-option")[0]!);
    fireEvent.click(screen.getByTestId("add-to-setlist-confirm"));
    await waitFor(() => expect(addSetlistItems).toHaveBeenCalledTimes(1));
    expect(addSetlistItems).toHaveBeenCalledWith("sl1", ["c", "b"]);
    await waitFor(() =>
      expect(screen.getAllByTestId("setlist-entry")).toHaveLength(2),
    );
    expect(screen.getByTestId("app-status").textContent).toBe(
      "Added 2 songs to the setlist",
    );
    // Select mode stays as it was.
    expect(screen.getByTestId("selection-count")).toBeInTheDocument();

    // Move the second entry up, then transpose it.
    fireEvent.click(screen.getAllByTestId("setlist-entry-up")[1]!);
    await waitFor(() => expect(reorderSetlistItems).toHaveBeenCalledTimes(1));
    expect(reorderSetlistItems).toHaveBeenCalledWith("sl1", ["i2", "i1"]);
    await waitFor(() =>
      expect(screen.getAllByTestId("setlist-entry-title")[0]!.textContent).toBe(
        "b",
      ),
    );
    fireEvent.click(screen.getAllByTestId("setlist-entry-transpose-up")[0]!);
    await waitFor(() =>
      expect(updateSetlistItem).toHaveBeenCalledWith("sl1", "i2", 1, null),
    );

    // Print: every song is fetched, then the print root is mounted while window.print runs.
    const during: boolean[] = [];
    window.print = vi.fn(() => {
      during.push(document.querySelector("[data-print-container]") !== null);
    }) as unknown as typeof window.print;
    vi.mocked(getSong).mockClear();
    fireEvent.click(screen.getByTestId("setlist-print"));
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1), {
      timeout: 6000,
    });
    expect(during).toEqual([true]);
    expect(getSong).toHaveBeenCalledTimes(2);
  }, 15000);
  /** A setlist with two entries for songs "a" and "b", already stored. */
  function seed() {
    current = {
      id: "sl1",
      name: "Sunday",
      createdAt: "",
      updatedAt: "",
      items: [item("a"), item("b")],
    };
    current.items[0] = { ...current.items[0]!, transpose: 2, capo: 3 };
  }

  async function renderSeeded() {
    seed();
    render(<App />);
    await screen.findByTestId("song-title");
    fireEvent.click(screen.getByTestId("tab-setlists"));
    fireEvent.click(await screen.findByTestId("setlist-select"));
    await screen.findByTestId("setlist-editor");
  }

  it("renders no setlist UI in bundled mode", async () => {
    await renderBundled();
    expect(screen.queryByTestId("sidebar-tabs")).toBeNull();
    expect(screen.queryByTestId("song-add-to-setlist")).toBeNull();
    expect(listSetlists).not.toHaveBeenCalled();
  });

  it("keeps the last state and shows a notice when a call fails", async () => {
    vi.mocked(createSetlist).mockRejectedValue(new Error("boom"));
    render(<App />);
    await screen.findByTestId("song-title");
    fireEvent.click(screen.getByTestId("tab-setlists"));
    fireEvent.change(screen.getByTestId("setlist-name-input"), {
      target: { value: "Sunday" },
    });
    fireEvent.click(screen.getByTestId("setlist-create"));
    expect((await screen.findByTestId("app-notice")).textContent).toBe(
      STRINGS.setlistSaveFailed,
    );
    expect(screen.queryByTestId("setlist-editor")).toBeNull();
  });

  it("opens a song from an entry with its transpose and capo, unsaved", async () => {
    await renderSeeded();
    fireEvent.click(screen.getAllByTestId("setlist-entry-title")[0]!);
    await screen.findByTestId("song-title");
    expect(screen.queryByTestId("setlist-editor")).toBeNull();
    expect(screen.getByTestId("tab-songs")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("capo-select")).toHaveValue("3");
    expect(screen.getByTestId("transpose-value").textContent).toContain("2");
    expect(saveSong).not.toHaveBeenCalled();
  });

  it("re-fetches the open setlist after a song is deleted", async () => {
    await renderSeeded();
    fireEvent.click(screen.getByTestId("tab-songs"));
    fireEvent.click(screen.getByTestId("select-songs"));
    fireEvent.click(screen.getAllByTestId("song-check")[2]!);
    vi.mocked(deleteSong).mockImplementation(() => {
      setItems(current!.items.filter((i) => i.songId !== "b"));
      return Promise.resolve();
    });
    vi.mocked(getSetlist).mockClear();
    vi.mocked(listSetlists).mockClear();
    fireEvent.click(screen.getByTestId("delete-selected"));
    fireEvent.click(screen.getByTestId("confirm-delete-yes"));
    await waitFor(() => expect(getSetlist).toHaveBeenCalledWith("sl1"));
    expect(listSetlists).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getAllByTestId("setlist-entry")).toHaveLength(1),
    );
  });

  it("saves a Word file and names the saved file; cancel and errors", async () => {
    await renderSeeded();
    vi.mocked(saveExportDocx).mockResolvedValueOnce("/tmp/Sunday (2).docx");
    fireEvent.click(screen.getByTestId("setlist-export-word"));
    await waitFor(() =>
      expect(screen.getByTestId("app-status").textContent).toBe(
        "Saved \u2068Sunday (2).docx\u2069",
      ),
    );
    expect(vi.mocked(saveExportDocx).mock.calls[0]![0]).toBe("Sunday.docx");
    expect(vi.mocked(saveExportDocx).mock.calls[0]![1]).toBe(
      STRINGS.fileFilterWord,
    );

    vi.mocked(saveExportDocx).mockResolvedValueOnce(null);
    fireEvent.click(screen.getByTestId("setlist-export-word"));
    await waitFor(() => expect(saveExportDocx).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId("app-status")).toBeNull());
    expect(screen.queryByTestId("app-notice")).toBeNull();

    vi.mocked(saveExportDocx).mockRejectedValueOnce(new Error("disk"));
    fireEvent.click(screen.getByTestId("setlist-export-word"));
    expect((await screen.findByTestId("app-notice")).textContent).toBe(
      STRINGS.exportFailed,
    );
  }, 15000);

  it("aborts a setlist export when a song cannot be fetched", async () => {
    await renderSeeded();
    window.print = vi.fn() as unknown as typeof window.print;
    vi.mocked(getSong).mockRejectedValue(new Error("gone"));
    fireEvent.click(screen.getByTestId("setlist-print"));
    expect((await screen.findByTestId("app-notice")).textContent).toBe(
      STRINGS.exportFailed,
    );
    expect(window.print).not.toHaveBeenCalled();
  });

  it("exports the open song without a cover, with the PDF hint", async () => {
    render(<App />);
    await screen.findByTestId("song-title");
    expect(screen.getByTestId("song-pdf-hint").textContent).toBe(
      STRINGS.pdfHint,
    );
    let cover: boolean | undefined;
    window.print = vi.fn(() => {
      cover = document.querySelector("[data-print-cover]") !== null;
    }) as unknown as typeof window.print;
    fireEvent.click(screen.getByTestId("song-export-pdf"));
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1), {
      timeout: 6000,
    });
    expect(cover).toBe(false);
  }, 15000);
  it("deletes the open setlist and stays on the Setlists tab", async () => {
    await renderSeeded();
    vi.mocked(deleteSetlist).mockImplementation(() => {
      current = undefined;
      return Promise.resolve();
    });
    fireEvent.click(screen.getByTestId("setlist-delete"));
    fireEvent.click(screen.getByTestId("confirm-delete-setlist-yes"));
    await waitFor(() =>
      expect(screen.queryByTestId("setlist-editor")).toBeNull(),
    );
    expect(deleteSetlist).toHaveBeenCalledExactlyOnceWith("sl1");
    expect(screen.getByTestId("tab-setlists")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await screen.findByTestId("setlists-empty")).toBeInTheDocument();
  });

  it("duplicates a setlist with the suffix and opens the copy", async () => {
    await renderSeeded();
    vi.mocked(duplicateSetlist).mockImplementation((_id, name) => {
      current = { ...current!, id: "sl2", name };
      return Promise.resolve(current);
    });
    fireEvent.click(screen.getByTestId("setlist-duplicate"));
    await waitFor(() =>
      expect(duplicateSetlist).toHaveBeenCalledExactlyOnceWith(
        "sl1",
        `Sunday ${STRINGS.duplicateSuffix}`,
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("setlist-editor").querySelector("h2")!.textContent,
      ).toBe(`Sunday ${STRINGS.duplicateSuffix}`),
    );
  });

  it("disables the editor controls while a storage call is pending", async () => {
    await renderSeeded();
    let finish: (value: Setlist) => void = () => undefined;
    vi.mocked(updateSetlistItem).mockImplementation(
      () =>
        new Promise<Setlist>((resolve) => {
          finish = resolve;
        }),
    );
    expect(screen.getAllByTestId("setlist-entry-up")[1]).toBeEnabled();
    fireEvent.click(screen.getAllByTestId("setlist-entry-transpose-up")[1]!);
    await waitFor(() =>
      expect(screen.getAllByTestId("setlist-entry-up")[1]).toBeDisabled(),
    );
    expect(
      screen.getAllByTestId("setlist-entry-transpose-up")[0],
    ).toBeDisabled();
    finish(current!);
    await waitFor(() =>
      expect(screen.getAllByTestId("setlist-entry-up")[1]).toBeEnabled(),
    );
  });

  it("keeps the entry's capo when its transpose changes", async () => {
    await renderSeeded();
    fireEvent.click(screen.getAllByTestId("setlist-entry-transpose-up")[0]!);
    await waitFor(() =>
      expect(updateSetlistItem).toHaveBeenCalledExactlyOnceWith(
        "sl1",
        "i1",
        3,
        3,
      ),
    );
  });

  it("adds the open song to an existing setlist from its header", async () => {
    seed();
    render(<App />);
    await screen.findByTestId("song-title");
    fireEvent.click(screen.getByTestId("song-add-to-setlist"));
    fireEvent.click(screen.getAllByTestId("add-to-setlist-option")[0]!);
    fireEvent.click(screen.getByTestId("add-to-setlist-confirm"));
    await waitFor(() =>
      expect(addSetlistItems).toHaveBeenCalledExactlyOnceWith("sl1", ["c"]),
    );
    await waitFor(() =>
      expect(screen.getByTestId("app-status").textContent).toBe(
        "Added 1 song to the setlist",
      ),
    );
    expect(screen.queryByTestId("add-to-setlist")).toBeNull();
  });

  it("lists the new setlist and shows a notice when create-then-add fails", async () => {
    render(<App />);
    await screen.findByTestId("song-title");
    vi.mocked(addSetlistItems).mockRejectedValue(new Error("boom"));
    fireEvent.click(screen.getByTestId("song-add-to-setlist"));
    fireEvent.change(screen.getByTestId("add-to-setlist-name"), {
      target: { value: "Fresh" },
    });
    fireEvent.click(screen.getByTestId("add-to-setlist-confirm"));
    expect((await screen.findByTestId("app-notice")).textContent).toBe(
      STRINGS.setlistSaveFailed,
    );
    expect(createSetlist).toHaveBeenCalledExactlyOnceWith("Fresh");
    expect(screen.queryByTestId("app-status")).toBeNull();
    fireEvent.click(screen.getByTestId("tab-setlists"));
    expect(await screen.findAllByTestId("setlist-row")).toHaveLength(1);
  });

  it("Export PDF mounts the print root in PDF mode, Print leaves the title", async () => {
    await renderSeeded();
    document.title = "Shir";
    const seen: { title: string; root: boolean; cover: boolean }[] = [];
    window.print = vi.fn(() => {
      seen.push({
        title: document.title,
        root: document.querySelector("[data-print-root]") !== null,
        cover: document.querySelector("[data-print-cover]") !== null,
      });
    }) as unknown as typeof window.print;
    fireEvent.click(screen.getByTestId("setlist-export-pdf"));
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1), {
      timeout: 6000,
    });
    expect(seen[0]).toEqual({ title: "Sunday", root: true, cover: true });
    await waitFor(() =>
      expect(screen.getByTestId("setlist-export-pdf")).toBeEnabled(),
    );
    fireEvent.click(screen.getByTestId("setlist-print"));
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(2), {
      timeout: 6000,
    });
    expect(seen[1]!.title).not.toBe("Sunday");
  }, 20000);

  describe("open-song export", () => {
    const chordsIn = (root: ParentNode) =>
      [...root.querySelectorAll("[data-song] [data-chord]")].map(
        (el) => el.textContent,
      );

    async function transposedSong() {
      render(<App />);
      await screen.findByTestId("song-title");
      fireEvent.click(screen.getAllByTestId("song-item")[1]!); // Alpha
      await waitFor(() =>
        expect(screen.getByTestId("song-title").textContent).toBe("Alpha"),
      );
      fireEvent.click(screen.getByTestId("transpose-up"));
      fireEvent.click(screen.getByTestId("transpose-up"));
      fireEvent.change(screen.getByTestId("capo-select"), {
        target: { value: "1" },
      });
    }

    it.each(["song-print", "song-export-pdf"])(
      "%s prints the current transpose and capo",
      async (id) => {
        await transposedSong();
        const viewed = chordsIn(screen.getByTestId("song-pane"));
        expect(viewed.length).toBeGreaterThan(0);
        expect(viewed).not.toEqual(["C", "F"]);
        let printed: (string | null)[] = [];
        window.print = vi.fn(() => {
          printed = chordsIn(document.querySelector("[data-print-container]")!);
        }) as unknown as typeof window.print;
        fireEvent.click(screen.getByTestId(id));
        await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1), {
          timeout: 6000,
        });
        expect(printed).toEqual(viewed);
      },
      15000,
    );

    it("prints with lang=he and dir=rtl under the Hebrew locale", async () => {
      await transposedSong();
      fireEvent.click(screen.getByTestId("locale-he"));
      let attrs = "";
      window.print = vi.fn(() => {
        const root = document.querySelector("[data-print-root]")!;
        attrs = `${root.getAttribute("lang")}/${root.getAttribute("dir")}`;
      }) as unknown as typeof window.print;
      try {
        fireEvent.click(screen.getByTestId("song-print"));
        await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1), {
          timeout: 6000,
        });
        expect(attrs).toBe("he/rtl");
      } finally {
        fireEvent.click(screen.getByTestId("locale-en"));
      }
    }, 15000);
  });

  it("shows export feedback in bundled mode", async () => {
    await renderBundled();
    vi.mocked(saveExportDocx).mockRejectedValueOnce(new Error("disk"));
    fireEvent.click(screen.getByTestId("song-export-word"));
    expect((await screen.findByTestId("app-notice")).textContent).toBe(
      STRINGS.exportFailed,
    );
    vi.mocked(saveExportDocx).mockResolvedValueOnce("/x/y/Demo (2).docx");
    fireEvent.click(screen.getByTestId("song-export-word"));
    await waitFor(() =>
      expect(screen.getByTestId("app-status").textContent).toBe(
        "Saved ⁨Demo (2).docx⁩",
      ),
    );
    expect(screen.queryByTestId("app-notice")).toBeNull();
  });
});
