import { importText } from "chord-core";
import type { ImportResult } from "chord-core";
import { describe, expect, it, vi } from "vitest";
import { importSongFiles, withTitleFallback } from "./importFiles";
import type { FileImportDeps } from "./importFiles";
import { FileReadError } from "./files";
import { StorageError } from "./storage";
import type { Song } from "./storage";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const HE_SHEET = "Am      G\nשלום עולם יפה";
const EN_SHEET = "Am      G\nhello big world";

function song(id: string, chordpro: string): Song {
  return { id, chordpro, createdAt: "", updatedAt: "" } as unknown as Song;
}

function deps(
  files: Record<string, string | Error>,
  overrides: Partial<FileImportDeps> = {},
) {
  let n = 0;
  const base = {
    pickSongFiles: vi.fn(() => Promise.resolve(Object.keys(files))),
    readTextFile: vi.fn((path: string) => {
      const f = files[path];
      return f instanceof Error ? Promise.reject(f) : Promise.resolve(f ?? "");
    }),
    saveSong: vi.fn((chordpro: string) =>
      Promise.resolve(song(`id${++n}`, chordpro)),
    ),
    importText: vi.fn(importText),
  };
  const d: typeof base = { ...base, ...overrides } as typeof base;
  return d satisfies FileImportDeps;
}

describe("withTitleFallback", () => {
  it("prepends the basename without extension when there is no title", () => {
    expect(withTitleFallback("[C]hi", "/music/My Song.txt")).toBe(
      "{title: My Song}\n[C]hi",
    );
  });

  it("handles Windows-style paths", () => {
    expect(withTitleFallback("[C]hi", "C:\\songs\\Shalom.cho")).toBe(
      "{title: Shalom}\n[C]hi",
    );
  });

  it.each(["{title: Mine}\n[C]hi", "{t: Mine}\n[C]hi", "{TITLE: Mine}\nx"])(
    "never duplicates an existing title directive: %s",
    (text) => {
      expect(withTitleFallback(text, "/a/other.txt")).toBe(text);
    },
  );
});

describe("importSongFiles", () => {
  it("routing: saves chordpro and LTR files, queues RTL files", async () => {
    const d = deps({
      "/a/one.cho": "{title: One}\n[C]hello",
      "/a/two.txt": EN_SHEET,
      "/a/three.txt": HE_SHEET,
    });
    const report = await importSongFiles(d);
    expect(d.saveSong).toHaveBeenCalledTimes(2);
    for (const call of d.saveSong.mock.calls) {
      expect(call[0]).not.toContain("שלום");
    }
    expect(report.saved.map((s) => s.path)).toEqual([
      "/a/one.cho",
      "/a/two.txt",
    ]);
    expect(report.saved.map((s) => s.converted)).toEqual([false, true]);
    expect(report.queued).toHaveLength(1);
    const queued = report.queued[0]!;
    expect(queued.path).toBe("/a/three.txt");
    expect(queued.source).toBe(HE_SHEET);
    expect(queued.result.hasRtlChords).toBe(true);
    expect(queued.result.chordpro.startsWith("{title: three}\n")).toBe(true);
    expect(report.failed).toEqual([]);
  });

  it("a queued file with its own title keeps it and gets no fallback", async () => {
    const d = deps({ "/a/x.txt": `{title: Own}\n${HE_SHEET}` });
    const report = await importSongFiles(d);
    expect(d.saveSong).not.toHaveBeenCalled();
    const queued = report.queued[0]!;
    expect(queued.result.format).toBe("chords-over-lyrics");
    expect(queued.result.hasRtlChords).toBe(true);
    expect(queued.result.chordpro.startsWith("{title: Own}\n")).toBe(true);
    expect(queued.result.chordpro.match(/\{title/g)).toHaveLength(1);
  });

  it("routing: .cho with a chord-only line above a lyric is saved byte-identical", async () => {
    const text = "{title: Raw}\nAm   G\nשלום עולם";
    const d = deps({ "/a/raw.CHO": text });
    const report = await importSongFiles(d);
    expect(d.importText).not.toHaveBeenCalled();
    expect(d.saveSong).toHaveBeenCalledExactlyOnceWith(text);
    expect(report.saved[0]!.converted).toBe(false);
    expect(report.queued).toEqual([]);
  });

  it.each([".chopro", ".chordpro"])(
    "%s is a strict passthrough",
    async (ext) => {
      const d = deps({ [`/a/s${ext}`]: HE_SHEET });
      const report = await importSongFiles(d);
      expect(d.importText).not.toHaveBeenCalled();
      expect(d.saveSong).toHaveBeenCalledExactlyOnceWith(
        `{title: s}\n${HE_SHEET}`,
      );
      expect(report.queued).toEqual([]);
    },
  );

  it("applies the title fallback when saving", async () => {
    const d = deps({ "C:\\songs\\En Song.txt": EN_SHEET });
    await importSongFiles(d);
    expect(d.saveSong.mock.calls[0]![0].startsWith("{title: En Song}\n")).toBe(
      true,
    );
  });

  it("one failure among three does not stop the others", async () => {
    const d = deps({
      "/a/ok1.cho": "[C]a",
      "/a/bad.cho": new Error("boom"),
      "/a/ok2.cho": "[C]b",
    });
    const report = await importSongFiles(d);
    expect(report.saved).toHaveLength(2);
    expect(report.failed).toEqual([{ path: "/a/bad.cho", message: "boom" }]);
  });

  it("reports FileReadError and StorageError messages per file", async () => {
    const d = deps(
      {
        "/a/big.cho": new FileReadError("TooLarge", "file too large"),
        "/a/store.cho": "[C]x",
      },
      {
        saveSong: vi.fn(() =>
          Promise.reject(new StorageError("Invalid", "bad song")),
        ),
      },
    );
    const report = await importSongFiles(d);
    expect(report.failed).toEqual([
      { path: "/a/big.cho", message: "file too large" },
      { path: "/a/store.cho", message: "bad song" },
    ]);
    expect(report.saved).toEqual([]);
  });

  it("an empty pick does nothing", async () => {
    const d = deps({});
    const report = await importSongFiles(d);
    expect(report).toEqual({ saved: [], queued: [], failed: [] });
    expect(d.readTextFile).not.toHaveBeenCalled();
    expect(d.saveSong).not.toHaveBeenCalled();
  });

  it("uses the injected importText result", async () => {
    const result: ImportResult = {
      chordpro: "[C]fake",
      format: "chords-over-lyrics",
      warnings: [],
      hasRtlChords: false,
    };
    const d = deps(
      { "/a/f.txt": "whatever" },
      { importText: vi.fn(() => result) },
    );
    await importSongFiles(d);
    expect(d.saveSong).toHaveBeenCalledExactlyOnceWith("{title: f}\n[C]fake");
  });
});
