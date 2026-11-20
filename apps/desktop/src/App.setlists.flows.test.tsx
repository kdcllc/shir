import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ExportDocument } from "chord-core";
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
  pickSongFiles: vi.fn(),
  readTextFile: vi.fn(),
  saveExportDocx: vi.fn(),
}));
vi.mock("./export", () => ({
  printExport: vi.fn(),
  saveDocx: vi.fn(),
}));

const summary = (id: string, title: string): SongSummary =>
  ({
    id,
    title,
    artist: null,
    key: null,
    language: "en",
    updatedAt: "2026-01-01T00:00:00Z",
  }) as SongSummary;

// Original, neutral song text.
const SONGS: Record<string, { title: string; body: string }> = {
  a: { title: "Alpha", body: "{title: Alpha}\n{key: C}\n[C]Alpha [F]line" },
  b: {
    title: "Beta",
    body: "{title: Beta}\n{key: Am}\n{capo: 2}\n[Am]Beta [G]line",
  },
  c: { title: "Gamma", body: "{title: Gamma}\n{key: G}\n[G]Gamma [D]line" },
};
const LIST = Object.entries(SONGS).map(([id, s]) => summary(id, s.title));
const ID_OF = new Map(Object.entries(SONGS).map(([id, s]) => [s.title, id]));

let store: Setlist[];
let counter: number;

const entryFor = (songId: string): Setlist["items"][number] => ({
  id: `i${++counter}`,
  songId,
  position: 0,
  transpose: 0,
  capo: null,
  title: SONGS[songId]!.title,
  artist: null,
  key: null,
  songCapo: null,
  language: "en",
});
const renumber = (s: Setlist): Setlist => ({
  ...s,
  items: s.items.map((it, position) => ({ ...it, position })),
});
const put = (next: Setlist): Setlist => {
  const done = renumber(next);
  store = store.map((s) => (s.id === done.id ? done : s));
  return done;
};
const find = (id: string): Setlist => store.find((s) => s.id === id)!;
const seed = (
  name = "Sunday",
  songIds: string[] = ["a", "b"],
  id = "sl1",
): Setlist => {
  const list = renumber({
    id,
    name,
    createdAt: "",
    updatedAt: "",
    items: songIds.map(entryFor),
  });
  store.push(list);
  return list;
};

const entryTitles = (): string[] =>
  screen
    .queryAllByTestId("setlist-entry-title")
    .map((el) => el.textContent ?? "");
const heading = (): string =>
  screen.getByTestId("setlist-editor").querySelector("h2")!.textContent ?? "";

async function openSeeded(): Promise<void> {
  render(<App />);
  await screen.findByTestId("song-title");
  fireEvent.click(screen.getByTestId("tab-setlists"));
  fireEvent.click(await screen.findByTestId("setlist-select"));
  await screen.findByTestId("setlist-editor");
}

/** The document passed to the mocked renderers, with its options. */
function lastExport(fn: typeof printExport | typeof saveDocx) {
  const call = vi.mocked(fn as typeof printExport).mock.calls.at(-1)!;
  return {
    doc: call[0] as ExportDocument,
    opts: call[1] as unknown as {
      cover: boolean;
      mode?: string;
      labels: Record<string, string>;
      meta: { lang: string; dir: string };
    },
  };
}

