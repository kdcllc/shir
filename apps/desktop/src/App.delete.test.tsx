import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import {
  deleteSong,
  getSong,
  listSongs,
  saveSong,
  searchSongs,
} from "./storage";
import type { SearchHit, Song, SongSummary } from "./storage";
import {
  STRINGS,
  deleteConfirmTitle,
  deleteManyFailed,
  deleteManyTitle,
  deletedCount,
  selectedCount,
} from "./strings";

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

function hit(id: string, title: string): SearchHit {
  return { song: summary(id, title), snippet: null };
}

const DB_SONGS: Record<string, string> = {
  b: "{title: Beta}\n{key: Am}\n[Am]Beta [G]line",
  a: "{title: Alpha}\n{key: C}\n[C]Alpha [F]line",
  c: "{title: שיר}\n[C]שלום",
};
/** Title order is c (שיר), a (Alpha), b (Beta); the app opens c first. */
const DB_LIST = [
  summary("b", "Beta", "Bea"),
  summary("a", "Alpha"),
  summary("c", "שיר"),
];

/** The mocked database: `deleteSong` removes a row unless a test overrides it. */
let db: SongSummary[] = [];

function titles(): string[] {
  return screen
    .queryAllByTestId("song-item")
    .map((el) => el.querySelector("span")?.textContent ?? "");
}

const songTitle = () => screen.getByTestId("song-title").textContent;
const status = () => screen.getByTestId("delete-status").textContent;
const rowDelete = (index: number) =>
  screen.getAllByTestId("song-delete")[index]!;
const check = (index: number) => screen.getAllByTestId("song-check")[index]!;
const confirmYes = () =>
  fireEvent.click(screen.getByTestId("confirm-delete-yes"));
const dialogHeading = () =>
  within(screen.getByTestId("confirm-delete")).getByRole("heading", {
    level: 2,
  });
const dialogTitle = () => dialogHeading().textContent;

async function renderDb() {
  render(<App />);
  await screen.findByTestId("song-index");
  await screen.findByTestId("song-title");
}

/** Resolves once the delete run finished and the controls are enabled again. */
async function settled() {
  await waitFor(() => expect(screen.getByTestId("select-songs")).toBeEnabled());
  await waitFor(() => {
    for (const el of screen.queryAllByTestId("song-delete"))
      expect(el).toBeEnabled();
  });
}

