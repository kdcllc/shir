// Cross-task pipeline: every document fixture in every format through importSongFiles with the
// real chord-core documentToText and importText (only the IPC and the dialog are replaced).
import {
  documentToText,
  importText,
  parseAiReply,
  parseSong,
} from "chord-core";
import { describe, expect, it, vi } from "vitest";
import {
  AI_REPLY_FIXTURE_NAMES,
  DOC_FIXTURE_NAMES,
  DOC_FORMATS,
  readAiReply,
  readAiReplyExpected,
  readDocAnchors,
  readDocExpected,
  readDocPdfLines,
} from "../../../packages/test-fixtures/src/index";
import type {
  DocFixtureName,
  DocFormat as FixtureFormat,
} from "../../../packages/test-fixtures/src/index";
import type { DocumentText } from "./bindings";
import { importSongFiles } from "./importFiles";
import type { FileImportDeps } from "./importFiles";
import type { Song } from "./storage";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const TITLE = /^\s*\{\s*(?:title\b|t\s*:)/im;

function extracted(name: DocFixtureName, format: FixtureFormat): DocumentText {
  const blocks =
    format === "pdf"
      ? readDocPdfLines(name).map((text) => ({
          kind: "paragraph" as const,
          text,
        }))
      : (readDocExpected(name) as DocumentText["blocks"]);
  return { format, blocks, warnings: [] };
}

function deps(path: string, doc: DocumentText) {
  return {
    pickSongFiles: vi.fn(() => Promise.resolve([path])),
    readTextFile: vi.fn(() => Promise.reject(new Error("not a text file"))),
    saveSong: vi.fn((chordpro: string): Promise<Song> =>
      Promise.resolve({ id: "x", chordpro } as unknown as Song),
    ),
    importText,
    extractDocument: vi.fn(() => Promise.resolve(doc)),
    documentToText,
  } satisfies FileImportDeps;
}

const CASES = DOC_FIXTURE_NAMES.flatMap((name) =>
  DOC_FORMATS.map((format) => [name, format] as const),
);

describe("document import pipeline with the real chord-core", () => {
  it.each(CASES)(
    "%s.%s is queued, never saved, mirrored, valid ChordPro with a title",
    async (name, format) => {
      const path = `/music/${name}.${format}`;
      const d = deps(path, extracted(name, format));
      const report = await importSongFiles(d);

      expect(report.failed).toEqual([]);
      expect(report.saved).toEqual([]);
      expect(d.saveSong).not.toHaveBeenCalled();
      expect(report.queued).toHaveLength(1);
      const q = report.queued[0];
      if (q === undefined) throw new Error("not queued");
      expect(q.rtlColumns).toBe("mirror");
      expect(q.document?.format).toBe(format);
      expect(q.document?.name).toBe(`${name}.${format}`);
      expect(q.document?.text.length).toBeGreaterThan(0);
      expect(q.source).toBe(q.document?.text);

      expect(
        parseSong(q.result.chordpro).diagnostics.filter(
          (x) => x.code === "syntax",
        ),
      ).toEqual([]);
      expect(q.result.chordpro).toMatch(TITLE);
      const raw = importText(q.source, { rtlColumns: "mirror" }).chordpro;
      if (!TITLE.test(raw)) {
        expect(q.result.chordpro.startsWith(`{title: ${name}}\n`)).toBe(true);
      }
    },
  );

  it.each(["docx", "odt", "rtf"] as const)(
    "he_chords_above.%s places every anchored chord at its grapheme index",
    async (format) => {
      const d = deps(
        `/music/he_chords_above.${format}`,
        extracted("he_chords_above", format),
      );
      const report = await importSongFiles(d);
      const q = report.queued[0];
      if (q === undefined) throw new Error("not queued");
      expect(q.rtlColumns).toBe("mirror");
      const lines = parseSong(q.result.chordpro).song.lines;
      const anchors = readDocAnchors();
      expect(anchors.length).toBeGreaterThan(0);
      for (const entry of anchors) {
        const line = lines.find(
          (l) => l.kind === "lyric" && l.lyric === entry.line,
        );
        expect(line, entry.line).toBeDefined();
        if (line === undefined || line.kind !== "lyric") continue;
        expect(
          line.chords.find(
            (c) => c.chord === entry.chord && c.index === entry.index,
          ),
          `${entry.line} ${entry.chord}@${entry.index}`,
        ).toBeDefined();
      }
    },
  );

  it("a document with no blocks fails with reason NoText and is not queued", async () => {
    const d = deps("/music/scan.pdf", {
      format: "pdf",
      blocks: [],
      warnings: [{ kind: "PdfNoText", message: "no text layer" }],
    });
    const report = await importSongFiles(d);
    expect(report.queued).toEqual([]);
    expect(report.failed).toEqual([
      { path: "/music/scan.pdf", message: "no text layer", reason: "NoText" },
    ]);
  });

  it("passes the rtlColumns of documentToText on to importText and the queued file", async () => {
    const text = "Am      G\nשלום עולם יפה";
    const d = deps("/music/x.docx", extracted("he_chords_above", "docx"));
    const importSpy = vi.fn(importText);
    const report = await importSongFiles({
      ...d,
      importText: importSpy,
      documentToText: () => ({ text, rtlColumns: "logical" }),
    });
    expect(report.queued[0]?.rtlColumns).toBe("logical");
    expect(importSpy).toHaveBeenCalledWith(text, { rtlColumns: "logical" });
  });

  it("documentToText throwing fails the file with reason Corrupt", async () => {
    const d = deps("/music/x.docx", extracted("he_chords_above", "docx"));
    const report = await importSongFiles({
      ...d,
      documentToText: () => {
        throw new Error("boom");
      },
    });
    expect(report.queued).toEqual([]);
    expect(report.failed).toEqual([
      { path: "/music/x.docx", message: "boom", reason: "Corrupt" },
    ]);
  });
});

describe("AI reply fixtures through parseAiReply", () => {
  it.each(AI_REPLY_FIXTURE_NAMES)("%s returns the expected songs", (name) => {
    const result = parseAiReply(readAiReply(name));
    expect(result.songs.map((s) => s.chordpro)).toEqual(
      readAiReplyExpected(name),
    );
    expect(result.truncated).toBe(false);
  });
});
