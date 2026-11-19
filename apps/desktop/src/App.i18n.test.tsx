import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { i18n } from "./i18n";
import { EN } from "./i18n/en";
import { loadLibrary } from "./library";
import {
  deleteSong,
  getSong,
  listSongs,
  saveSong,
  searchSongs,
} from "./storage";
import type { Song, SongSummary } from "./storage";
import { pickSongFiles, readTextFile } from "./files";

vi.mock("./uiReady", () => ({ signalUiReady: vi.fn() }));
vi.mock("./storage", () => ({
  listSongs: vi.fn(),
  getSong: vi.fn(),
  searchSongs: vi.fn(),
  saveSong: vi.fn(),
  deleteSong: vi.fn(),
}));
vi.mock("./files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./files")>()),
  pickSongFiles: vi.fn(),
  readTextFile: vi.fn(),
}));

/** Keys whose English value is meant to stay as is in every language. */
const ALLOWED: ReadonlySet<string> = new Set([
  "appName",
  "appNameHebrew",
  "separator",
  "transposeDownGlyph",
  "transposeUpGlyph",
  "removeGlyph",
  "editGlyph",
  "addGlyph",
  "upGlyph",
  "downGlyph",
  "leftGlyph",
  "rightGlyph",
  "localeHebrew",
  "localeEnglish",
  "localeHebrewShort",
  "localeEnglishShort",
]);

const ALPHA = "{title: Alpha}\n[C]Alpha [G]line here\n";
const BETA = "{title: Beta}\n{key: Am}\n[Am]Beta [G]line\n";
const db = new Map<string, string>([
  ["a", ALPHA],
  ["b", BETA],
]);

function summaries(): SongSummary[] {
  return [...db].map(
    ([id, text]) =>
      ({
        id,
        title: /\{title: ([^}]*)\}/.exec(text)?.[1] ?? "",
        artist: null,
        key: null,
        language: "en",
        updatedAt: "2026-01-01T00:00:00Z",
      }) as SongSummary,
  );
}

/** A marker resource: every key becomes `⟦key⟧` (all plural forms of a plural key). */
function markerBundle(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(EN)) {
    const base = key.replace(/_(one|other)$/, "");
    if (ALLOWED.has(key)) continue;
    out[key] = `⟦${base}⟧`;
    if (base !== key) {
      for (const form of ["one", "two", "many", "other"])
        out[`${base}_${form}`] = `⟦${base}⟧`;
    }
  }
  return out;
}

/** The English values that must not survive a language switch. */
function englishValues(): Set<string> {
  const values = new Set<string>();
  for (const [key, value] of Object.entries(EN)) {
    const trimmed = value.trim();
    if (!ALLOWED.has(key) && trimmed !== "" && !trimmed.includes("{{"))
      values.add(trimmed);
  }
  return values;
}

/** The interpolated English templates as full-string patterns (`{{var}}` matches anything). */
function englishPatterns(): RegExp[] {
  const patterns: RegExp[] = [];
  for (const value of Object.values(EN)) {
    if (!value.includes("{{")) continue;
    const source = value
      .split(/\{\{\w+\}\}/)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".+");
    patterns.push(new RegExp(`^${source}$`, "su"));
  }
  return patterns;
}

/** The locale toggle shows native names by design; its own test guards it. */
const TOGGLE = '[data-testid="locale-toggle"]';

/**
 * Every rendered text node and every aria-label / title / placeholder / alt,
 * outside the locale toggle subtree.
 */
function renderedStrings(): string[] {
  const found: string[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    if (n.parentElement?.closest(TOGGLE)) continue;
    const text = (n.textContent ?? "").trim();
    if (text !== "") found.push(text);
  }
  for (const el of document.body.querySelectorAll("*")) {
    if (el.closest(TOGGLE)) continue;
    for (const attr of ["aria-label", "title", "placeholder", "alt"]) {
      const value = el.getAttribute(attr);
      if (value !== null && value.trim() !== "") found.push(value.trim());
    }
  }
  return found;
}

