import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const open = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...a: unknown[]) => invoke(...a),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...a: unknown[]) => open(...a),
}));

import {
  FileReadError,
  FileWriteError,
  pickSongFiles,
  readTextFile,
  saveExportDocx,
} from "./files";
import { i18n } from "./i18n";

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

describe("isFileError accepts Invalid", () => {
  it("readTextFile keeps an Invalid error result as Invalid, not Ipc", async () => {
    invoke.mockImplementation(() =>
      Promise.reject({ kind: "Invalid", message: "m" }),
    );
    const err = await readTextFile("/x").catch((e: unknown) => e);
    expect((err as FileReadError).kind).toBe("Invalid");
  });
});

describe("saveExportDocx", () => {
  it("invokes save_export_docx with number[] bytes and returns the saved path", async () => {
    invoke.mockResolvedValue("/home/u/set.docx");
    await expect(
      saveExportDocx("set.docx", "Word", new Uint8Array([1, 2, 255])),
    ).resolves.toBe("/home/u/set.docx");
    expect(invoke.mock.calls[0]![0]).toBe("save_export_docx");
    expect(invoke.mock.calls[0]![1]).toEqual({
      defaultName: "set.docx",
      filterName: "Word",
      bytes: [1, 2, 255],
    });
  });

  it("resolves null when the user cancels", async () => {
    invoke.mockResolvedValue(null);
    await expect(
      saveExportDocx("a.docx", "Word", new Uint8Array([1])),
    ).resolves.toBeNull();
  });

  it.each(["Invalid", "Io"] as const)(
    "maps a %s error result to FileWriteError",
    async (kind) => {
      invoke.mockImplementation(() => Promise.reject({ kind, message: "m" }));
      const err = await saveExportDocx("a", "W", new Uint8Array([1])).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(FileWriteError);
      expect((err as FileWriteError).kind).toBe(kind);
      expect((err as FileWriteError).message).toBe("m");
    },
  );

  it("maps an IPC failure to kind Ipc", async () => {
    invoke.mockImplementation(() => Promise.reject(new Error("no ipc")));
    const err = await saveExportDocx("a", "W", new Uint8Array([1])).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(FileWriteError);
    expect((err as FileWriteError).kind).toBe("Ipc");
    expect((err as FileWriteError).message).toBe("no ipc");
  });

  it("maps a non-error rejection to kind Ipc", async () => {
    invoke.mockImplementation(() => Promise.reject("boom"));
    const err = await saveExportDocx("a", "W", new Uint8Array([1])).catch(
      (e: unknown) => e,
    );
    expect((err as FileWriteError).kind).toBe("Ipc");
    expect((err as FileWriteError).message).toBe("boom");
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

  it("reads the filter name from the current language when the dialog opens", async () => {
    const original = i18n.getResourceBundle("he", "translation") as object;
    i18n.addResourceBundle(
      "he",
      "translation",
      { fileFilterSongs: "⟦fileFilterSongs⟧" },
      true,
      true,
    );
    try {
      open.mockResolvedValue(null);
      await pickSongFiles();
      expect(open.mock.calls[0]![0].filters[0].name).toBe("Song files");
      await i18n.changeLanguage("he");
      await pickSongFiles();
      expect(open.mock.calls[1]![0].filters[0].name).toBe("⟦fileFilterSongs⟧");
    } finally {
      i18n.addResourceBundle("he", "translation", original, true, true);
    }
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
