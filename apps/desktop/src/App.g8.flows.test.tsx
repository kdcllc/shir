import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { HE } from "./i18n/he";
import { i18n, initI18n } from "./i18n";
import {
  applyDocumentLocale,
  detectLocale,
  LOCALE_STORAGE_KEY,
  readStoredLocale,
} from "./i18n/locale";
import { LIBRARY_PREFS_KEY } from "./libraryView";
import { deleteSong, getSong, listSongs, searchSongs } from "./storage";
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
  language: Language,
  updatedAt = "2026-01-01T00:00:00Z",
): SongSummary {
  return {
    id,
    title,
    artist: null,
    key: null,
    language,
    updatedAt,
  } as SongSummary;
}

// Title order: שיר, Alpha, Delta, Gamma, Zeta.
const LIST = [
  summary("z", "Zeta", "en", "2026-01-02T00:00:00Z"),
  summary("a", "Alpha", "en", "2026-01-03T00:00:00Z"),
  summary("s", "שיר", "he", "2026-01-04T00:00:00Z"),
  summary("g", "Gamma", "mixed", "2026-01-05T00:00:00Z"),
  summary("d", "Delta", "en", "2026-01-06T00:00:00Z"),
];
const byId = (id: string) => LIST.find((s) => s.id === id)!;
const hit = (id: string): SearchHit => ({ song: byId(id), snippet: null });

const BODY = "{title: T}\n[C]la la\n";
let db: SongSummary[] = [];

const rowTitles = (): string[] =>
  screen
    .queryAllByTestId("song-item")
    .map((el) => el.querySelector("span")?.textContent ?? "");
const filter = (f: "all" | "he" | "en" | "mixed") =>
  screen.getByTestId(`library-filter-${f}`);
const click = (id: string) => fireEvent.click(screen.getByTestId(id));

async function renderDb() {
  const view = render(<App />);
  await screen.findByTestId("song-index");
  await screen.findByTestId("song-title");
  return view;
}

beforeEach(() => {
  db = [...LIST];
  vi.mocked(listSongs).mockReset();
  vi.mocked(getSong).mockReset();
  vi.mocked(searchSongs).mockReset();
  vi.mocked(deleteSong).mockReset();
  vi.mocked(listSongs).mockImplementation(() => Promise.resolve([...db]));
  vi.mocked(getSong).mockImplementation((id) =>
    Promise.resolve({
      id,
      chordpro: BODY,
      createdAt: "",
      updatedAt: "",
    } as unknown as Song),
  );
  vi.mocked(deleteSong).mockImplementation((id) => {
    db = db.filter((s) => s.id !== id);
    return Promise.resolve();
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Hebrew UI with language filter and search", () => {
  const HITS = [hit("z"), hit("s"), hit("a"), hit("d")];

  async function searchInHebrew() {
    vi.mocked(searchSongs).mockResolvedValue(HITS);
    await renderDb();
    click("locale-he");
    await waitFor(() =>
      expect(screen.getByTestId("new-song")).toHaveTextContent(HE.newSong),
    );
    fireEvent.change(screen.getByTestId("search-input"), {
      target: { value: "la" },
    });
    await screen.findByTestId("search-results");
  }

  it("filtered hits keep their relevance order", async () => {
    await searchInHebrew();
    expect(rowTitles()).toEqual(["Zeta", "שיר", "Alpha", "Delta"]);
    fireEvent.click(filter("en"));
    // Relevance order (z, a, d), not title order (Alpha, Delta, Zeta).
    expect(rowTitles()).toEqual(["Zeta", "Alpha", "Delta"]);
    fireEvent.click(filter("he"));
    expect(rowTitles()).toEqual(["שיר"]);
    expect(document.documentElement.lang).toBe("he");
  });

  it("shows filter-empty in Hebrew when every hit is filtered out", async () => {
    await searchInHebrew();
    fireEvent.click(filter("mixed"));
    expect(screen.getByTestId("filter-empty")).toHaveTextContent(
      HE.noFilterMatches,
    );
    expect(screen.getByTestId("filter-empty")).not.toHaveTextContent(
      STRINGS.noFilterMatches,
    );
    expect(screen.queryByTestId("search-results")).toBeNull();
    expect(screen.queryByTestId("search-empty")).toBeNull();
    fireEvent.click(filter("all"));
    expect(screen.queryByTestId("filter-empty")).toBeNull();
    expect(rowTitles()).toEqual(["Zeta", "שיר", "Alpha", "Delta"]);
  });
});

describe("language filter, select all and bulk delete", () => {
  const items = () => screen.getAllByTestId("song-item");

  async function selectFiltered() {
    await renderDb();
    fireEvent.click(filter("en"));
    expect(rowTitles()).toEqual(["Alpha", "Delta", "Zeta"]);
    click("select-songs");
    click("select-all");
    expect(screen.getAllByTestId("song-check")).toHaveLength(3);
  }

  it("deletes only the listed rows and focuses the search box when none is left", async () => {
    await selectFiltered();
    click("delete-selected");
    click("confirm-delete-yes");
    await waitFor(() =>
      expect(screen.getByTestId("filter-empty")).toBeInTheDocument(),
    );
    expect(
      vi
        .mocked(deleteSong)
        .mock.calls.map((c) => c[0])
        .sort(),
    ).toEqual(["a", "d", "z"]);
    expect(db.map((s) => s.id).sort()).toEqual(["g", "s"]);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId("search-input")),
    );
    // The other languages are intact under the "all" filter.
    fireEvent.click(filter("all"));
    expect(rowTitles()).toEqual(["שיר", "Gamma"]);
  });

  it("focuses the row now at the first deleted position when listed rows remain", async () => {
    await selectFiltered();
    // Keep Delta: unpick it, so Alpha (position 0) and Zeta go.
    fireEvent.click(screen.getAllByTestId("song-check")[1]!);
    click("delete-selected");
    click("confirm-delete-yes");
    await waitFor(() => expect(rowTitles()).toEqual(["Delta"]));
    expect(
      vi
        .mocked(deleteSong)
        .mock.calls.map((c) => c[0])
        .sort(),
    ).toEqual(["a", "z"]);
    expect(db.map((s) => s.id).sort()).toEqual(["d", "g", "s"]);
    await waitFor(() => expect(document.activeElement).toBe(items()[0]));
    expect(items()[0]).toHaveTextContent("Delta");
  });
});