describe("App delete (database mode)", () => {
  beforeEach(() => {
    db = [...DB_LIST];
    vi.mocked(listSongs).mockReset();
    vi.mocked(getSong).mockReset();
    vi.mocked(searchSongs).mockReset();
    vi.mocked(saveSong).mockReset();
    vi.mocked(deleteSong).mockReset();
    vi.mocked(listSongs).mockImplementation(() => Promise.resolve([...db]));
    vi.mocked(getSong).mockImplementation((id) =>
      Promise.resolve(stored(id, DB_SONGS[id]!)),
    );
    vi.mocked(deleteSong).mockImplementation((id) => {
      db = db.filter((s) => s.id !== id);
      return Promise.resolve();
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("controls", () => {
    it("renders the delete controls as UI chrome", async () => {
      await renderDb();
      expect(screen.getAllByTestId("song-delete")).toHaveLength(3);
      for (const id of ["delete-song", "selection-bar", "delete-status"])
        expect(screen.getByTestId(id)).toHaveAttribute("data-ui-chrome");
      expect(screen.getByTestId("delete-song").textContent).toBe(
        STRINGS.deleteAction,
      );
      const live = screen.getByTestId("delete-status");
      expect(live.tagName).toBe("P");
      expect(live).toHaveAttribute("role", "status");
      expect(live.textContent).toBe("");
    });

    it("places the selection bar above the song list and Delete next to Edit", async () => {
      await renderDb();
      const bar = screen.getByTestId("selection-bar");
      const nav = screen.getByRole("navigation");
      expect(
        bar.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(nav).not.toContainElement(bar);
      expect(screen.getByTestId("edit-song").nextElementSibling).toBe(
        screen.getByTestId("delete-song"),
      );
    });

    it("hides the open-song Delete button while the editor is open", async () => {
      await renderDb();
      fireEvent.click(screen.getByTestId("new-song"));
      expect(screen.getByTestId("editor")).toBeInTheDocument();
      expect(screen.queryByTestId("delete-song")).toBeNull();
    });

    it("bundled mode has no delete controls", async () => {
      vi.mocked(listSongs).mockRejectedValue(new Error("unavailable"));
      render(<App />);
      const rows = await screen.findAllByTestId("song-item");
      expect(rows.length).toBeGreaterThan(0);
      expect(screen.getByTestId("song-title")).toBeInTheDocument();
      for (const id of [
        "song-delete",
        "delete-song",
        "song-check",
        "selection-bar",
        "select-songs",
        "delete-status",
        "confirm-delete",
      ])
        expect(screen.queryByTestId(id)).toBeNull();
    });
  });

  describe("row delete", () => {
    it("confirm deletes that song once, reloads the list and reports it", async () => {
      const confirm = vi.spyOn(window, "confirm");
      await renderDb();
      expect(titles()).toEqual(["שיר", "Alpha", "Beta"]);
      expect(listSongs).toHaveBeenCalledTimes(1);

      fireEvent.click(rowDelete(1));
      const dialog = screen.getByTestId("confirm-delete");
      expect(dialog).toHaveAccessibleName(deleteConfirmTitle("Alpha"));
      expect(deleteSong).not.toHaveBeenCalled();

      confirmYes();
      expect(screen.queryByTestId("confirm-delete")).toBeNull();
      await waitFor(() => expect(titles()).toEqual(["שיר", "Beta"]));
      expect(deleteSong).toHaveBeenCalledExactlyOnceWith("a");
      expect(listSongs).toHaveBeenCalledTimes(2);
      expect(status()).toBe(deletedCount(1));
      expect(status()).toBe("Deleted 1 song");
      expect(screen.queryByTestId("app-notice")).toBeNull();
      expect(songTitle()).toBe("שיר");
      expect(confirm).not.toHaveBeenCalled();
    });

    it("names a Hebrew song in a dir=auto heading with the isolated title", async () => {
      await renderDb();
      fireEvent.click(rowDelete(0));
      const heading = dialogHeading();
      expect(heading).toHaveAttribute("dir", "auto");
      expect(heading.textContent).toBe(deleteConfirmTitle("שיר"));
      expect(heading.textContent).toBe("Delete \u2068שיר\u2069?");
    });

    it("Cancel closes the dialog and deletes nothing", async () => {
      await renderDb();
      fireEvent.click(rowDelete(1));
      expect(deleteSong).not.toHaveBeenCalled();
      fireEvent.click(screen.getByTestId("confirm-delete-cancel"));
      expect(screen.queryByTestId("confirm-delete")).toBeNull();
      await new Promise((r) => setTimeout(r, 20));
      expect(deleteSong).not.toHaveBeenCalled();
      expect(listSongs).toHaveBeenCalledTimes(1);
      expect(titles()).toEqual(["שיר", "Alpha", "Beta"]);
      expect(status()).toBe("");
    });

    it("Escape in the dialog cancels and deletes nothing", async () => {
      await renderDb();
      fireEvent.click(rowDelete(2));
      fireEvent.keyDown(screen.getByTestId("confirm-delete"), {
        key: "Escape",
      });
      expect(screen.queryByTestId("confirm-delete")).toBeNull();
      await new Promise((r) => setTimeout(r, 20));
      expect(deleteSong).not.toHaveBeenCalled();
      expect(titles()).toEqual(["שיר", "Alpha", "Beta"]);
    });

    it("does not open the song whose delete button was clicked", async () => {
      await renderDb();
      fireEvent.click(rowDelete(2));
      fireEvent.click(screen.getByTestId("confirm-delete-cancel"));
      expect(getSong).toHaveBeenCalledExactlyOnceWith("c");
      expect(songTitle()).toBe("שיר");
    });

    it("a failure keeps the song and shows the reason", async () => {
      vi.mocked(deleteSong).mockRejectedValue(new Error("disk locked"));
      await renderDb();
      fireEvent.click(rowDelete(1));
      confirmYes();
      const notice = await screen.findByTestId("app-notice");
      expect(notice.textContent).toBe(`${STRINGS.deleteFailed}: disk locked`);
      expect(notice).toHaveAttribute("role", "alert");
      expect(titles()).toEqual(["שיר", "Alpha", "Beta"]);
      expect(status()).toBe("");
      expect(listSongs).toHaveBeenCalledTimes(1);
    });

    it("treats NotFound as deleted: the row goes, no failure is shown", async () => {
      vi.mocked(deleteSong).mockImplementation((id) => {
        db = db.filter((s) => s.id !== id);
        return Promise.reject(
          Object.assign(new Error("no such song"), { kind: "NotFound" }),
        );
      });
      await renderDb();
      fireEvent.click(rowDelete(1));
      confirmYes();
      await waitFor(() => expect(status()).toBe(deletedCount(1)));
      expect(deleteSong).toHaveBeenCalledExactlyOnceWith("a");
      expect(titles()).toEqual(["שיר", "Beta"]);
      expect(screen.queryByTestId("app-notice")).toBeNull();
    });

    it("a failed reload drops the deleted song locally and says so", async () => {
      await renderDb();
      vi.mocked(listSongs).mockRejectedValue(new Error("db gone"));
      fireEvent.click(rowDelete(1));
      confirmYes();
      const notice = await screen.findByTestId("app-notice");
      expect(notice.textContent).toBe(STRINGS.libraryReloadFailed);
      expect(titles()).toEqual(["שיר", "Beta"]);
      expect(status()).toBe(deletedCount(1));
    });

    it("disables the delete buttons while a delete runs", async () => {
      let finish!: () => void;
      vi.mocked(deleteSong).mockImplementation(
        (id) =>
          new Promise<void>((resolve) => {
            finish = () => {
              db = db.filter((s) => s.id !== id);
              resolve();
            };
          }),
      );
      await renderDb();
      fireEvent.click(rowDelete(1));
      confirmYes();
      await waitFor(() => expect(deleteSong).toHaveBeenCalledTimes(1));
      for (const el of screen.getAllByTestId("song-delete"))
        expect(el).toBeDisabled();
      expect(screen.getByTestId("delete-song")).toBeDisabled();
      fireEvent.click(rowDelete(2));
      expect(screen.queryByTestId("confirm-delete")).toBeNull();

      finish();
      await waitFor(() => expect(titles()).toEqual(["שיר", "Beta"]));
      await settled();
      expect(screen.getByTestId("delete-song")).toBeEnabled();
      expect(deleteSong).toHaveBeenCalledTimes(1);
    });

    it("clears the status when the next confirmation opens", async () => {
      await renderDb();
      fireEvent.click(rowDelete(1));
      confirmYes();
      await waitFor(() => expect(status()).toBe(deletedCount(1)));
      await settled();
      fireEvent.click(rowDelete(1));
      expect(screen.getByTestId("confirm-delete")).toBeInTheDocument();
      expect(status()).toBe("");
    });
  });

  describe("open-song delete", () => {
    it("deletes nothing before confirm, then opens the next song after it", async () => {
      await renderDb();
      expect(songTitle()).toBe("שיר");
      fireEvent.click(screen.getByTestId("delete-song"));
      expect(dialogTitle()).toBe(deleteConfirmTitle("שיר"));
      expect(deleteSong).not.toHaveBeenCalled();

      confirmYes();
      await waitFor(() => expect(songTitle()).toBe("Alpha"));
      expect(deleteSong).toHaveBeenCalledExactlyOnceWith("c");
      expect(getSong).toHaveBeenLastCalledWith("a");
      expect(titles()).toEqual(["Alpha", "Beta"]);
      expect(screen.getAllByTestId("song-item")[0]).toHaveAttribute(
        "aria-current",
        "true",
      );
      expect(status()).toBe(deletedCount(1));
    });

    it("Cancel and Escape keep the open song", async () => {
      await renderDb();
      fireEvent.click(screen.getByTestId("delete-song"));
      fireEvent.click(screen.getByTestId("confirm-delete-cancel"));
      fireEvent.click(screen.getByTestId("delete-song"));
      fireEvent.keyDown(screen.getByTestId("confirm-delete"), {
        key: "Escape",
      });
      expect(screen.queryByTestId("confirm-delete")).toBeNull();
      await new Promise((r) => setTimeout(r, 20));
      expect(deleteSong).not.toHaveBeenCalled();
      expect(songTitle()).toBe("שיר");
      expect(titles()).toEqual(["שיר", "Alpha", "Beta"]);
    });

    it("prefers the song after it over the song before it", async () => {
      await renderDb();
      fireEvent.click(screen.getByText("Alpha"));
      await waitFor(() => expect(songTitle()).toBe("Alpha"));
      expect(titles()).toEqual(["שיר", "Alpha", "Beta"]);
      fireEvent.click(screen.getByTestId("delete-song"));
      confirmYes();
      await waitFor(() => expect(songTitle()).toBe("Beta"));
      expect(deleteSong).toHaveBeenCalledExactlyOnceWith("a");
      expect(getSong).toHaveBeenLastCalledWith("b");
      expect(titles()).toEqual(["שיר", "Beta"]);
    });

    it("opens the last surviving song before it when none follows", async () => {
      await renderDb();
      fireEvent.click(screen.getByText("Beta"));
      await waitFor(() => expect(songTitle()).toBe("Beta"));
      fireEvent.click(screen.getByTestId("delete-song"));
      expect(dialogTitle()).toBe(deleteConfirmTitle("Beta"));
      confirmYes();
      await waitFor(() => expect(songTitle()).toBe("Alpha"));
      expect(deleteSong).toHaveBeenCalledExactlyOnceWith("b");
      expect(titles()).toEqual(["שיר", "Alpha"]);
      expect(screen.getAllByTestId("song-item")[1]).toHaveAttribute(
        "aria-current",
        "true",
      );
    });

    it("shows the empty pane when the only song is deleted", async () => {
      db = [summary("c", "שיר")];
      await renderDb();
      fireEvent.click(screen.getByTestId("delete-song"));
      confirmYes();
      await waitFor(() =>
        expect(screen.getByTestId("song-pane").textContent).toBe(
          STRINGS.noSongSelected,
        ),
      );
      expect(deleteSong).toHaveBeenCalledExactlyOnceWith("c");
      expect(screen.getByText(STRINGS.libraryEmpty)).toBeInTheDocument();
      expect(screen.queryByTestId("song-title")).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(getSong).toHaveBeenCalledTimes(1);
    });

    it("a failure keeps the song open", async () => {
      vi.mocked(deleteSong).mockRejectedValue(new Error("nope"));
      await renderDb();
      fireEvent.click(screen.getByTestId("delete-song"));
      confirmYes();
      const notice = await screen.findByTestId("app-notice");
      expect(notice.textContent).toBe(`${STRINGS.deleteFailed}: nope`);
      expect(songTitle()).toBe("שיר");
      expect(getSong).toHaveBeenCalledTimes(1);
    });
  });

  describe("select mode and bulk delete", () => {
    async function selectMode() {
      await renderDb();
      fireEvent.click(screen.getByTestId("select-songs"));
    }

    it("enters select mode, toggles rows and Done clears the selection", async () => {
      await selectMode();
      expect(screen.queryByTestId("song-delete")).toBeNull();
      expect(screen.getByTestId("selection-count").textContent).toBe(
        selectedCount(0),
      );
      expect(screen.getByTestId("delete-selected")).toBeDisabled();

      fireEvent.click(check(1));
      fireEvent.click(screen.getByText("Beta"));
      expect(check(1)).toBeChecked();
      expect(check(2)).toBeChecked();
      expect(check(0)).not.toBeChecked();
      expect(screen.getByTestId("selection-count").textContent).toBe(
        selectedCount(2),
      );
      expect(getSong).toHaveBeenCalledExactlyOnceWith("c");
      fireEvent.click(screen.getByText("Beta"));
      expect(check(2)).not.toBeChecked();

      fireEvent.click(screen.getByTestId("select-done"));
      expect(screen.queryByTestId("song-check")).toBeNull();
      expect(screen.getAllByTestId("song-delete")).toHaveLength(3);
      fireEvent.click(screen.getByTestId("select-songs"));
      expect(screen.getByTestId("selection-count").textContent).toBe(
        selectedCount(0),
      );
      for (const el of screen.getAllByTestId("song-check"))
        expect(el).not.toBeChecked();
    });

    it("Select all takes the whole library, or only the hits when results are shown", async () => {
      await selectMode();
      fireEvent.click(screen.getByTestId("select-all"));
      expect(screen.getByTestId("selection-count").textContent).toBe(
        selectedCount(3),
      );
      fireEvent.click(screen.getByTestId("select-done"));

      vi.mocked(searchSongs).mockResolvedValue([hit("a", "Alpha")]);
      fireEvent.change(screen.getByTestId("search-input"), {
        target: { value: "alp" },
      });
      await screen.findByTestId("search-results");
      fireEvent.click(screen.getByTestId("select-songs"));
      fireEvent.click(screen.getByTestId("select-all"));
      expect(screen.getByTestId("selection-count").textContent).toBe(
        selectedCount(1),
      );
      expect(check(0)).toBeChecked();
    });

    it("keeps the selection while typing in the search box", async () => {
      await selectMode();
      fireEvent.click(check(2));
      vi.mocked(searchSongs).mockResolvedValue([hit("a", "Alpha")]);
      const input = screen.getByTestId("search-input");
      fireEvent.change(input, { target: { value: "alp" } });
      await screen.findByTestId("search-results");
      expect(titles()).toEqual(["Alpha"]);
      expect(screen.getByTestId("selection-count").textContent).toBe(
        selectedCount(1),
      );
      expect(check(0)).not.toBeChecked();
      fireEvent.change(input, { target: { value: "" } });
      await screen.findByTestId("song-index");
      expect(check(2)).toBeChecked();
    });

    it("bulk delete of two with one failure removes one, reports it and keeps the failed song selected", async () => {
      vi.mocked(deleteSong).mockImplementation((id) => {
        if (id === "b") return Promise.reject(new Error("locked"));
        db = db.filter((s) => s.id !== id);
        return Promise.resolve();
      });
      await selectMode();
      fireEvent.click(check(1));
      fireEvent.click(check(2));
      fireEvent.click(screen.getByTestId("delete-selected"));
      expect(dialogTitle()).toBe(deleteManyTitle(2));
      expect(deleteSong).not.toHaveBeenCalled();

      confirmYes();
      const notice = await screen.findByTestId("app-notice");
      expect(notice.textContent).toBe(`${deleteManyFailed(1, 2)}: locked`);
      expect(notice.textContent).toBe("Could not delete 1 of 2 songs: locked");
      expect(vi.mocked(deleteSong).mock.calls).toEqual([["a"], ["b"]]);
      expect(titles()).toEqual(["שיר", "Beta"]);
      expect(status()).toBe(deletedCount(1));
      expect(screen.getByTestId("selection-count").textContent).toBe(
        selectedCount(1),
      );
      expect(check(0)).not.toBeChecked();
      expect(check(1)).toBeChecked();
    });

    it("bulk delete without a failure leaves select mode", async () => {
      await selectMode();
      fireEvent.click(check(1));
      fireEvent.click(check(2));
      fireEvent.click(screen.getByTestId("delete-selected"));
      confirmYes();
      await waitFor(() => expect(titles()).toEqual(["שיר"]));
      await waitFor(() =>
        expect(screen.getByTestId("select-songs")).toBeInTheDocument(),
      );
      expect(screen.queryByTestId("song-check")).toBeNull();
      expect(status()).toBe(deletedCount(2));
      expect(status()).toBe("Deleted 2 songs");
      expect(screen.queryByTestId("app-notice")).toBeNull();
      expect(songTitle()).toBe("שיר");
    });

    it("names the song when exactly one is selected, and Cancel keeps everything", async () => {
      await selectMode();
      fireEvent.click(check(2));
      fireEvent.click(screen.getByTestId("delete-selected"));
      expect(dialogTitle()).toBe(deleteConfirmTitle("Beta"));
      fireEvent.click(screen.getByTestId("confirm-delete-cancel"));
      await new Promise((r) => setTimeout(r, 20));
      expect(deleteSong).not.toHaveBeenCalled();
      expect(check(2)).toBeChecked();
      expect(titles()).toEqual(["שיר", "Alpha", "Beta"]);
    });

    it("skips deleted neighbours when the open song is part of a bulk delete", async () => {
      await selectMode();
      fireEvent.click(check(0));
      fireEvent.click(check(1));
      fireEvent.click(screen.getByTestId("delete-selected"));
      confirmYes();
      await waitFor(() => expect(songTitle()).toBe("Beta"));
      expect(titles()).toEqual(["Beta"]);
      expect(getSong).toHaveBeenLastCalledWith("b");
    });

    it("disables Delete selected while the delete runs", async () => {
      let finish!: () => void;
      vi.mocked(deleteSong).mockImplementation(
        () => new Promise<void>((resolve) => (finish = resolve)),
      );
      await selectMode();
      fireEvent.click(check(1));
      fireEvent.click(screen.getByTestId("delete-selected"));
      confirmYes();
      await waitFor(() => expect(deleteSong).toHaveBeenCalledTimes(1));
      expect(screen.getByTestId("delete-selected")).toBeDisabled();
      finish();
      await waitFor(() => expect(status()).toBe(deletedCount(1)));
    });
  });

  describe("search results", () => {
    it("lose the deleted hit without re-typing the query", async () => {
      await renderDb();
      vi.mocked(searchSongs).mockResolvedValue([
        hit("a", "Alpha"),
        hit("b", "Beta"),
      ]);
      fireEvent.change(screen.getByTestId("search-input"), {
        target: { value: "line" },
      });
      await screen.findByTestId("search-results");
      expect(titles()).toEqual(["Alpha", "Beta"]);

      fireEvent.click(rowDelete(0));
      expect(dialogTitle()).toBe(deleteConfirmTitle("Alpha"));
      confirmYes();
      await waitFor(() => expect(titles()).toEqual(["Beta"]));
      expect(deleteSong).toHaveBeenCalledExactlyOnceWith("a");
      expect(searchSongs).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("search-results")).toBeInTheDocument();
      expect(screen.getByTestId("search-input")).toHaveValue("line");

      fireEvent.change(screen.getByTestId("search-input"), {
        target: { value: "" },
      });
      await screen.findByTestId("song-index");
      expect(titles()).toEqual(["שיר", "Beta"]);
    });
  });

  describe("editor session", () => {
    /** The ChordPro text area; the editor opens on the Visual tab, so this selects the Source tab first. */
    const editor = () => {
      fireEvent.click(screen.getByTestId("editor-tab-source"));
      return screen.getByTestId("editor-input") as HTMLTextAreaElement;
    };

    it("deleting the song under edit ends the session with no discard dialog", async () => {
      await renderDb();
      fireEvent.click(screen.getByTestId("edit-song"));
      await waitFor(() => expect(editor().value).toBe(DB_SONGS.c));
      fireEvent.change(editor(), { target: { value: "{title: שיר}\nedited" } });

      fireEvent.click(rowDelete(0));
      expect(screen.queryByTestId("confirm-discard")).toBeNull();
      expect(dialogTitle()).toBe(deleteConfirmTitle("שיר"));
      expect(deleteSong).not.toHaveBeenCalled();
      confirmYes();

      await waitFor(() => expect(screen.queryByTestId("editor")).toBeNull());
      expect(screen.queryByTestId("confirm-discard")).toBeNull();
      expect(deleteSong).toHaveBeenCalledExactlyOnceWith("c");
      expect(saveSong).not.toHaveBeenCalled();
      await waitFor(() => expect(songTitle()).toBe("Alpha"));
      expect(titles()).toEqual(["Alpha", "Beta"]);

      fireEvent.click(screen.getByText("Beta"));
      expect(screen.queryByTestId("confirm-discard")).toBeNull();
      await waitFor(() => expect(songTitle()).toBe("Beta"));
    });

    it("deleting another song keeps a dirty editor, its text and its dirty state", async () => {
      await renderDb();
      fireEvent.click(screen.getByTestId("new-song"));
      fireEvent.change(editor(), { target: { value: "typed" } });

      fireEvent.click(rowDelete(1));
      expect(screen.queryByTestId("confirm-discard")).toBeNull();
      confirmYes();
      await waitFor(() => expect(titles()).toEqual(["שיר", "Beta"]));
      await settled();
      expect(deleteSong).toHaveBeenCalledExactlyOnceWith("a");
      expect(screen.getByTestId("editor")).toBeInTheDocument();
      expect(editor().value).toBe("typed");

      fireEvent.click(screen.getByText("Beta"));
      expect(screen.getByTestId("confirm-discard")).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("confirm-keep"));
      expect(editor().value).toBe("typed");
    });

    it("keeps an editor on another saved song when a different song is deleted", async () => {
      await renderDb();
      fireEvent.click(screen.getByTestId("edit-song"));
      await waitFor(() => expect(editor().value).toBe(DB_SONGS.c));
      fireEvent.change(editor(), { target: { value: "{title: שיר}\nkept" } });
      fireEvent.click(rowDelete(2));
      confirmYes();
      await waitFor(() => expect(titles()).toEqual(["שיר", "Alpha"]));
      await settled();
      expect(editor().value).toBe("{title: שיר}\nkept");
    });
  });

  describe("delete UI fixes", () => {
    const items = () => screen.getAllByTestId("song-item");
    const count = () => screen.getByTestId("selection-count").textContent;
    const type = (value: string) =>
      fireEvent.change(screen.getByTestId("search-input"), {
        target: { value },
      });

    /** Deletes the row at `index` the way a user does: its button holds the focus. */
    function deleteRow(index: number) {
      rowDelete(index).focus();
      expect(document.activeElement).toBe(rowDelete(index));
      fireEvent.click(rowDelete(index));
      confirmYes();
    }

    it("Select all selects nothing while the search error is shown", async () => {
      await renderDb();
      vi.mocked(searchSongs).mockRejectedValue(new Error("fts broken"));
      type("alp");
      const alert = await screen.findByText(STRINGS.searchFailed);
      expect(alert).toHaveAttribute("role", "alert");
      expect(screen.queryByTestId("song-item")).toBeNull();

      fireEvent.click(screen.getByTestId("select-songs"));
      fireEvent.click(screen.getByTestId("select-all"));
      expect(count()).toBe(selectedCount(0));
      expect(screen.getByTestId("delete-selected")).toBeDisabled();
    });

    it("Select all selects nothing while no result is found", async () => {
      await renderDb();
      vi.mocked(searchSongs).mockResolvedValue([]);
      type("zzz");
      await screen.findByTestId("search-empty");

      fireEvent.click(screen.getByTestId("select-songs"));
      fireEvent.click(screen.getByTestId("select-all"));
      expect(count()).toBe(selectedCount(0));

      type("");
      await screen.findByTestId("song-index");
      fireEvent.click(screen.getByTestId("select-all"));
      expect(count()).toBe(selectedCount(3));
    });

    it("Edit is disabled while a delete runs", async () => {
      let finish!: () => void;
      vi.mocked(deleteSong).mockImplementation(
        (id) =>
          new Promise<void>((resolve) => {
            finish = () => {
              db = db.filter((s) => s.id !== id);
              resolve();
            };
          }),
      );
      await renderDb();
      expect(screen.getByTestId("edit-song")).toBeEnabled();
      fireEvent.click(rowDelete(1));
      expect(screen.getByTestId("edit-song")).toBeEnabled();
      confirmYes();
      await waitFor(() => expect(deleteSong).toHaveBeenCalledTimes(1));
      expect(screen.getByTestId("edit-song")).toBeDisabled();
      fireEvent.click(screen.getByTestId("edit-song"));
      expect(screen.queryByTestId("editor")).toBeNull();
      expect(getSong).toHaveBeenCalledTimes(1);

      finish();
      await waitFor(() => expect(titles()).toEqual(["שיר", "Beta"]));
      await settled();
      expect(screen.getByTestId("edit-song")).toBeEnabled();
    });

    it("focus moves to the next row after a row delete", async () => {
      let finish!: () => void;
      vi.mocked(deleteSong).mockImplementation(
        (id) =>
          new Promise<void>((resolve) => {
            finish = () => {
              db = db.filter((s) => s.id !== id);
              resolve();
            };
          }),
      );
      await renderDb();
      deleteRow(1);
      await waitFor(() => expect(deleteSong).toHaveBeenCalledTimes(1));
      expect(document.activeElement).toBe(document.body);

      finish();
      await waitFor(() => expect(titles()).toEqual(["שיר", "Beta"]));
      await waitFor(() => expect(document.activeElement).toBe(items()[1]));
      expect(items()[1]!.textContent).toContain("Beta");
      expect(songTitle()).toBe("שיר");
    });

    it("focus moves to the last row after a row delete of the last row", async () => {
      await renderDb();
      deleteRow(2);
      await waitFor(() => expect(titles()).toEqual(["שיר", "Alpha"]));
      await waitFor(() => expect(document.activeElement).toBe(items()[1]));
      expect(items()[1]!.textContent).toContain("Alpha");
    });

    it("focus moves to Select after a row delete empties the list", async () => {
      db = [summary("c", "שיר")];
      await renderDb();
      deleteRow(0);
      await waitFor(() =>
        expect(screen.getByText(STRINGS.libraryEmpty)).toBeInTheDocument(),
      );
      await waitFor(() =>
        expect(document.activeElement).toBe(screen.getByTestId("select-songs")),
      );
    });

    it("focus moves to the row itself after a failed row delete", async () => {
      vi.mocked(deleteSong).mockRejectedValue(new Error("disk locked"));
      await renderDb();
      deleteRow(1);
      await screen.findByTestId("app-notice");
      expect(titles()).toEqual(["שיר", "Alpha", "Beta"]);
      await waitFor(() => expect(document.activeElement).toBe(items()[1]));
      expect(items()[1]!.textContent).toContain("Alpha");
    });

    it("focus moves to the next row of the results after a row delete there", async () => {
      await renderDb();
      vi.mocked(searchSongs).mockResolvedValue([
        hit("c", "שיר"),
        hit("a", "Alpha"),
        hit("b", "Beta"),
      ]);
      type("line");
      await screen.findByTestId("search-results");
      deleteRow(0);
      await waitFor(() => expect(titles()).toEqual(["Alpha", "Beta"]));
      await waitFor(() => expect(document.activeElement).toBe(items()[0]));
      expect(
        within(screen.getByTestId("search-results")).getAllByTestId(
          "song-item",
        )[0],
      ).toBe(document.activeElement);
    });

    it("focus stays where the user put it during a row delete", async () => {
      let finish!: () => void;
      vi.mocked(deleteSong).mockImplementation(
        (id) =>
          new Promise<void>((resolve) => {
            finish = () => {
              db = db.filter((s) => s.id !== id);
              resolve();
            };
          }),
      );
      await renderDb();
      deleteRow(1);
      await waitFor(() => expect(deleteSong).toHaveBeenCalledTimes(1));
      const input = screen.getByTestId("search-input");
      input.focus();
      finish();
      await waitFor(() => expect(titles()).toEqual(["שיר", "Beta"]));
      await settled();
      expect(document.activeElement).toBe(input);
    });

    it("a search that resolves after a delete does not bring the song back", async () => {
      let answer!: (hits: SearchHit[]) => void;
      vi.mocked(searchSongs).mockImplementation(
        () => new Promise<SearchHit[]>((resolve) => (answer = resolve)),
      );
      await renderDb();
      type("line");
      await waitFor(() => expect(searchSongs).toHaveBeenCalledTimes(1));
      expect(screen.queryByTestId("search-results")).toBeNull();

      fireEvent.click(rowDelete(1));
      expect(dialogTitle()).toBe(deleteConfirmTitle("Alpha"));
      confirmYes();
      await waitFor(() => expect(titles()).toEqual(["שיר", "Beta"]));
      await settled();
      expect(deleteSong).toHaveBeenCalledExactlyOnceWith("a");

      answer([hit("a", "Alpha"), hit("b", "Beta")]);
      await screen.findByTestId("search-results");
      expect(titles()).toEqual(["Beta"]);
      expect(screen.queryByText("Alpha")).toBeNull();
      expect(searchSongs).toHaveBeenCalledTimes(1);
    });

    it("a search for only the deleted song shows no result after the delete", async () => {
      await renderDb();
      fireEvent.click(rowDelete(1));
      confirmYes();
      await waitFor(() => expect(titles()).toEqual(["שיר", "Beta"]));
      await settled();

      vi.mocked(searchSongs).mockResolvedValue([hit("a", "Alpha")]);
      type("alp");
      await screen.findByTestId("search-empty");
      expect(screen.queryByTestId("song-item")).toBeNull();
    });

    it("a song known only as a search hit is gone from every list after its delete", async () => {
      await renderDb();
      vi.mocked(searchSongs).mockResolvedValue([
        hit("z", "Zed"),
        hit("b", "Beta"),
      ]);
      type("e");
      await screen.findByTestId("search-results");
      expect(titles()).toEqual(["Zed", "Beta"]);

      fireEvent.click(rowDelete(0));
      expect(dialogTitle()).toBe(deleteConfirmTitle("Zed"));
      expect(deleteSong).not.toHaveBeenCalled();
      confirmYes();
      await waitFor(() => expect(titles()).toEqual(["Beta"]));
      await settled();
      expect(deleteSong).toHaveBeenCalledExactlyOnceWith("z");

      type("");
      await screen.findByTestId("song-index");
      expect(titles()).toEqual(["שיר", "Alpha", "Beta"]);

      type("ze");
      await waitFor(() => expect(searchSongs).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(titles()).toEqual(["Beta"]));
      expect(screen.queryByText("Zed")).toBeNull();
      expect(getSong).not.toHaveBeenCalledWith("z");
    });
  });
});
