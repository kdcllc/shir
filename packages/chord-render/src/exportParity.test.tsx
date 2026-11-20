import { render } from "@testing-library/react";
import {
  buildExportSong,
  exportLineDirection,
  exportSongDirection,
  parseSong,
} from "chord-core";
import type { ExportLine, SongModel, TextDirection } from "chord-core";
import { ALL_FIXTURE_NAMES } from "test-fixtures";
import { describe, expect, it } from "vitest";
import { lineDirection, songDirection } from "./lineDirection";
import { SongView } from "./SongView";
import { readFixture } from "./test/fixtures";

const songOf = (name: string): SongModel => parseSong(readFixture(name)).song;

/** A lyric or chords line with a direction made of an inline model (for synthetic cases). */
const lyric = (
  text: string,
  direction?: TextDirection,
): Extract<SongModel["lines"][number], { kind: "lyric" }> => ({
  kind: "lyric",
  lyric: text,
  chords: [],
  ...(direction ? { direction } : {}),
});

describe("export direction rules equal chord-render's", () => {
  it.each(ALL_FIXTURE_NAMES)("%s: song and line directions", (name) => {
    const song = songOf(name);
    expect(exportSongDirection(song)).toBe(songDirection(song));
    const lyrics = song.lines.filter((l) => l.kind === "lyric");
    for (const line of lyrics) {
      expect(exportLineDirection(line, song.direction)).toBe(
        lineDirection(line, song.direction),
      );
    }
  });

  it("precondition: the fixture set has RTL and LTR songs and lyric lines", () => {
    const dirs = new Set(
      ALL_FIXTURE_NAMES.map((n) => songDirection(songOf(n))),
    );
    expect(dirs).toEqual(new Set(["rtl", "ltr"]));
    const total = ALL_FIXTURE_NAMES.flatMap((n) =>
      songOf(n).lines.filter((l) => l.kind === "lyric"),
    ).length;
    expect(total).toBeGreaterThan(10);
  });

  it("agree on the fallback order: explicit line > song > first strong > ltr", () => {
    const cases: [ReturnType<typeof lyric>, TextDirection | undefined][] = [
      [lyric("שלום", "ltr"), "rtl"], // line wins over song and text
      [lyric("hello"), "rtl"], // song wins over text
      [lyric("שלום"), undefined], // first strong
      [lyric("123 !?"), undefined], // no strong: ltr
    ];
    const want: TextDirection[] = ["ltr", "rtl", "rtl", "ltr"];
    cases.forEach(([line, dir], i) => {
      expect(lineDirection(line, dir)).toBe(want[i]);
      expect(exportLineDirection(line, dir)).toBe(want[i]);
    });
  });

  it("song direction falls back to the first lyric's strong direction, then ltr", () => {
    const base = parseSong("{title: x}\n123\nשלום\n").song;
    expect(songDirection(base)).toBe("rtl");
    expect(exportSongDirection(base)).toBe("rtl");
    const none = parseSong("{title: x}\n123\n").song;
    expect(exportSongDirection(none)).toBe("ltr");
    expect(songDirection(none)).toBe("ltr");
  });
});

/** What ChordLine resolves a rendered `dir` attribute to (`auto` over chord-only text is ltr). */
const resolvedDir = (el: Element): TextDirection => {
  const attr = el.getAttribute("dir");
  return attr === "rtl" ? "rtl" : "ltr";
};

describe("export lines match what ChordLine renders", () => {
  it.each(ALL_FIXTURE_NAMES)("%s", (name) => {
    const song = songOf(name);
    const exported = buildExportSong(song, { transpose: 0 });
    // Render the same viewed model the export was built from.
    const { container, unmount } = render(<SongView song={exported.model} />);
    const rendered = [
      ...container.querySelectorAll(
        '[data-line="lyric"], [data-line="chords"]',
      ),
    ];
    const lines = exported.lines.filter(
      (l): l is Extract<ExportLine, { kind: "lyric" | "chords" }> =>
        l.kind === "lyric" || l.kind === "chords",
    );
    expect(lines).toHaveLength(rendered.length);

    lines.forEach((line, i) => {
      const el = rendered[i] as Element;
      expect(el.getAttribute("data-line")).toBe(line.kind);
      const renderedChords = [...el.querySelectorAll("[data-chord]")].map((c) =>
        c.getAttribute("data-chord"),
      );
      if (line.kind === "lyric") {
        // Per chord (same-index chords share one chord box), in order.
        const exportedChords = line.segments.flatMap((s) =>
          s.chord === undefined ? [] : [s.chord],
        );
        expect(renderedChords, `${name} line ${i} chords`).toEqual(
          exportedChords,
        );
        // Lyric text: the rendered text minus the chord boxes.
        const clone = el.cloneNode(true) as Element;
        clone.querySelectorAll("[data-chord-box]").forEach((b) => b.remove());
        expect(line.segments.map((s) => s.text).join("")).toBe(
          clone.textContent,
        );
        expect(line.direction).toBe(
          lineDirection(
            exported.model.lines.filter((l) => l.kind === "lyric")[
              lines.slice(0, i + 1).filter((l) => l.kind === "lyric").length - 1
            ] as Extract<SongModel["lines"][number], { kind: "lyric" }>,
            exported.model.direction,
          ),
        );
      } else {
        expect(renderedChords, `${name} line ${i} chord-only`).toEqual(
          line.chords,
        );
        expect(line.direction).toBe(resolvedDir(el));
      }
    });
    unmount();
  });

  it("precondition: the fixtures contain chord-only lines and chorded lyric lines", () => {
    const all = ALL_FIXTURE_NAMES.flatMap(
      (n) => buildExportSong(songOf(n)).lines,
    );
    expect(all.some((l) => l.kind === "chords")).toBe(true);
    expect(
      all.some((l) => l.kind === "lyric" && l.segments.some((s) => s.chord)),
    ).toBe(true);
  });

  it("a chord-only line in an RTL song exports and renders rtl; without a song direction both are ltr", () => {
    const rtl = buildExportSong(
      parseSong("{title: x}\n{meta: direction rtl}\n[Am] [G] [F]\n").song,
    );
    const chordsLine = rtl.lines.find((l) => l.kind === "chords");
    if (chordsLine?.kind !== "chords") throw new Error("no chords line");
    const a = render(<SongView song={rtl.model} />);
    const el = a.container.querySelector('[data-line="chords"]') as Element;
    expect(chordsLine.direction).toBe("rtl");
    expect(resolvedDir(el)).toBe("rtl");
    a.unmount();

    const ltr = buildExportSong(parseSong("{title: x}\n[Am] [G] [F]\n").song);
    const l2 = ltr.lines.find((l) => l.kind === "chords");
    if (l2?.kind !== "chords") throw new Error("no chords line");
    const b = render(<SongView song={ltr.model} />);
    const el2 = b.container.querySelector('[data-line="chords"]') as Element;
    expect(l2.direction).toBe("ltr");
    expect(resolvedDir(el2)).toBe("ltr");
    b.unmount();
  });
});
