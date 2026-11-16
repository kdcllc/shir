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
import { pickSongFiles, readTextFile } from "./files";
import { getSong, listSongs, saveSong, searchSongs } from "./storage";
import type { SearchHit, Song, SongSummary } from "./storage";
import { STRINGS } from "./strings";
import { signalUiReady } from "./uiReady";

vi.mock("./uiReady", () => ({ signalUiReady: vi.fn() }));
vi.mock("./storage", () => ({
  listSongs: vi.fn(),
  getSong: vi.fn(),
  searchSongs: vi.fn(),
  saveSong: vi.fn(),
}));
vi.mock("./files", () => ({
  pickSongFiles: vi.fn(),
  readTextFile: vi.fn(),
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

  const editor = () =>
    screen.getByTestId("editor-input") as HTMLTextAreaElement;
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
