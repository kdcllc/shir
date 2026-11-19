import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { LIBRARY_PREFS_KEY } from "./libraryView";
import { getSong, listSongs, searchSongs } from "./storage";
import type { Language, SearchHit, Song, SongSummary } from "./storage";
import { STRINGS } from "./strings";

vi.mock("./uiReady", () => ({ signalUiReady: vi.fn() }));
vi.mock("./storage", () => ({
  listSongs: vi.fn(),
  getSong: vi.fn(),
  searchSongs: vi.fn(),
  saveSong: vi.fn(),
  deleteSong: vi.fn(),
}));
vi.mock("./files", () => ({
  pickSongFiles: vi.fn(),
  readTextFile: vi.fn(),
}));

function summary(
  id: string,
  title: string,
  artist: string | null,
  language: Language,
  updatedAt: string,
  key: string | null = null,
): SongSummary {
  return { id, title, artist, key, language, updatedAt } as SongSummary;
}

// Title order (he before en in the collator): שיר, Alpha, Gamma, Zeta. Artist order: Ann, Zed, Zoe, none.
// Updated order (newest first): g, s, a, z.
const LIST = [
  summary("z", "Zeta", "Zoe", "en", "2026-01-02T00:00:00Z", "G"),
  summary("a", "Alpha", "Zed", "en", "2026-01-03T00:00:00Z"),
  summary("s", "שיר", null, "he", "2026-01-04T00:00:00Z", "Am"),
  summary("g", "Gamma", "Ann", "mixed", "2026-01-05T00:00:00Z", "C"),
];

function stored(id: string): Song {
  return {
    id,
    chordpro: `{title: ${id}}\n[C]la`,
    createdAt: "",
    updatedAt: "",
  } as unknown as Song;
}

function hit(s: SongSummary): SearchHit {
  return { song: s, snippet: null };
}

const byId = (id: string) => LIST.find((s) => s.id === id)!;
const rowTitles = (): string[] =>
  screen
    .queryAllByTestId("song-item")
    .map((el) => el.querySelector("span")?.textContent ?? "");
const sortSelect = () =>
  screen.getByTestId("library-sort") as HTMLSelectElement;
const filter = (f: "all" | "he" | "en" | "mixed") =>
  screen.getByTestId(`library-filter-${f}`);

async function renderDb() {
  const view = render(<App />);
  await screen.findByTestId("song-index");
  await screen.findByTestId("song-title");
  return view;
}