beforeEach(() => {
  store = [];
  counter = 0;
  window.localStorage.clear();
  vi.mocked(listSongs).mockResolvedValue(LIST);
  vi.mocked(getSong).mockImplementation((id) =>
    Promise.resolve({
      id,
      chordpro: SONGS[id]!.body,
      createdAt: "",
      updatedAt: "",
    } as unknown as Song),
  );
  vi.mocked(searchSongs).mockResolvedValue([]);
  vi.mocked(deleteSong).mockResolvedValue(undefined);
  vi.mocked(listSetlists).mockImplementation(() =>
    Promise.resolve(
      store.map((s): SetlistSummary => ({
        id: s.id,
        name: s.name,
        itemCount: s.items.length,
        updatedAt: "",
      })),
    ),
  );
  vi.mocked(getSetlist).mockImplementation((id) => Promise.resolve(find(id)));
  vi.mocked(createSetlist).mockImplementation((name) => {
    const list = renumber({
      id: `sl${store.length + 1}`,
      name,
      createdAt: "",
      updatedAt: "",
      items: [],
    });
    store.push(list);
    return Promise.resolve(list);
  });
  vi.mocked(renameSetlist).mockImplementation((id, name) =>
    Promise.resolve(put({ ...find(id), name })),
  );
  vi.mocked(deleteSetlist).mockImplementation((id) => {
    store = store.filter((s) => s.id !== id);
    return Promise.resolve();
  });
  vi.mocked(duplicateSetlist).mockImplementation((id, name) => {
    const copy = renumber({
      ...find(id),
      id: `copy${store.length}`,
      name,
      items: find(id).items.map((it) => ({ ...it, id: `c${++counter}` })),
    });
    store.push(copy);
    return Promise.resolve(copy);
  });
  vi.mocked(addSetlistItems).mockImplementation((id, songIds) =>
    Promise.resolve(
      put({
        ...find(id),
        items: [...find(id).items, ...songIds.map(entryFor)],
      }),
    ),
  );
  vi.mocked(removeSetlistItem).mockImplementation((id, itemId) =>
    Promise.resolve(
      put({
        ...find(id),
        items: find(id).items.filter((i) => i.id !== itemId),
      }),
    ),
  );
  vi.mocked(reorderSetlistItems).mockImplementation((id, order) =>
    Promise.resolve(
      put({
        ...find(id),
        items: order.map((o) => find(id).items.find((i) => i.id === o)!),
      }),
    ),
  );
  vi.mocked(updateSetlistItem).mockImplementation(
    (id, itemId, transpose, capo) =>
      Promise.resolve(
        put({
          ...find(id),
          items: find(id).items.map((i) =>
            i.id === itemId ? { ...i, transpose, capo } : i,
          ),
        }),
      ),
  );
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

describe("bundled mode", () => {
  it("hides the Setlists tab and never touches setlist storage", async () => {
    vi.mocked(listSongs).mockRejectedValue(new Error("unavailable"));
    render(<App />);
    await screen.findAllByTestId("song-item");
    expect(screen.queryByTestId("tab-setlists")).toBeNull();
    expect(screen.queryByTestId("sidebar-tabs")).toBeNull();
    expect(listSetlists).not.toHaveBeenCalled();
  });
});

describe("setlist editing flow", () => {
  it("create, add from select mode in library order, move down, transpose and capo, remove", async () => {
    render(<App />);
    await screen.findByTestId("song-title");
    fireEvent.click(screen.getByTestId("tab-setlists"));
    fireEvent.change(screen.getByTestId("setlist-name-input"), {
      target: { value: "Sunday" },
    });
    fireEvent.click(screen.getByTestId("setlist-create"));
    await screen.findByTestId("setlist-editor");
    expect(createSetlist).toHaveBeenCalledExactlyOnceWith("Sunday");
    expect(heading()).toBe("Sunday");

    // Pick the last then the first row; the call lists them in library order.
    fireEvent.click(screen.getByTestId("tab-songs"));
    fireEvent.click(screen.getByTestId("select-songs"));
    const listed = screen
      .getAllByTestId("song-item")
      .map((el) => el.querySelector("span")?.textContent ?? "");
    expect(listed).toHaveLength(3);
    fireEvent.click(screen.getAllByTestId("song-check")[2]!);
    fireEvent.click(screen.getAllByTestId("song-check")[0]!);
    fireEvent.click(screen.getByTestId("add-selected-to-setlist"));
    fireEvent.click(screen.getAllByTestId("add-to-setlist-option")[0]!);
    fireEvent.click(screen.getByTestId("add-to-setlist-confirm"));
    const wantIds = [listed[0]!, listed[2]!].map((t) => ID_OF.get(t)!);
    await waitFor(() =>
      expect(addSetlistItems).toHaveBeenCalledExactlyOnceWith("sl1", wantIds),
    );
    await waitFor(() => expect(entryTitles()).toHaveLength(2));
    expect(entryTitles()).toEqual([listed[0], listed[2]]);

    // Move the first entry down.
    const [first, second] = find("sl1").items.map((i) => i.id);
    fireEvent.click(screen.getAllByTestId("setlist-entry-down")[0]!);
    await waitFor(() =>
      expect(reorderSetlistItems).toHaveBeenCalledExactlyOnceWith("sl1", [
        second,
        first,
      ]),
    );
    await waitFor(() => expect(entryTitles()).toEqual([listed[2], listed[0]]));

    // Transpose the first row's entry, then set its capo.
    fireEvent.click(screen.getAllByTestId("setlist-entry-transpose-up")[0]!);
    await waitFor(() =>
      expect(updateSetlistItem).toHaveBeenLastCalledWith(
        "sl1",
        second,
        1,
        null,
      ),
    );
    await waitFor(() =>
      expect(
        screen.getAllByTestId("setlist-entry-transpose-value")[0]!.textContent,
      ).toContain("1"),
    );
    fireEvent.change(screen.getAllByTestId("setlist-entry-capo")[0]!, {
      target: { value: "4" },
    });
    await waitFor(() =>
      expect(updateSetlistItem).toHaveBeenLastCalledWith("sl1", second, 1, 4),
    );
    expect(updateSetlistItem).toHaveBeenCalledTimes(2);

    // Remove the first entry: only the other one remains.
    fireEvent.click(screen.getAllByTestId("setlist-entry-remove")[0]!);
    await waitFor(() =>
      expect(removeSetlistItem).toHaveBeenCalledExactlyOnceWith("sl1", second),
    );
    await waitFor(() => expect(entryTitles()).toEqual([listed[0]]));
  }, 20000);

  it("a storage failure shows setlistSaveFailed and keeps the previous order", async () => {
    seed("Sunday", ["a", "b", "c"]);
    await openSeeded();
    expect(entryTitles()).toEqual(["Alpha", "Beta", "Gamma"]);
    vi.mocked(reorderSetlistItems).mockRejectedValueOnce(new Error("disk"));
    fireEvent.click(screen.getAllByTestId("setlist-entry-down")[0]!);
    expect((await screen.findByTestId("app-notice")).textContent).toBe(
      STRINGS.setlistSaveFailed,
    );
    expect(reorderSetlistItems).toHaveBeenCalledTimes(1);
    expect(entryTitles()).toEqual(["Alpha", "Beta", "Gamma"]);
    // A later successful move works and clears the notice.
    fireEvent.click(screen.getAllByTestId("setlist-entry-down")[0]!);
    await waitFor(() =>
      expect(entryTitles()).toEqual(["Beta", "Alpha", "Gamma"]),
    );
    expect(screen.queryByTestId("app-notice")).toBeNull();
  });

  it("rename: Escape cancels without a call, Enter saves", async () => {
    seed("Sunday");
    await openSeeded();
    fireEvent.click(screen.getByTestId("setlist-rename"));
    const input = screen.getByTestId("setlist-rename-input");
    fireEvent.change(input, { target: { value: "Evening" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByTestId("setlist-rename-input")).toBeNull();
    expect(renameSetlist).not.toHaveBeenCalled();
    expect(within(screen.getByTestId("setlist-select")).getByText("Sunday"));
    expect(heading()).toBe("Sunday");

    fireEvent.click(screen.getByTestId("setlist-rename"));
    const again = screen.getByTestId("setlist-rename-input");
    fireEvent.change(again, { target: { value: "  Evening  " } });
    fireEvent.keyDown(again, { key: "Enter" });
    await waitFor(() =>
      expect(renameSetlist).toHaveBeenCalledExactlyOnceWith("sl1", "Evening"),
    );
    await waitFor(() => expect(heading()).toBe("Evening"));
    expect(find("sl1").name).toBe("Evening");
  });

  it("duplicate stores the plain localized suffix, with no bidi isolate characters", async () => {
    seed("Sunday");
    await openSeeded();
    fireEvent.click(screen.getByTestId("setlist-duplicate"));
    const expected = `Sunday ${STRINGS.duplicateSuffix}`;
    await waitFor(() =>
      expect(duplicateSetlist).toHaveBeenCalledExactlyOnceWith("sl1", expected),
    );
    const stored = vi.mocked(duplicateSetlist).mock.calls[0]![1];
    expect(stored).toBe("Sunday (copy)");
    expect(stored).not.toMatch(/[⁦-⁩]/);
    await waitFor(() => expect(heading()).toBe(expected));
  });

  it("delete needs the confirmation; cancel keeps the setlist", async () => {
    seed("Sunday");
    await openSeeded();
    fireEvent.click(screen.getByTestId("setlist-delete"));
    expect(deleteSetlist).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("confirm-delete-setlist-cancel"));
    expect(deleteSetlist).not.toHaveBeenCalled();
    expect(screen.getByTestId("setlist-editor")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("setlist-delete"));
    expect(deleteSetlist).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("confirm-delete-setlist-yes"));
    await waitFor(() =>
      expect(deleteSetlist).toHaveBeenCalledExactlyOnceWith("sl1"),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("setlist-editor")).toBeNull(),
    );
  });

  it("opening an entry shows the song at the entry's transpose and capo", async () => {
    seed("Sunday", ["a", "b"]);
    store[0]!.items[1] = { ...store[0]!.items[1]!, transpose: 2, capo: 3 };
    await openSeeded();
    fireEvent.click(screen.getAllByTestId("setlist-entry-title")[1]!);
    await screen.findByTestId("song-title");
    expect(screen.getByTestId("song-title").textContent).toContain("Beta");
    expect(screen.queryByTestId("setlist-editor")).toBeNull();
    expect(screen.getByTestId("capo-select")).toHaveValue("3");
    expect(screen.getByTestId("transpose-value").textContent).toContain("2");
  });

  it("opening an entry of a duplicated song uses that entry's transpose and capo", async () => {
    seed("Sunday", ["b", "b"]);
    store[0]!.items[0] = { ...store[0]!.items[0]!, transpose: 2, capo: 1 };
    store[0]!.items[1] = { ...store[0]!.items[1]!, transpose: 5, capo: 4 };
    await openSeeded();
    fireEvent.click(screen.getAllByTestId("setlist-entry-title")[1]!);
    await waitFor(() =>
      expect(screen.queryByTestId("setlist-editor")).toBeNull(),
    );
    expect(screen.getByTestId("capo-select")).toHaveValue("4");
    expect(screen.getByTestId("transpose-value").textContent).toContain("5");
    fireEvent.click(screen.getByTestId("tab-setlists"));
    fireEvent.click(await screen.findByTestId("setlist-select"));
    await screen.findByTestId("setlist-editor");
    fireEvent.click(screen.getAllByTestId("setlist-entry-title")[0]!);
    await waitFor(() =>
      expect(screen.queryByTestId("setlist-editor")).toBeNull(),
    );
    expect(screen.getByTestId("capo-select")).toHaveValue("1");
    expect(screen.getByTestId("transpose-value").textContent).toContain("2");
  });

  it("deleting a song refreshes the open setlist", async () => {
    seed("Sunday", ["a", "b"]);
    await openSeeded();
    expect(entryTitles()).toEqual(["Alpha", "Beta"]);
    fireEvent.click(screen.getByTestId("tab-songs"));
    fireEvent.click(screen.getByTestId("select-songs"));
    const rows = screen
      .getAllByTestId("song-item")
      .map((el) => el.querySelector("span")?.textContent ?? "");
    fireEvent.click(screen.getAllByTestId("song-check")[rows.indexOf("Beta")]!);
    vi.mocked(deleteSong).mockImplementation(() => {
      put({
        ...find("sl1"),
        items: find("sl1").items.filter((i) => i.songId !== "b"),
      });
      return Promise.resolve();
    });
    vi.mocked(getSetlist).mockClear();
    fireEvent.click(screen.getByTestId("delete-selected"));
    fireEvent.click(screen.getByTestId("confirm-delete-yes"));
    await waitFor(() => expect(getSetlist).toHaveBeenCalledWith("sl1"));
    await waitFor(() => expect(entryTitles()).toEqual(["Alpha"]));
  });
});

describe("exports", () => {
  it("setlist Print, PDF and Word pass cover: true and each entry's transpose and capo", async () => {
    seed("Sunday", ["a", "b"]);
    store[0]!.items[0] = { ...store[0]!.items[0]!, transpose: 2, capo: 3 };
    // Entry b keeps capo null: the song's own capo (2) applies.
    await openSeeded();

    for (const [testId, mode] of [
      ["setlist-print", "print"],
      ["setlist-export-pdf", "pdf"],
    ] as const) {
      vi.mocked(printExport).mockClear();
      fireEvent.click(screen.getByTestId(testId));
      await waitFor(() => expect(printExport).toHaveBeenCalledTimes(1));
      const { doc, opts } = lastExport(printExport);
      expect(opts.cover).toBe(true);
      expect(opts.mode).toBe(mode);
      expect(doc.title).toBe("Sunday");
      expect(doc.songs.map((s) => s.title)).toEqual(["Alpha", "Beta"]);
      expect(doc.songs.map((s) => [s.transpose, s.capo])).toEqual([
        [2, 3],
        [0, 2],
      ]);
      await waitFor(() => expect(screen.getByTestId(testId)).toBeEnabled());
    }

    vi.mocked(saveDocx).mockResolvedValueOnce({
      status: "saved",
      path: "/tmp/Sunday (2).docx",
    });
    fireEvent.click(screen.getByTestId("setlist-export-word"));
    await waitFor(() => expect(saveDocx).toHaveBeenCalledTimes(1));
    const { doc, opts } = lastExport(saveDocx);
    expect(opts.cover).toBe(true);
    expect(doc.songs.map((s) => [s.transpose, s.capo])).toEqual([
      [2, 3],
      [0, 2],
    ]);
    expect((opts as unknown as { filterName: string }).filterName).toBe(
      STRINGS.fileFilterWord,
    );
    // The status names the saved file (basename), isolated for bidi.
    await waitFor(() =>
      expect(screen.getByTestId("app-status").textContent).toBe(
        "Saved ⁨Sunday (2).docx⁩",
      ),
    );
    // Word never goes through the print path.
    expect(printExport).toHaveBeenCalledTimes(1);
  }, 20000);

  it("Word cancel shows no notice and no status; a failure shows exportFailed", async () => {
    seed("Sunday");
    await openSeeded();
    vi.mocked(saveDocx).mockResolvedValueOnce({ status: "cancelled" });
    fireEvent.click(screen.getByTestId("setlist-export-word"));
    await waitFor(() => expect(saveDocx).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId("setlist-export-word")).toBeEnabled(),
    );
    expect(screen.queryByTestId("app-notice")).toBeNull();
    expect(screen.queryByTestId("app-status")).toBeNull();

    vi.mocked(saveDocx).mockRejectedValueOnce(new Error("disk full"));
    fireEvent.click(screen.getByTestId("setlist-export-word"));
    expect((await screen.findByTestId("app-notice")).textContent).toBe(
      STRINGS.exportFailed,
    );
    expect(screen.queryByTestId("app-status")).toBeNull();

    vi.mocked(printExport).mockRejectedValueOnce(new Error("no print"));
    fireEvent.click(screen.getByTestId("setlist-print"));
    await waitFor(() => expect(printExport).toHaveBeenCalledTimes(1));
    expect((await screen.findByTestId("app-notice")).textContent).toBe(
      STRINGS.exportFailed,
    );
  });

  it("open-song exports use cover: false and the current transpose and capo", async () => {
    render(<App />);
    await screen.findByTestId("song-title");
    // First song in the library is Alpha (title order); move it up one and set a capo.
    const title = screen.getByTestId("song-title").textContent ?? "";
    fireEvent.click(screen.getByTestId("transpose-up"));
    fireEvent.click(screen.getByTestId("transpose-up"));
    fireEvent.change(screen.getByTestId("capo-select"), {
      target: { value: "5" },
    });

    fireEvent.click(screen.getByTestId("song-print"));
    await waitFor(() => expect(printExport).toHaveBeenCalledTimes(1));
    let call = lastExport(printExport);
    expect(call.opts.cover).toBe(false);
    expect(call.opts.mode).toBe("print");
    expect(call.doc.songs).toHaveLength(1);
    expect(call.doc.songs[0]!.transpose).toBe(2);
    expect(call.doc.songs[0]!.capo).toBe(5);
    expect(title).toContain(call.doc.songs[0]!.title);
    await waitFor(() => expect(screen.getByTestId("song-print")).toBeEnabled());

    fireEvent.click(screen.getByTestId("song-export-pdf"));
    await waitFor(() => expect(printExport).toHaveBeenCalledTimes(2));
    call = lastExport(printExport);
    expect(call.opts.cover).toBe(false);
    expect(call.opts.mode).toBe("pdf");
    await waitFor(() =>
      expect(screen.getByTestId("song-export-word")).toBeEnabled(),
    );

    vi.mocked(saveDocx).mockResolvedValueOnce({ status: "cancelled" });
    fireEvent.click(screen.getByTestId("song-export-word"));
    await waitFor(() => expect(saveDocx).toHaveBeenCalledTimes(1));
    const word = lastExport(saveDocx);
    expect(word.opts.cover).toBe(false);
    expect(word.doc.songs[0]!.transpose).toBe(2);
    expect(word.doc.songs[0]!.capo).toBe(5);
  }, 20000);

  it("the Hebrew locale passes Hebrew labels and dir rtl", async () => {
    seed("Sunday");
    await openSeeded();
    fireEvent.click(screen.getByTestId("locale-he"));
    await waitFor(() =>
      expect(screen.getByTestId("setlist-print")).toHaveTextContent(HE.print),
    );
    fireEvent.click(screen.getByTestId("setlist-print"));
    await waitFor(() => expect(printExport).toHaveBeenCalledTimes(1));
    const { opts } = lastExport(printExport);
    expect(opts.meta.dir).toBe("rtl");
    expect(opts.meta.lang).toBe("he");
    expect(opts.labels).toEqual({
      setlist: HE.exportLabelSetlist,
      key: HE.exportLabelKey,
      capo: HE.exportLabelCapo,
      transpose: HE.exportLabelTranspose,
      songs: HE.exportLabelSongs,
      date: HE.exportLabelDate,
    });
    expect(HE.exportLabelSetlist).not.toBe(STRINGS.exportLabelSetlist);
  });

  it("the Hebrew locale stores a plain Hebrew duplicate suffix and Word uses the Hebrew filter name", async () => {
    seed("Sunday");
    await openSeeded();
    fireEvent.click(screen.getByTestId("locale-he"));
    await waitFor(() =>
      expect(screen.getByTestId("setlist-print")).toHaveTextContent(HE.print),
    );
    fireEvent.click(screen.getByTestId("setlist-duplicate"));
    await waitFor(() => expect(duplicateSetlist).toHaveBeenCalledTimes(1));
    const stored = vi.mocked(duplicateSetlist).mock.calls[0]![1];
    expect(stored).toBe(`Sunday ${HE.duplicateSuffix}`);
    expect(stored).not.toMatch(/[⁦-⁩]/);

    await waitFor(() =>
      expect(screen.getByTestId("setlist-export-word")).toBeEnabled(),
    );
    vi.mocked(saveDocx).mockResolvedValueOnce({ status: "cancelled" });
    fireEvent.click(screen.getByTestId("setlist-export-word"));
    await waitFor(() => expect(saveDocx).toHaveBeenCalledTimes(1));
    expect(
      (lastExport(saveDocx).opts as unknown as { filterName: string })
        .filterName,
    ).toBe(HE.fileFilterWord);
  });
});
