import { describe, expect, it } from "vitest";
import {
  ALL_FIXTURE_NAMES,
  EXPORT_GOLDEN_CASES,
  readExportGolden,
  readFixture,
} from "test-fixtures";
import { buildExportSong, directionalCells, parseSong } from "./index";

describe("export goldens", () => {
  it.each([...EXPORT_GOLDEN_CASES])(
    "$fixture t$transpose c$capo matches $file",
    (c) => {
      const song = parseSong(readFixture(c.fixture)).song;
      const exported = buildExportSong(song, {
        transpose: c.transpose,
        capo: c.capo,
      });
      const { model, ...rest } = exported;
      expect(model.lines.length).toBeGreaterThan(0);
      expect(rest).toEqual(readExportGolden(c));
    },
  );
});

describe("export segmentation over every fixture", () => {
  it.each([...ALL_FIXTURE_NAMES])(
    "%s: segment text concatenates to the lyric and chords keep order",
    (name) => {
      const song = parseSong(readFixture(name)).song;
      const out = buildExportSong(song, { transpose: 0, capo: 0 });
      const lyrics = out.model.lines.filter((l) => l.kind === "lyric");
      const exported = out.lines.filter((l) => l.kind === "lyric");
      expect(exported).toHaveLength(lyrics.length);
      lyrics.forEach((src, i) => {
        const line = exported[i];
        if (line?.kind !== "lyric" || src.kind !== "lyric") {
          throw new Error("expected lyric lines");
        }
        expect(line.segments.map((s) => s.text).join("")).toBe(src.lyric);
        expect(
          line.segments.flatMap((s) => (s.chord ? [s.chord] : [])),
        ).toEqual(src.chords.map((a) => a.chord));
        expect(
          directionalCells(line)
            .map((c) => c.text)
            .join(""),
        ).toBe(src.lyric);
      });
    },
  );
});
