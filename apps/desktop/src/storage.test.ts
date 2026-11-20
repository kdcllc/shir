import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import {
  StorageError,
  addSetlistItems,
  createSetlist,
  deleteSetlist,
  deleteSong,
  duplicateSetlist,
  getSetlist,
  getSong,
  listSetlists,
  listSongs,
  logWebviewError,
  removeSetlistItem,
  renameSetlist,
  reorderSetlistItems,
  saveSong,
  searchSongs,
  updateSetlistItem,
  type ErrorKind,
  type SearchHit,
  type Setlist,
  type SetlistSummary,
  type Song,
  type SongSummary,
} from "./storage";

const mockInvoke = vi.mocked(invoke);

const song: Song = {
  id: "s1",
  chordpro: "{title: Shalom}",
  title: "Shalom",
  artist: null,
  key: null,
  capo: null,
  language: "he",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};
const summary: SongSummary = {
  id: "s1",
  title: "Shalom",
  artist: null,
  key: null,
  language: "he",
  updatedAt: "2026-01-01T00:00:00Z",
};

async function caught(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error("expected rejection");
}

describe("storage client", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("saveSong without id sends id null to save_song", async () => {
    mockInvoke.mockResolvedValue(song);
    await expect(saveSong("{title: Shalom}")).resolves.toEqual(song);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith(
      "save_song",
      { input: { id: null, chordpro: "{title: Shalom}" } },
      undefined,
    );
  });

  it("saveSong with id sends it through", async () => {
    mockInvoke.mockResolvedValue(song);
    await expect(saveSong("x", "s1")).resolves.toEqual(song);
    expect(mockInvoke).toHaveBeenCalledWith(
      "save_song",
      { input: { id: "s1", chordpro: "x" } },
      undefined,
    );
  });

  it("getSong invokes get_song", async () => {
    mockInvoke.mockResolvedValue(song);
    await expect(getSong("s1")).resolves.toEqual(song);
    expect(mockInvoke).toHaveBeenCalledWith(
      "get_song",
      { id: "s1" },
      undefined,
    );
  });

  it("listSongs invokes list_songs", async () => {
    mockInvoke.mockResolvedValue([summary]);
    await expect(listSongs()).resolves.toEqual([summary]);
    expect(mockInvoke).toHaveBeenCalledWith("list_songs", undefined, undefined);
  });

  it("deleteSong invokes delete_song and resolves void", async () => {
    mockInvoke.mockResolvedValue(null);
    await expect(deleteSong("s1")).resolves.toBeUndefined();
    expect(mockInvoke).toHaveBeenCalledWith(
      "delete_song",
      { id: "s1" },
      undefined,
    );
  });

  it("searchSongs resolves SearchHit[] with null and string snippets", async () => {
    const hits: SearchHit[] = [
      { song: summary, snippet: null },
      { song: { ...summary, id: "s2" }, snippet: "[C]שלום עולם" },
    ];
    mockInvoke.mockResolvedValue(hits);
    await expect(searchSongs("שלום")).resolves.toEqual(hits);
    expect(mockInvoke).toHaveBeenCalledWith(
      "search_songs",
      { query: "שלום" },
      undefined,
    );
  });

  const kinds: ErrorKind[] = [
    "NotFound",
    "Invalid",
    "Storage",
    "Migration",
    "Unavailable",
  ];

  it.each(kinds)("maps a command error result of kind %s", async (kind) => {
    mockInvoke.mockRejectedValue({ kind, message: `msg-${kind}` });
    const e = await caught(getSong("s1"));
    expect(e).toBeInstanceOf(StorageError);
    expect(e).toBeInstanceOf(Error);
    expect((e as StorageError).kind).toBe(kind);
    expect((e as StorageError).message).toBe(`msg-${kind}`);
    expect((e as StorageError).name).toBe("StorageError");
  });

  it("maps every function's error result", async () => {
    mockInvoke.mockRejectedValue({ kind: "Invalid", message: "bad" });
    for (const call of [
      () => saveSong("x"),
      () => getSong("s1"),
      () => listSongs(),
      () => deleteSong("s1"),
      () => searchSongs("q"),
    ]) {
      const e = await caught(call());
      expect(e).toBeInstanceOf(StorageError);
      expect((e as StorageError).kind).toBe("Invalid");
    }
  });

  it("maps a non-DbError error value (ACL denial string) to Ipc", async () => {
    mockInvoke.mockRejectedValue("command get_song not allowed by ACL");
    const e = (await caught(getSong("s1"))) as StorageError;
    expect(e).toBeInstanceOf(StorageError);
    expect(e.kind).toBe("Ipc");
    expect(e.message).toBe("command get_song not allowed by ACL");
  });

  it("maps an object with an unknown kind to Ipc", async () => {
    mockInvoke.mockRejectedValue({ kind: "Bogus", message: "m" });
    const e = (await caught(getSong("s1"))) as StorageError;
    expect(e.kind).toBe("Ipc");
    expect(e.message).toBe("[object Object]");
  });

  it("maps a rejected Error to Ipc with its message", async () => {
    mockInvoke.mockRejectedValue(new Error("ipc down"));
    const e = (await caught(listSongs())) as StorageError;
    expect(e).toBeInstanceOf(StorageError);
    expect(e).toBeInstanceOf(Error);
    expect(e.kind).toBe("Ipc");
    expect(e.message).toBe("ipc down");
  });

  it("maps a rejected non-Error value to Ipc", async () => {
    mockInvoke.mockRejectedValue(42);
    const e = (await caught(searchSongs("q"))) as StorageError;
    expect(e.kind).toBe("Ipc");
    expect(e.message).toBe("42");
  });

  it("logWebviewError invokes log_webview_error with the message", async () => {
    mockInvoke.mockResolvedValue(null);
    await expect(logWebviewError("boom")).resolves.toBeUndefined();
    expect(mockInvoke).toHaveBeenCalledWith(
      "log_webview_error",
      { message: "boom" },
      undefined,
    );
  });

  it("logWebviewError never rejects", async () => {
    mockInvoke.mockRejectedValue(new Error("no runtime"));
    await expect(logWebviewError("x")).resolves.toBeUndefined();
    mockInvoke.mockImplementation(() => {
      throw new TypeError("invoke is not a function");
    });
    await expect(logWebviewError("x")).resolves.toBeUndefined();
  });

  describe("setlists", () => {
    const setlist: Setlist = {
      id: "l1",
      name: "Friday",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      items: [],
    };
    const summaryRow: SetlistSummary = {
      id: "l1",
      name: "Friday",
      itemCount: 0,
      updatedAt: "2026-01-01T00:00:00Z",
    };

    const calls: [
      string,
      () => Promise<unknown>,
      string,
      Record<string, unknown> | undefined,
      unknown,
    ][] = [
      [
        "listSetlists",
        () => listSetlists(),
        "list_setlists",
        undefined,
        [summaryRow],
      ],
      [
        "getSetlist",
        () => getSetlist("l1"),
        "get_setlist",
        { id: "l1" },
        setlist,
      ],
      [
        "createSetlist",
        () => createSetlist("Friday"),
        "create_setlist",
        { name: "Friday" },
        setlist,
      ],
      [
        "renameSetlist",
        () => renameSetlist("l1", "שבת"),
        "rename_setlist",
        { id: "l1", name: "שבת" },
        setlist,
      ],
      [
        "duplicateSetlist",
        () => duplicateSetlist("l1", "Copy"),
        "duplicate_setlist",
        { id: "l1", name: "Copy" },
        setlist,
      ],
      [
        "addSetlistItems",
        () => addSetlistItems("l1", ["s1", "s2"]),
        "add_setlist_items",
        { setlistId: "l1", songIds: ["s1", "s2"] },
        setlist,
      ],
      [
        "removeSetlistItem",
        () => removeSetlistItem("l1", "i1"),
        "remove_setlist_item",
        { setlistId: "l1", itemId: "i1" },
        setlist,
      ],
      [
        "reorderSetlistItems",
        () => reorderSetlistItems("l1", ["i2", "i1"]),
        "reorder_setlist_items",
        { setlistId: "l1", itemIds: ["i2", "i1"] },
        setlist,
      ],
      [
        "updateSetlistItem (capo)",
        () => updateSetlistItem("l1", "i1", -2, 3),
        "update_setlist_item",
        { setlistId: "l1", itemId: "i1", transpose: -2, capo: 3 },
        setlist,
      ],
      [
        "updateSetlistItem (null capo)",
        () => updateSetlistItem("l1", "i1", 0, null),
        "update_setlist_item",
        { setlistId: "l1", itemId: "i1", transpose: 0, capo: null },
        setlist,
      ],
    ];

    it.each(calls)(
      "%s invokes the right command",
      async (_n, call, cmd, args, ret) => {
        mockInvoke.mockResolvedValue(ret);
        await expect(call()).resolves.toEqual(ret);
        expect(mockInvoke).toHaveBeenCalledTimes(1);
        expect(mockInvoke).toHaveBeenCalledWith(cmd, args, undefined);
      },
    );

    it("deleteSetlist invokes delete_setlist and resolves void", async () => {
      mockInvoke.mockResolvedValue(null);
      await expect(deleteSetlist("l1")).resolves.toBeUndefined();
      expect(mockInvoke).toHaveBeenCalledWith(
        "delete_setlist",
        { id: "l1" },
        undefined,
      );
    });

    const all: [string, () => Promise<unknown>][] = [
      ...calls.map(([n, c]) => [n, c] as [string, () => Promise<unknown>]),
      ["deleteSetlist", () => deleteSetlist("l1")],
    ];

    it.each(all)(
      "%s maps an error result to StorageError",
      async (_n, call) => {
        mockInvoke.mockRejectedValue({ kind: "NotFound", message: "gone" });
        const e = await caught(call());
        expect(e).toBeInstanceOf(StorageError);
        expect((e as StorageError).kind).toBe("NotFound");
        expect((e as StorageError).message).toBe("gone");
      },
    );

    it.each(all)(
      "%s maps a rejection to Ipc StorageError",
      async (_n, call) => {
        mockInvoke.mockRejectedValue(new Error("ipc down"));
        const e = await caught(call());
        expect(e).toBeInstanceOf(StorageError);
        expect((e as StorageError).kind).toBe("Ipc");
        expect((e as StorageError).message).toBe("ipc down");
      },
    );
  });
});