describe("App library view (database mode)", () => {
  beforeEach(() => {
    vi.mocked(listSongs).mockReset();
    vi.mocked(getSong).mockReset();
    vi.mocked(searchSongs).mockReset();
    vi.mocked(listSongs).mockImplementation(() => Promise.resolve([...LIST]));
    vi.mocked(getSong).mockImplementation((id) => Promise.resolve(stored(id)));
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("lists by title with the controls in the documented place", async () => {
    await renderDb();
    expect(rowTitles()).toEqual(["שיר", "Alpha", "Gamma", "Zeta"]);
    expect(sortSelect()).toHaveValue("title");
    expect(filter("all")).toHaveAttribute("aria-checked", "true");
    const controls = screen.getByRole("group", { name: STRINGS.libraryView });
    const status = screen.getByTestId("search-pending");
    const bar = screen.getByTestId("selection-bar");
    expect(
      status.compareDocumentPosition(controls) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      controls.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("sorts by artist and by recently updated and persists the choice", async () => {
    await renderDb();
    fireEvent.change(sortSelect(), { target: { value: "artist" } });
    expect(rowTitles()).toEqual(["Gamma", "Alpha", "Zeta", "שיר"]);
    fireEvent.change(sortSelect(), { target: { value: "updated" } });
    expect(rowTitles()).toEqual(["Gamma", "שיר", "Alpha", "Zeta"]);
    expect(JSON.parse(window.localStorage.getItem(LIBRARY_PREFS_KEY)!)).toEqual(
      { sort: "updated", language: "all" },
    );
  });

  it("filters by language, keeps the order and persists the choice", async () => {
    await renderDb();
    fireEvent.click(filter("en"));
    expect(rowTitles()).toEqual(["Alpha", "Zeta"]);
    expect(filter("en")).toHaveAttribute("aria-checked", "true");
    expect(filter("all")).toHaveAttribute("aria-checked", "false");
    fireEvent.click(filter("he"));
    expect(rowTitles()).toEqual(["שיר"]);
    fireEvent.click(filter("mixed"));
    expect(rowTitles()).toEqual(["Gamma"]);
    expect(JSON.parse(window.localStorage.getItem(LIBRARY_PREFS_KEY)!)).toEqual(
      { sort: "title", language: "mixed" },
    );
  });

  it("restores the stored preferences on a remount", async () => {
    const first = await renderDb();
    fireEvent.change(sortSelect(), { target: { value: "updated" } });
    fireEvent.click(filter("en"));
    first.unmount();
    await renderDb();
    expect(sortSelect()).toHaveValue("updated");
    expect(filter("en")).toHaveAttribute("aria-checked", "true");
    expect(rowTitles()).toEqual(["Alpha", "Zeta"]);
  });

  it("shows the empty-filter message instead of the list", async () => {
    vi.mocked(listSongs).mockResolvedValue([byId("a"), byId("z")]);
    await renderDb();
    fireEvent.click(filter("he"));
    expect(screen.getByTestId("filter-empty")).toHaveTextContent(
      STRINGS.noFilterMatches,
    );
    expect(screen.queryByTestId("song-index")).toBeNull();
    expect(screen.queryByText(STRINGS.libraryEmpty)).toBeNull();
    expect(screen.queryByTestId("search-empty")).toBeNull();
    fireEvent.click(filter("all"));
    expect(screen.queryByTestId("filter-empty")).toBeNull();
    expect(rowTitles()).toEqual(["Alpha", "Zeta"]);
  });

  it("shows libraryEmpty, not the filter message, for an empty library", async () => {
    vi.mocked(listSongs).mockResolvedValue([]);
    render(<App />);
    await screen.findByText(STRINGS.libraryEmpty);
    expect(screen.queryByTestId("filter-empty")).toBeNull();
  });

  it("shows key and language on library rows", async () => {
    await renderDb();
    const keys = screen.getAllByTestId("song-row-key");
    expect(keys.map((k) => k.textContent)).toEqual(["Am", "C", "G"]);
    expect(
      screen.getAllByTestId("song-language").map((b) => b.textContent),
    ).toEqual([
      STRINGS.badgeHebrew,
      STRINGS.badgeEnglish,
      STRINGS.badgeMixed,
      STRINGS.badgeEnglish,
    ]);
  });

  describe("search results", () => {
    const HITS = [hit(byId("z")), hit(byId("s")), hit(byId("a"))];
    async function search() {
      vi.mocked(searchSongs).mockResolvedValue(HITS);
      await renderDb();
      fireEvent.change(screen.getByTestId("search-input"), {
        target: { value: "la" },
      });
      await screen.findByTestId("search-results");
    }

    it("keeps relevance order and ignores the sort", async () => {
      await search();
      expect(rowTitles()).toEqual(["Zeta", "שיר", "Alpha"]);
      fireEvent.change(sortSelect(), { target: { value: "artist" } });
      expect(rowTitles()).toEqual(["Zeta", "שיר", "Alpha"]);
      expect(screen.getAllByTestId("song-language")).toHaveLength(3);
    });

    it("filters hits by language without reordering", async () => {
      await search();
      fireEvent.click(filter("en"));
      expect(rowTitles()).toEqual(["Zeta", "Alpha"]);
    });

    it("shows the filter message when only the filter empties the hits", async () => {
      await search();
      fireEvent.click(filter("mixed"));
      expect(screen.getByTestId("filter-empty")).toHaveTextContent(
        STRINGS.noFilterMatches,
      );
      expect(screen.queryByTestId("search-results")).toBeNull();
      expect(screen.queryByTestId("search-empty")).toBeNull();
    });

    it("still shows search-empty for a search with no hits", async () => {
      vi.mocked(searchSongs).mockResolvedValue([]);
      await renderDb();
      fireEvent.click(filter("he"));
      fireEvent.change(screen.getByTestId("search-input"), {
        target: { value: "zzz" },
      });
      await screen.findByTestId("search-empty");
      expect(screen.queryByTestId("filter-empty")).toBeNull();
    });
  });

  describe("select mode", () => {
    it("selects only the listed (filtered) rows", async () => {
      await renderDb();
      fireEvent.click(filter("en"));
      fireEvent.click(screen.getByTestId("select-songs"));
      fireEvent.click(screen.getByTestId("select-all"));
      const checks = screen.getAllByTestId("song-check");
      expect(checks).toHaveLength(2);
      for (const c of checks) expect(c).toBeChecked();
      await waitFor(() =>
        expect(screen.getByTestId("selection-count")).toHaveTextContent("2"),
      );
    });
  });
});
