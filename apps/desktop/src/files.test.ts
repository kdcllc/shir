import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const open = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...a: unknown[]) => invoke(...a),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...a: unknown[]) => open(...a),
}));

import { FileReadError, pickSongFiles, readTextFile } from "./files";

beforeEach(() => {
  invoke.mockReset();
  open.mockReset();
});

describe("readTextFile", () => {
  it("invokes read_text_file with { path } and returns the text", async () => {
    invoke.mockResolvedValue("שלום");
    await expect(readTextFile("/a/b.cho")).resolves.toBe("שלום");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0]![0]).toBe("read_text_file");
    expect(invoke.mock.calls[0]![1]).toEqual({ path: "/a/b.cho" });
  });

  it.each(["TooLarge", "NotUtf8", "Io"] as const)(
    "maps a %s error result to FileReadError",
    async (kind) => {
      invoke.mockImplementation(() => Promise.reject({ kind, message: "m" }));
      const err = await readTextFile("/x").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(FileReadError);
      expect((err as FileReadError).kind).toBe(kind);
      expect((err as FileReadError).message).toBe("m");
    },
  );

  it("maps an IPC failure to kind Ipc", async () => {
    invoke.mockImplementation(() => Promise.reject(new Error("no ipc")));
    const err = await readTextFile("/x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FileReadError);
    expect((err as FileReadError).kind).toBe("Ipc");
    expect((err as FileReadError).message).toBe("no ipc");
  });

  it("maps a non-error rejection to kind Ipc", async () => {
    invoke.mockImplementation(() => Promise.reject("boom"));
    const err = await readTextFile("/x").catch((e: unknown) => e);
    expect((err as FileReadError).kind).toBe("Ipc");
    expect((err as FileReadError).message).toBe("boom");
  });
});

describe("pickSongFiles", () => {
  it("passes the song-file filter and multi-select options", async () => {
    open.mockResolvedValue(null);
    await pickSongFiles();
    expect(open).toHaveBeenCalledWith({
      multiple: true,
      directory: false,
      filters: [
        {
          name: "Song files",
          extensions: ["cho", "chopro", "chordpro", "txt"],
        },
      ],
    });
  });

  it("uses a caller-supplied filter name", async () => {
    open.mockResolvedValue(null);
    await pickSongFiles("שירים");
    expect(open.mock.calls[0]![0].filters[0].name).toBe("שירים");
  });

  it("null becomes []", async () => {
    open.mockResolvedValue(null);
    await expect(pickSongFiles()).resolves.toEqual([]);
  });

  it("a single string becomes [s]", async () => {
    open.mockResolvedValue("/a.cho");
    await expect(pickSongFiles()).resolves.toEqual(["/a.cho"]);
  });

  it("an array is returned as is", async () => {
    open.mockResolvedValue(["/a.cho", "/b.txt"]);
    await expect(pickSongFiles()).resolves.toEqual(["/a.cho", "/b.txt"]);
  });

  it("a dialog failure rejects with FileReadError Ipc", async () => {
    open.mockImplementation(() => Promise.reject(new Error("dialog down")));
    const err = await pickSongFiles().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FileReadError);
    expect((err as FileReadError).kind).toBe("Ipc");
  });
});
