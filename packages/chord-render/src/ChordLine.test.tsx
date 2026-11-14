import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SongModel } from "chord-core";
import { ChordLine } from "./ChordLine";
import { SongView } from "./SongView";

const NIQQUD = "שָׁלוֹם";

const song: SongModel = {
  direction: "rtl",
  lines: [
    {
      kind: "lyric",
      lyric: NIQQUD,
      chords: [
        { index: 0, chord: "Am" },
        { index: 2, chord: "F#m7(b5)" },
        { index: 2, chord: "Dsus4/F#" },
        { index: 4, chord: "C" },
      ],
    },
    {
      kind: "lyric",
      lyric: "שיר rock 5",
      direction: "ltr",
      chords: [
        { index: 4, chord: "G" },
        { index: 5, chord: "D" },
        { index: 8, chord: "E" },
      ],
    },
    { kind: "chords", chords: ["C#", "Bb", "Em"] },
    { kind: "empty" },
  ],
};

function lyricLines(c: HTMLElement) {
  return Array.from(c.querySelectorAll<HTMLElement>('[data-line="lyric"]'));
}

function ownText(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll("[data-chord-box]").forEach((b) => b.remove());
  return clone.textContent ?? "";
}

describe("SongView DOM contract", () => {
  it("sets song/line dir with precedence line > song > auto and runs a pass", () => {
    const { container } = render(<SongView song={song} />);
    const root = container.querySelector("[data-song]")!;
    expect(root.getAttribute("dir")).toBe("rtl");
    expect(
      Number(root.getAttribute("data-overlap-pass")),
    ).toBeGreaterThanOrEqual(1);
    const lines = lyricLines(container);
    expect(lines[0]!.getAttribute("dir")).toBe("rtl");
    expect(lines[1]!.getAttribute("dir")).toBe("ltr");
    const chordsLine = container.querySelector('[data-line="chords"]')!;
    expect(chordsLine.getAttribute("dir")).toBe("rtl");
    expect(chordsLine.querySelectorAll("[data-anchor]")).toHaveLength(0);
    expect(chordsLine.textContent).toBe("C# Bb Em");
    expect(container.querySelector('[data-line="empty"]')).not.toBeNull();
  });

  it("defaults dir to auto without song or line direction", () => {
    const { container } = render(
      <SongView
        song={{
          lines: [
            { kind: "lyric", lyric: "hi", chords: [] },
            { kind: "chords", chords: ["C"] },
          ],
        }}
      />,
    );
    expect(container.querySelector("[data-song]")!.getAttribute("dir")).toBe(
      "auto",
    );
    expect(lyricLines(container)[0]!.getAttribute("dir")).toBe("auto");
    expect(
      container.querySelector('[data-line="chords"]')!.getAttribute("dir"),
    ).toBe("auto");
  });

  it("accepts className", () => {
    const { container } = render(<SongView song={song} className="extra" />);
    expect(container.querySelector("[data-song]")).toHaveClass("extra");
  });

  it("anchors wrap exactly their grapheme cluster", () => {
    const { container } = render(<SongView song={song} />);
    const line = lyricLines(container)[0]!;
    const a0 = line.querySelector('[data-anchor][data-index="0"]')!;
    const a2 = line.querySelector('[data-anchor][data-index="2"]')!;
    expect(ownText(a0)).toBe("שָׁ");
    expect(ownText(a2)).toBe("וֹ");
  });

  it("shares one box for equal-index chords, in source order", () => {
    const { container } = render(<SongView song={song} />);
    const a2 = lyricLines(container)[0]!.querySelectorAll(
      '[data-anchor][data-index="2"]',
    );
    expect(a2).toHaveLength(1);
    const boxes = a2[0]!.querySelectorAll("[data-chord-box]");
    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.textContent).toBe("F#m7(b5) Dsus4/F#");
  });

  it("renders an empty end-of-line anchor last", () => {
    const { container } = render(<SongView song={song} />);
    const line = lyricLines(container)[0]!;
    const last = line.lastElementChild!;
    expect(last.getAttribute("data-anchor")).toBe("");
    expect(last.getAttribute("data-index")).toBe("4");
    expect(ownText(last)).toBe("");
    expect(last.querySelector("[data-chord-box]")!.textContent).toBe("C");
    const idx = Array.from(line.querySelectorAll("[data-anchor]")).map((a) =>
      Number(a.getAttribute("data-index")),
    );
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
  });

  it("derives box dir from the grapheme, falling back to the line direction", () => {
    const rtlLine = {
      kind: "lyric" as const,
      lyric: "שיר rock 5",
      chords: [
        { index: 0, chord: "A" }, // ש
        { index: 3, chord: "B" }, // r
        { index: 8, chord: "C" }, // digit... "שיר rock 5": 0ש1י2ר3' '4r..7k8' '9 5
        { index: 9, chord: "D" }, // 5
        { index: 10, chord: "E" }, // end
      ],
    };
    const { container } = render(
      <ChordLine line={rtlLine} songDirection="rtl" />,
    );
    const dirOf = (i: number) =>
      container
        .querySelector(`[data-anchor][data-index="${i}"] [data-chord-box]`)!
        .getAttribute("dir");
    expect(dirOf(0)).toBe("rtl");
    expect(dirOf(3)).toBe("rtl"); // space grapheme -> line dir
    expect(dirOf(8)).toBe("rtl");
    expect(dirOf(9)).toBe("rtl");
    expect(dirOf(10)).toBe("rtl");
    const lat = render(
      <ChordLine
        line={{
          kind: "lyric",
          lyric: "שיר rock",
          chords: [{ index: 4, chord: "G" }],
        }}
        songDirection="rtl"
      />,
    );
    expect(
      lat.container
        .querySelector('[data-index="4"] [data-chord-box]')!
        .getAttribute("dir"),
    ).toBe("ltr");
  });

  it("falls back to first-strong of the lyric, then ltr, for the line direction", () => {
    const a = render(
      <ChordLine
        line={{
          kind: "lyric",
          lyric: "שיר 1",
          chords: [{ index: 4, chord: "G" }],
        }}
      />,
    );
    expect(
      a.container
        .querySelector('[data-index="4"] [data-chord-box]')!
        .getAttribute("dir"),
    ).toBe("rtl");
    const b = render(
      <ChordLine
        line={{
          kind: "lyric",
          lyric: "12",
          chords: [{ index: 0, chord: "G" }],
        }}
      />,
    );
    expect(
      b.container
        .querySelector('[data-index="0"] [data-chord-box]')!
        .getAttribute("dir"),
    ).toBe("ltr");
  });

  it("keeps lyric text exact (no reversal, no inserted characters)", () => {
    const { container } = render(<SongView song={song} />);
    const lines = lyricLines(container);
    expect(ownText(lines[0]!)).toBe(NIQQUD);
    expect(ownText(lines[1]!)).toBe("שיר rock 5");
  });

  it("keeps every .chord textContent equal to its source chord", () => {
    const { container } = render(<SongView song={song} />);
    const got = Array.from(container.querySelectorAll(".chord")).map(
      (c) => c.textContent,
    );
    expect(got).toEqual([
      "Am",
      "F#m7(b5)",
      "Dsus4/F#",
      "C",
      "G",
      "D",
      "E",
      "C#",
      "Bb",
      "Em",
    ]);
    for (const c of container.querySelectorAll(".chord")) {
      expect(c.tagName).toBe("BDI");
      expect(c.getAttribute("dir")).toBe("ltr");
      expect(c.getAttribute("data-chord")).toBe(c.textContent);
    }
  });

  it("never positions the ChordSymbol and emits no physical/chunk inline styles", () => {
    const { container } = render(<SongView song={song} />);
    for (const c of container.querySelectorAll(".chord"))
      expect(c.getAttribute("style")).toBeNull();
  });
});