describe("locale switch with the editor open and unsaved changes", () => {
  it("keeps the dirty text and the editor, and switches the strings", async () => {
    await renderDb();
    click("edit-song");
    await screen.findByTestId("editor");
    click("editor-tab-source");
    const input = screen.getByTestId<HTMLTextAreaElement>("editor-input");
    const edited = `${BODY}[G]more words\n`;
    fireEvent.change(input, { target: { value: edited } });

    click("locale-he");
    await waitFor(() =>
      expect(screen.getByTestId("new-song")).toHaveTextContent(HE.newSong),
    );
    expect(screen.getByTestId("editor")).toBeInTheDocument();
    expect(screen.getByTestId<HTMLTextAreaElement>("editor-input").value).toBe(
      edited,
    );
    expect(screen.getByTestId("editor-save")).toHaveTextContent(HE.save);
    expect(document.documentElement.dir).toBe("rtl");

    // Still dirty: leaving asks, in Hebrew.
    fireEvent.click(screen.getAllByTestId("song-item")[1]!);
    const dialog = await screen.findByTestId("confirm-discard");
    expect(dialog).toHaveTextContent(HE.discardTitle);
    // Guards against an English fallback: the heading holds Hebrew letters and not the English text.
    expect(dialog.textContent).toMatch(/[\u0590-\u05FF]/);
    expect(dialog).not.toHaveTextContent(STRINGS.discardTitle);
    expect(screen.getByTestId("confirm-keep")).toHaveTextContent(
      HE.keepEditing,
    );

    // Back to English with the dialog open: the text is still the edit.
    click("confirm-keep");
    click("locale-en");
    await waitFor(() =>
      expect(screen.getByTestId("new-song")).toHaveTextContent(STRINGS.newSong),
    );
    expect(screen.getByTestId<HTMLTextAreaElement>("editor-input").value).toBe(
      edited,
    );
    fireEvent.click(screen.getAllByTestId("song-item")[1]!);
    expect(await screen.findByTestId("confirm-discard")).toHaveTextContent(
      STRINGS.discardTitle,
    );
  });
});

describe("prefs and locale after a remount", () => {
  it("restores the sort, the filter and the Hebrew interface", async () => {
    const first = await renderDb();
    click("locale-he");
    await waitFor(() =>
      expect(screen.getByTestId("new-song")).toHaveTextContent(HE.newSong),
    );
    fireEvent.change(screen.getByTestId("library-sort"), {
      target: { value: "updated" },
    });
    fireEvent.click(filter("en"));
    first.unmount();

    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("he");
    expect(JSON.parse(window.localStorage.getItem(LIBRARY_PREFS_KEY)!)).toEqual(
      {
        sort: "updated",
        language: "en",
      },
    );

    // A fresh start: the language engine is back at English, then main.tsx restores it from storage.
    await i18n.changeLanguage("en");
    applyDocumentLocale(document, "en");
    const locale = detectLocale(readStoredLocale(window.localStorage), []);
    initI18n(locale);
    applyDocumentLocale(document, locale);
    expect(locale).toBe("he");

    await renderDb();
    expect(screen.getByTestId("new-song")).toHaveTextContent(HE.newSong);
    expect(screen.getByTestId("locale-he")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(document.documentElement.lang).toBe("he");
    expect(screen.getByTestId("library-sort")).toHaveValue("updated");
    expect(filter("en")).toHaveAttribute("aria-checked", "true");
    // Updated order, newest first, English only: Delta (01-06), Alpha (01-03), Zeta (01-02).
    expect(rowTitles()).toEqual(["Delta", "Alpha", "Zeta"]);
  });
});