/** Strings that still equal an English value, ignoring song content. */
function leftovers(): string[] {
  const english = englishValues();
  const patterns = englishPatterns();
  return renderedStrings().filter(
    (s) => english.has(s) || patterns.some((pattern) => pattern.test(s)),
  );
}

let original: object;

beforeEach(() => {
  original = i18n.getResourceBundle("he", "translation") as object;
  for (const key of [...db.keys()].filter((k) => k.startsWith("n")))
    db.delete(key);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.mocked(listSongs).mockReset();
  vi.mocked(getSong).mockReset();
  vi.mocked(searchSongs).mockReset();
  vi.mocked(saveSong).mockReset();
  vi.mocked(listSongs).mockImplementation(() => Promise.resolve(summaries()));
  vi.mocked(getSong).mockImplementation((id) =>
    Promise.resolve({
      id,
      chordpro: db.get(id) ?? "",
      createdAt: "",
      updatedAt: "",
    } as unknown as Song),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  // Restore the real bundle: drop the markers, then put every real key back.
  i18n.removeResourceBundle("he", "translation");
  i18n.addResourceBundle("he", "translation", original, true, true);
});

function switchToMarkers() {
  i18n.addResourceBundle("he", "translation", markerBundle(), true, true);
  void i18n.changeLanguage("he");
}

async function renderDb() {
  render(<App />);
  await screen.findByTestId("song-index");
  await screen.findByTestId("song-title");
}

describe("App language switch", () => {
  it("has English text before the switch (the check is not vacuous)", async () => {
    await renderDb();
    expect(leftovers().length).toBeGreaterThan(5);
  });

  it("changes every string of the library view, with select mode on", async () => {
    await renderDb();
    fireEvent.click(screen.getByTestId("select-songs"));
    await waitFor(() => screen.getAllByTestId("song-check"));
    switchToMarkers();
    await waitFor(() =>
      expect(screen.getByTestId("new-song")).toHaveTextContent("⟦newSong⟧"),
    );
    expect(leftovers()).toEqual([]);
    expect(renderedStrings()).toContain("⟦selectAll⟧");
  });

  it("changes every string of the open editor (visual, picker, source)", async () => {
    await renderDb();
    fireEvent.click(screen.getByTestId("edit-song"));
    await screen.findByTestId("editor");
    const line = document.querySelector("[data-line-index='1']")!;
    fireEvent.click(line.querySelector("[data-pos='3']")!);
    await screen.findByTestId("chord-picker");
    switchToMarkers();
    await waitFor(() =>
      expect(screen.getByTestId("editor-tab-visual")).toHaveTextContent(
        "⟦tabVisual⟧",
      ),
    );
    expect(leftovers()).toEqual([]);
    fireEvent.click(screen.getByTestId("editor-tab-source"));
    await screen.findByTestId("editor-source");
    expect(leftovers()).toEqual([]);
    expect(renderedStrings()).toContain("⟦editorLabel⟧");
  });

  it("changes the diagnostics, search and bundled-list strings", async () => {
    vi.mocked(listSongs).mockRejectedValue(new Error("unavailable"));
    render(<App />);
    await screen.findAllByTestId("song-item");
    const index = loadLibrary().findIndex(
      (s) => s.id === "test-songs:malformed_input",
    );
    fireEvent.click(screen.getAllByTestId("song-item")[index]!);
    await screen.findByTestId("diagnostics");
    switchToMarkers();
    await waitFor(() =>
      expect(screen.getByTestId("diagnostics")).toHaveTextContent(
        "⟦diagnostics⟧",
      ),
    );
    expect(leftovers()).toEqual([]);
  });

  it("changes the interpolated templates of the library, with and without select mode", async () => {
    await renderDb();
    switchToMarkers();
    await waitFor(() =>
      expect(screen.getByTestId("new-song")).toHaveTextContent("⟦newSong⟧"),
    );
    expect(renderedStrings()).toContain("⟦deleteSongNamed⟧");
    expect(leftovers()).toEqual([]);
    await i18n.changeLanguage("en");
    fireEvent.click(screen.getByTestId("select-songs"));
    await waitFor(() => screen.getAllByTestId("song-check"));
    switchToMarkers();
    await waitFor(() =>
      expect(screen.getByTestId("selection-count")).toHaveTextContent(
        "⟦selectedCount⟧",
      ),
    );
    expect(renderedStrings()).toContain("⟦selectSongNamed⟧");
    expect(leftovers()).toEqual([]);
  });

  it("changes the visual editor line labels", async () => {
    await renderDb();
    fireEvent.click(screen.getByTestId("edit-song"));
    await screen.findByTestId("editor");
    switchToMarkers();
    await waitFor(() => expect(renderedStrings()).toContain("⟦lineLabel⟧"));
    expect(leftovers()).toEqual([]);
  });

  it("changes the delete confirmation (single and bulk)", async () => {
    await renderDb();
    fireEvent.click(screen.getAllByTestId("song-delete")[0]!);
    await screen.findByTestId("confirm-delete");
    switchToMarkers();
    await waitFor(() =>
      expect(screen.getByTestId("confirm-delete")).toHaveTextContent(
        "⟦deleteConfirmTitle⟧",
      ),
    );
    expect(screen.getByTestId("confirm-delete")).toHaveTextContent(
      "⟦deleteConfirmBody⟧",
    );
    expect(leftovers()).toEqual([]);
    await i18n.changeLanguage("en");
    fireEvent.click(screen.getByTestId("confirm-delete-cancel"));
    fireEvent.click(screen.getByTestId("select-songs"));
    await waitFor(() => screen.getAllByTestId("song-check"));
    fireEvent.click(screen.getAllByTestId("song-check")[0]!);
    fireEvent.click(screen.getAllByTestId("song-check")[1]!);
    fireEvent.click(screen.getByTestId("delete-selected"));
    await screen.findByTestId("confirm-delete");
    switchToMarkers();
    await waitFor(() =>
      expect(screen.getByTestId("confirm-delete")).toHaveTextContent(
        "⟦deleteManyTitle⟧",
      ),
    );
    expect(leftovers()).toEqual([]);
  });

  it("changes the discard confirmation", async () => {
    await renderDb();
    fireEvent.click(screen.getByTestId("edit-song"));
    await screen.findByTestId("editor");
    fireEvent.click(screen.getByTestId("editor-tab-source"));
    fireEvent.change(await screen.findByTestId("editor-input"), {
      target: { value: "{title: Changed}\n" },
    });
    fireEvent.click(screen.getByTestId("new-song"));
    await screen.findByTestId("confirm-discard");
    switchToMarkers();
    await waitFor(() =>
      expect(screen.getByTestId("confirm-discard")).toHaveTextContent(
        "⟦discardTitle⟧",
      ),
    );
    expect(screen.getByTestId("confirm-discard")).toHaveTextContent(
      "⟦discardBody⟧",
    );
    expect(leftovers()).toEqual([]);
  });

  it("changes search hits, no results and the pending text", async () => {
    await renderDb();
    vi.mocked(searchSongs).mockResolvedValue([
      {
        song: summaries()[0]!,
        snippet: null,
      } as unknown as Awaited<ReturnType<typeof searchSongs>>[number],
    ]);
    fireEvent.change(screen.getByTestId("search-input"), {
      target: { value: "alpha" },
    });
    await screen.findByTestId("search-results");
    switchToMarkers();
    await waitFor(() =>
      expect(screen.getByTestId("search-results")).toHaveAttribute(
        "aria-label",
        "⟦searchResults⟧",
      ),
    );
    expect(renderedStrings()).toContain("⟦deleteSongNamed⟧");
    expect(leftovers()).toEqual([]);

    await i18n.changeLanguage("en");
    vi.mocked(searchSongs).mockResolvedValue([]);
    fireEvent.change(screen.getByTestId("search-input"), {
      target: { value: "nothing" },
    });
    await screen.findByTestId("search-empty");
    switchToMarkers();
    await waitFor(() =>
      expect(screen.getByTestId("search-empty")).toHaveTextContent(
        "⟦noResults⟧",
      ),
    );
    expect(leftovers()).toEqual([]);

    await i18n.changeLanguage("en");
    vi.mocked(searchSongs).mockReturnValue(new Promise(() => undefined));
    fireEvent.change(screen.getByTestId("search-input"), {
      target: { value: "pending" },
    });
    await screen.findByTestId("search-pending");
    await waitFor(() =>
      expect(screen.getByTestId("search-pending")).toHaveTextContent(
        "Searching",
      ),
    );
    switchToMarkers();
    await waitFor(() =>
      expect(screen.getByTestId("search-pending")).toHaveTextContent(
        "⟦searching⟧",
      ),
    );
    expect(leftovers()).toEqual([]);
  });

  it("changes the import report and the reviewing line", async () => {
    const files: Record<string, string> = {
      "/m/a.cho": "{title: Gamma}\n[C]Gamma [G]line\n",
      "/m/e.txt": "Am      G\nhello world yes\n",
      "/m/he.txt": "Am      G\nשלום עולם יפה\n",
    };
    vi.mocked(pickSongFiles).mockResolvedValue(Object.keys(files));
    vi.mocked(readTextFile).mockImplementation((path) =>
      Promise.resolve(files[path] ?? ""),
    );
    let next = 0;
    vi.mocked(saveSong).mockImplementation((text) => {
      const id = `n${++next}`;
      db.set(id, text);
      return Promise.resolve({
        id,
        chordpro: text,
        createdAt: "",
        updatedAt: "",
      } as unknown as Song);
    });
    await renderDb();
    fireEvent.click(screen.getByTestId("open-files"));
    await screen.findByTestId("import-report");
    await screen.findByTestId("reviewing-file");
    switchToMarkers();
    await waitFor(() =>
      expect(screen.getByTestId("import-summary")).toHaveTextContent(
        "⟦importSummary⟧",
      ),
    );
    expect(screen.getByTestId("import-queued")).toHaveTextContent(
      "⟦importQueued⟧",
    );
    expect(screen.getByTestId("import-converted")).toHaveTextContent(
      "⟦importConverted⟧",
    );
    expect(leftovers()).toEqual([]);
  });

  it("retranslates the delete status and the failure notice after the switch", async () => {
    vi.mocked(deleteSong).mockReset();
    vi.mocked(deleteSong).mockResolvedValue(undefined);
    await renderDb();
    fireEvent.click(screen.getAllByTestId("song-delete")[0]!);
    fireEvent.click(await screen.findByTestId("confirm-delete-yes"));
    await waitFor(() =>
      expect(screen.getByTestId("delete-status")).toHaveTextContent(
        "Deleted 1 song",
      ),
    );
    switchToMarkers();
    await waitFor(() =>
      expect(screen.getByTestId("delete-status")).toHaveTextContent(
        "⟦deletedCount⟧",
      ),
    );
    expect(leftovers()).toEqual([]);
    await i18n.changeLanguage("en");

    vi.mocked(deleteSong).mockRejectedValue(new Error("boom"));
    fireEvent.click(screen.getAllByTestId("song-delete")[0]!);
    fireEvent.click(await screen.findByTestId("confirm-delete-yes"));
    await waitFor(() =>
      expect(screen.getByTestId("app-notice")).toHaveTextContent(
        "Could not delete the song: boom",
      ),
    );
    switchToMarkers();
    await waitFor(() =>
      expect(screen.getByTestId("app-notice").textContent).toBe(
        "⟦deleteFailed⟧: boom",
      ),
    );
    expect(leftovers()).toEqual([]);
  });

  it("keeps the locale toggle in its native names under the marker bundle", async () => {
    await renderDb();
    switchToMarkers();
    await waitFor(() =>
      expect(screen.getByTestId("new-song")).toHaveTextContent("⟦newSong⟧"),
    );
    const group = screen.getByTestId("locale-toggle");
    expect(group).toHaveAttribute("aria-label", "⟦uiLanguage⟧");
    const he = screen.getByTestId("locale-he");
    const en = screen.getByTestId("locale-en");
    expect(he).toHaveTextContent(EN.localeHebrewShort);
    expect(en).toHaveTextContent(EN.localeEnglishShort);
    expect(he).toHaveAttribute("aria-label", EN.localeHebrew);
    expect(en).toHaveAttribute("aria-label", EN.localeEnglish);
  });
});
