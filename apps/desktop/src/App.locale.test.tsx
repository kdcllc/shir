import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { HE } from "./i18n/he";
import { STRINGS } from "./strings";
import { getSong, listSongs, searchSongs } from "./storage";
import type { Song, SongSummary } from "./storage";

vi.mock("./uiReady", () => ({ signalUiReady: vi.fn() }));
vi.mock("./storage", () => ({
  listSongs: vi.fn(),
  getSong: vi.fn(),
  searchSongs: vi.fn(),
  saveSong: vi.fn(),
  deleteSong: vi.fn(),
}));

const TEXTS = new Map<string, string>([
  ["en1", "{title: Alpha}\n[C]Alpha [G]line here\n"],
  ["he1", "{title: שלום}\n[C]שלום [G]עולם\n"],
]);

function summaries(): SongSummary[] {
  return [
    {
      id: "en1",
      title: "Alpha",
      artist: null,
      key: null,
      language: "en",
      updatedAt: "2026-01-01T00:00:00Z",
    },
    {
      id: "he1",
      title: "שלום",
      artist: null,
      key: null,
      language: "he",
      updatedAt: "2026-01-01T00:00:00Z",
    },
  ] as SongSummary[];
}

beforeEach(() => {
  vi.mocked(listSongs).mockReset();
  vi.mocked(getSong).mockReset();
  vi.mocked(searchSongs).mockReset();
  vi.mocked(listSongs).mockImplementation(() => Promise.resolve(summaries()));
  vi.mocked(getSong).mockImplementation((id) =>
    Promise.resolve({
      id,
      chordpro: TEXTS.get(id) ?? "",
      createdAt: "",
      updatedAt: "",
    } as unknown as Song),
  );
});

async function renderDb() {
  render(<App />);
  await screen.findByTestId("song-index");
  await screen.findByTestId("song-title");
}

function songRoot(): HTMLElement {
  return document.querySelector<HTMLElement>("[data-song]")!;
}

async function openSong(title: string) {
  const item = screen
    .getAllByTestId("song-item")
    .find((el) => el.textContent?.includes(title))!;
  fireEvent.click(item);
  await waitFor(() =>
    expect(screen.getByTestId("song-title")).toHaveTextContent(title),
  );
}

describe("App interface language", () => {
  it("puts the toggle in the sidebar heading row", async () => {
    await renderDb();
    const toggle = screen.getByTestId("locale-toggle");
    const h1 = document.querySelector("h1")!;
    expect(toggle.parentElement).toBe(h1.parentElement);
  });

  it("switches html lang/dir, strings and storage, and back", async () => {
    await renderDb();
    expect(document.documentElement.lang).toBe("en");
    expect(screen.getByTestId("new-song")).toHaveTextContent(STRINGS.newSong);
    fireEvent.click(screen.getByTestId("locale-he"));
    await waitFor(() =>
      expect(screen.getByTestId("new-song")).toHaveTextContent(HE.newSong),
    );
    expect(document.documentElement.lang).toBe("he");
    expect(document.documentElement.dir).toBe("rtl");
    expect(window.localStorage.getItem("shir.locale")).toBe("he");
    expect(screen.getByTestId("edit-song")).toHaveTextContent(HE.editSong);
    expect(screen.getByTestId("locale-toggle")).toHaveAttribute(
      "aria-label",
      HE.uiLanguage,
    );
    fireEvent.click(screen.getByTestId("locale-en"));
    await waitFor(() =>
      expect(screen.getByTestId("new-song")).toHaveTextContent(STRINGS.newSong),
    );
    expect(document.documentElement.lang).toBe("en");
    expect(document.documentElement.dir).toBe("ltr");
    expect(window.localStorage.getItem("shir.locale")).toBe("en");
  });

  it.each(["en", "he"] as const)(
    "songs keep their own direction under the %s interface",
    async (ui) => {
      await renderDb();
      if (ui === "he") fireEvent.click(screen.getByTestId("locale-he"));
      for (const title of ["Alpha", "שלום"]) {
        await openSong(title);
        // The song resolves its own direction from its text, never the UI's.
        expect(songRoot().getAttribute("dir")).toBe("auto");
        const lines = songRoot().querySelectorAll("[data-line]");
        expect(lines.length).toBeGreaterThan(0);
        for (const line of lines) expect(line.getAttribute("dir")).toBe("auto");
        for (const chord of songRoot().querySelectorAll("[data-chord]"))
          expect(chord.getAttribute("dir")).toBe("ltr");
      }
    },
  );

  it("keeps user-text inputs on dir=auto in Hebrew", async () => {
    await renderDb();
    fireEvent.click(screen.getByTestId("locale-he"));
    expect(screen.getByTestId("search-input")).toHaveAttribute("dir", "auto");
  });
});
