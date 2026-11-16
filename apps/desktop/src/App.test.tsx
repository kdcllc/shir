import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { parseSong, viewSong } from "chord-core";
import type { SongModel } from "chord-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { loadLibrary } from "./library";
import { getSong, listSongs, searchSongs } from "./storage";
import type { SearchHit, Song, SongSummary } from "./storage";
import { STRINGS } from "./strings";
import { signalUiReady } from "./uiReady";

vi.mock("./uiReady", () => ({ signalUiReady: vi.fn() }));
vi.mock("./storage", () => ({
  listSongs: vi.fn(),
  getSong: vi.fn(),
  searchSongs: vi.fn(),
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
