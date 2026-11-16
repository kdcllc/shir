import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import {
  StorageError,
  deleteSong,
  getSong,
  listSongs,
  saveSong,
  searchSongs,
  type ErrorKind,
  type SearchHit,
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
});
