// g12 cross-task (D7): a failed export of the open song shows `exportSongFailed`, a failed
// setlist export shows `exportFailed`, in English and Hebrew. IPC and renderers are mocked.
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { printExport, saveDocx } from "./export";
import { i18n } from "./i18n";
import { HE } from "./i18n/he";
import { applyDocumentLocale, LOCALE_STORAGE_KEY } from "./i18n/locale";
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
  removeSetlistItem,
  renameSetlist,
  reorderSetlistItems,
  searchSongs,
  updateSetlistItem,
} from "./storage";
import type { Setlist, SetlistSummary, Song, SongSummary } from "./storage";
import { STRINGS } from "./strings";

vi.mock("./uiReady", () => ({ signalUiReady: vi.fn() }));
vi.mock("./storage", () => ({
  listSongs: vi.fn(),
  getSong: vi.fn(),
  searchSongs: vi.fn(),
  saveSong: vi.fn(),
  deleteSong: vi.fn(),
  listSetlists: vi.fn(),
  getSetlist: vi.fn(),
  createSetlist: vi.fn(),
  renameSetlist: vi.fn(),
  deleteSetlist: vi.fn(),
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
vi.mock("./export", () => ({
  printExport: vi.fn(),
  saveDocx: vi.fn(),
}));

const BODY = "{title: Lantern Row}\n{key: C}\n[C]Lanterns [F]hang low";
const SUMMARY = {
  id: "a",
  title: "Lantern Row",
  artist: null,
  key: null,
  language: "en",
  updatedAt: "2026-01-01T00:00:00Z",
} as SongSummary;
const SETLIST: Setlist = {
  id: "sl1",
  name: "Sunday",
  createdAt: "",
  updatedAt: "",
  items: [
    {
      id: "i1",
      songId: "a",
      position: 0,
      transpose: 0,
      capo: null,
      title: "Lantern Row",
      artist: null,
      key: null,
      songCapo: null,
      language: "en",
    },
  ],
};

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(listSongs).mockResolvedValue([SUMMARY]);
  vi.mocked(getSong).mockImplementation((id) =>
    Promise.resolve({
      id,
      chordpro: BODY,
      createdAt: "",
      updatedAt: "",
    } as unknown as Song),
  );
  vi.mocked(searchSongs).mockResolvedValue([]);
  vi.mocked(deleteSong).mockResolvedValue(undefined);
  vi.mocked(listSetlists).mockResolvedValue([
    {
      id: "sl1",
      name: "Sunday",
      itemCount: 1,
      updatedAt: "",
    } as SetlistSummary,
  ]);
  vi.mocked(getSetlist).mockResolvedValue(SETLIST);
  for (const fn of [
    createSetlist,
    renameSetlist,
    duplicateSetlist,
    addSetlistItems,
    removeSetlistItem,
    reorderSetlistItems,
    updateSetlistItem,
  ]) {
    vi.mocked(fn as (...a: never[]) => Promise<Setlist>).mockResolvedValue(
      SETLIST,
    );
  }
  vi.mocked(deleteSetlist).mockResolvedValue(undefined);
  vi.mocked(printExport).mockReset().mockResolvedValue(undefined);
  vi.mocked(saveDocx).mockReset();
});

afterEach(async () => {
  cleanup();
  window.localStorage.removeItem(LOCALE_STORAGE_KEY);
  await i18n.changeLanguage("en");
  applyDocumentLocale(document, "en");
  vi.clearAllMocks();
});

const notice = async (): Promise<string> =>
  (await screen.findByTestId("app-notice")).textContent ?? "";

describe("export failure notices", () => {
  it("the open song's Word and print failures show exportSongFailed", async () => {
    expect(STRINGS.exportSongFailed).not.toBe(STRINGS.exportFailed);
    render(<App />);
    await screen.findByTestId("song-title");
    vi.mocked(saveDocx).mockRejectedValueOnce(new Error("disk full"));
    fireEvent.click(screen.getByTestId("song-export-word"));
    expect(await notice()).toBe(STRINGS.exportSongFailed);
    expect(saveDocx).toHaveBeenCalledTimes(1);

    cleanup();
    vi.mocked(printExport).mockRejectedValueOnce(new Error("no print"));
    render(<App />);
    await screen.findByTestId("song-title");
    fireEvent.click(screen.getByTestId("song-print"));
    await waitFor(() => expect(printExport).toHaveBeenCalledTimes(1));
    expect(await notice()).toBe(STRINGS.exportSongFailed);
  });

  it("a setlist Word failure shows exportFailed", async () => {
    render(<App />);
    await screen.findByTestId("song-title");
    fireEvent.click(screen.getByTestId("tab-setlists"));
    fireEvent.click(await screen.findByTestId("setlist-select"));
    await screen.findByTestId("setlist-editor");
    vi.mocked(saveDocx).mockRejectedValueOnce(new Error("disk full"));
    fireEvent.click(screen.getByTestId("setlist-export-word"));
    expect(await notice()).toBe(STRINGS.exportFailed);
    expect(saveDocx).toHaveBeenCalledTimes(1);
  });

  it("the Hebrew locale shows HE.exportSongFailed for the open song", async () => {
    expect(HE.exportSongFailed).not.toBe(STRINGS.exportSongFailed);
    render(<App />);
    await screen.findByTestId("song-title");
    fireEvent.click(screen.getByTestId("locale-he"));
    await waitFor(() =>
      expect(screen.getByTestId("song-print")).toHaveTextContent(HE.print),
    );
    vi.mocked(saveDocx).mockRejectedValueOnce(new Error("disk full"));
    fireEvent.click(screen.getByTestId("song-export-word"));
    expect(await notice()).toBe(HE.exportSongFailed);
  });
});
