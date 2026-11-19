import { fireEvent, render, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { splitGraphemes } from "chord-core";
import type { LyricLine, SongModel, TextDirection } from "chord-core";
import { ChordLine } from "./ChordLine";
import type { ChordLineEditing } from "./ChordLine";
import { lineDirection } from "./lineDirection";
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

// --- Editing mode (visual editor) -------------------------------------------------

interface FsLike {
  readFileSync(path: URL, encoding: "utf8"): string;
}
// Vite intercepts CSS imports, so read the source through Node's fs (as css.test.ts does).
const nodeFs = (
  globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }
).process?.getBuiltinModule?.("node:fs") as FsLike;

function handlers(caret?: number): ChordLineEditing & {
  onPosition: ReturnType<typeof vi.fn<(index: number) => void>>;
  onChord: ReturnType<typeof vi.fn<(anchor: number) => void>>;
} {
  return {
    caret,
    onPosition: vi.fn<(index: number) => void>(),
    onChord: vi.fn<(anchor: number) => void>(),
  };
}

function renderEditing(
  line: LyricLine,
  songDirection?: TextDirection,
  caret?: number,
) {
  const editing = handlers(caret);
  const utils = render(
    <ChordLine line={line} songDirection={songDirection} editing={editing} />,
  );
  const root = utils.container.querySelector<HTMLElement>(
    '[data-line="lyric"]',
  )!;
  return { ...utils, editing, root };
}

function positions(root: Element) {
  return Array.from(root.querySelectorAll<HTMLElement>("[data-pos]"));
}

function buttons(root: Element) {
  return Array.from(
    root.querySelectorAll<HTMLButtonElement>("[data-chord-button]"),
  );
}

/** Expected anchor position of a chord index: out-of-range indices land on the nearest end. */
function clampIndex(index: number, count: number): number {
  if (index < 0) return 0;
  return index > count ? count : index;
}

/** The whole editing DOM contract that holds for every lyric line. */
function expectContract(root: HTMLElement, line: LyricLine) {
  const graphemes = splitGraphemes(line.lyric);
  const count = graphemes.length;
  expect(root.getAttribute("data-editing")).toBe("");
  const pos = positions(root);
  // One element per grapheme plus the end slot, in logical order, all direct children.
  expect(pos.map((p) => p.getAttribute("data-pos"))).toEqual(
    Array.from({ length: count + 1 }, (_, i) => String(i)),
  );
  for (const p of pos) {
    expect(p.parentElement).toBe(root);
    expect(p.hasAttribute("dir")).toBe(false);
  }
  expect(Array.from(root.children)).toEqual(pos);
  expect(pos.slice(0, count).map(ownText)).toEqual(graphemes);
  expect(pos.map(ownText).join("")).toBe(line.lyric);
  expect(ownText(root)).toBe(line.lyric);
  // The end slot is always last and holds no lyric text.
  const end = root.lastElementChild!;
  expect(end.getAttribute("data-end-slot")).toBe("");
  expect(end.getAttribute("data-pos")).toBe(String(count));
  expect(ownText(end)).toBe("");
  expect(root.querySelectorAll("[data-end-slot]")).toHaveLength(1);
  // Every chord is one button naming its index in line.chords, in source order.
  const btns = buttons(root);
  expect(btns).toHaveLength(line.chords.length);
  expect(
    btns
      .map((b) => Number(b.getAttribute("data-anchor-index")))
      .sort((a, b) => a - b),
  ).toEqual(line.chords.map((_, a) => a));
  for (const b of btns) {
    const chord = line.chords[Number(b.getAttribute("data-anchor-index"))]!;
    expect(b.tagName).toBe("BUTTON");
    expect(b.getAttribute("type")).toBe("button");
    expect(b.getAttribute("data-chord-button")).toBe("");
    expect(b.textContent).toBe(chord.chord);
    expect(b.hasAttribute("aria-label")).toBe(false); // name comes from content
    expect(b.children).toHaveLength(1);
    const symbol = b.firstElementChild!;
    expect(symbol.tagName).toBe("BDI");
    expect(symbol.getAttribute("dir")).toBe("ltr");
    expect(symbol).toHaveClass("chord");
    expect(symbol.getAttribute("data-chord")).toBe(chord.chord);
    // The button sits in the chord box of the anchor at the clamped position.
    const box = b.parentElement!;
    expect(box.getAttribute("data-chord-box")).toBe("");
    const anchor = box.parentElement!;
    expect(anchor.getAttribute("data-anchor")).toBe("");
    const clamped = clampIndex(chord.index, count);
    expect(anchor.getAttribute("data-index")).toBe(String(clamped));
    expect(anchor.getAttribute("data-pos")).toBe(String(clamped));
  }
  // Positions without chords are not anchors.
  for (const p of pos) {
    const boxes = p.querySelectorAll("[data-chord-box]");
    expect(boxes).toHaveLength(p.hasAttribute("data-anchor") ? 1 : 0);
    expect(p.hasAttribute("data-index")).toBe(p.hasAttribute("data-anchor"));
  }
}

/** Anchor index, box dir and box text, as the overlap pass and CSS see them. */
function anchorShape(root: Element) {
  return Array.from(root.querySelectorAll("[data-anchor]")).map((a) => {
    const box = a.querySelector("[data-chord-box]")!;
    return {
      index: a.getAttribute("data-index"),
      text: ownText(a),
      dir: box.getAttribute("dir"),
      chords: box.textContent,
    };
  });
}

const EN: LyricLine = {
  kind: "lyric",
  lyric: "Hello sun",
  chords: [
    { index: 0, chord: "C" },
    { index: 6, chord: "G7" },
  ],
};
const HE: LyricLine = {
  kind: "lyric",
  lyric: "שלום עולם",
  chords: [
    { index: 0, chord: "Am" },
    { index: 5, chord: "F#m7(b5)" },
  ],
};
const HE_NIQQUD = song.lines[0] as LyricLine;
const MIXED: LyricLine = {
  kind: "lyric",
  lyric: "שיר rock 5",
  chords: [
    { index: 0, chord: "A" }, // ש
    { index: 3, chord: "B" }, // space
    { index: 4, chord: "G" }, // r
    { index: 9, chord: "D" }, // 5
    { index: 10, chord: "E" }, // end
  ],
};

describe("ChordLine editing mode", () => {
  it("English line: positions, end slot, anchors and chord buttons", () => {
    const { root } = renderEditing(EN);
    expectContract(root, EN);
    expect(root.getAttribute("dir")).toBe("auto");
    expect(positions(root)).toHaveLength(10);
    expect(anchorShape(root)).toEqual([
      { index: "0", text: "H", dir: "ltr", chords: "C" },
      { index: "6", text: "s", dir: "ltr", chords: "G7" },
    ]);
    // No chord at the end: the end slot is still rendered, and is not an anchor.
    const end = root.lastElementChild!;
    expect(end.hasAttribute("data-anchor")).toBe(false);
    expect(end.childNodes).toHaveLength(0);
    expect(within(root).getByRole("button", { name: "C" })).toBe(
      buttons(root)[0],
    );
    expect(within(root).getByRole("button", { name: "G7" })).toBe(
      buttons(root)[1],
    );
    expect(root.querySelectorAll("[data-caret]")).toHaveLength(0);
    expect(root.querySelectorAll("[data-seg]")).toHaveLength(0);
  });

  it("Hebrew line (rtl song): same contract in logical order", () => {
    const { root } = renderEditing(HE, "rtl");
    expectContract(root, HE);
    expect(root.getAttribute("dir")).toBe("rtl");
    expect(anchorShape(root)).toEqual([
      { index: "0", text: "ש", dir: "rtl", chords: "Am" },
      { index: "5", text: "ע", dir: "rtl", chords: "F#m7(b5)" },
    ]);
    expect(
      within(root).getByRole("button", { name: "F#m7(b5)" }),
    ).toHaveAttribute("data-anchor-index", "1");
  });

  it("Hebrew with niqqud: one position per grapheme cluster, not per code unit", () => {
    const graphemes = splitGraphemes(NIQQUD);
    // Precondition: the marks make code units and graphemes differ.
    expect(graphemes).toHaveLength(4);
    expect(NIQQUD.length).toBeGreaterThan(4);
    const { root } = renderEditing(HE_NIQQUD, "rtl");
    expectContract(root, HE_NIQQUD);
    const pos = positions(root);
    expect(pos).toHaveLength(5);
    expect(pos.slice(0, 4).map(ownText)).toEqual(["שָׁ", "ל", "וֹ", "ם"]);
    expect(ownText(root.querySelector('[data-pos="0"]')!)).toBe("שָׁ");
    expect(ownText(root.querySelector('[data-pos="2"]')!)).toBe("וֹ");
    expect(root.lastElementChild!.getAttribute("data-pos")).toBe("4");
  });

  it("mixed Hebrew/English line: box dir follows the grapheme, else the line", () => {
    const { root } = renderEditing(MIXED, "rtl");
    expectContract(root, MIXED);
    expect(root.getAttribute("dir")).toBe("rtl");
    expect(anchorShape(root)).toEqual([
      { index: "0", text: "ש", dir: "rtl", chords: "A" },
      { index: "3", text: " ", dir: "rtl", chords: "B" },
      { index: "4", text: "r", dir: "ltr", chords: "G" },
      { index: "9", text: "5", dir: "rtl", chords: "D" },
      { index: "10", text: "", dir: "rtl", chords: "E" },
    ]);
    // line.direction wins over the song direction, for the line and neutral boxes.
    const ltr = renderEditing({ ...MIXED, direction: "ltr" }, "rtl");
    expect(ltr.root.getAttribute("dir")).toBe("ltr");
    expect(anchorShape(ltr.root).map((a) => a.dir)).toEqual([
      "rtl",
      "ltr",
      "ltr",
      "ltr",
      "ltr",
    ]);
    // No direction given: dir="auto", neutral boxes use first-strong of the lyric.
    const auto = renderEditing(MIXED);
    expect(auto.root.getAttribute("dir")).toBe("auto");
    expect(anchorShape(auto.root).map((a) => a.dir)).toEqual([
      "rtl",
      "rtl",
      "ltr",
      "rtl",
      "rtl",
    ]);
  });

  it("empty lyric: only the end slot, and it is clickable", () => {
    const line: LyricLine = { kind: "lyric", lyric: "", chords: [] };
    const { root, editing } = renderEditing(line);
    expectContract(root, line);
    expect(root.children).toHaveLength(1);
    const end = root.firstElementChild!;
    expect(end.getAttribute("data-pos")).toBe("0");
    expect(end.getAttribute("data-end-slot")).toBe("");
    expect(end.hasAttribute("data-anchor")).toBe(false);
    fireEvent.click(end);
    expect(editing.onPosition.mock.calls).toEqual([[0]]);
    expect(editing.onChord).not.toHaveBeenCalled();
  });

  it("empty lyric with a chord: the chord sits in the end slot", () => {
    const line: LyricLine = {
      kind: "lyric",
      lyric: "",
      chords: [{ index: 0, chord: "Em" }],
    };
    const { root } = renderEditing(line, "rtl");
    expectContract(root, line);
    expect(root.children).toHaveLength(1);
    expect(anchorShape(root)).toEqual([
      { index: "0", text: "", dir: "rtl", chords: "Em" },
    ]);
  });

  it("two chords on one position share one box, in source order", () => {
    const { root } = renderEditing(HE_NIQQUD, "rtl");
    const anchors = root.querySelectorAll('[data-anchor][data-index="2"]');
    expect(anchors).toHaveLength(1);
    const boxes = anchors[0]!.querySelectorAll("[data-chord-box]");
    expect(boxes).toHaveLength(1);
    const box = boxes[0]!;
    expect(box.textContent).toBe("F#m7(b5) Dsus4/F#");
    const nodes = Array.from(box.childNodes);
    expect(nodes).toHaveLength(3);
    expect((nodes[0] as Element).getAttribute("data-anchor-index")).toBe("1");
    expect(nodes[1]!.nodeType).toBe(Node.TEXT_NODE);
    expect(nodes[1]!.textContent).toBe(" ");
    expect((nodes[2] as Element).getAttribute("data-anchor-index")).toBe("2");
    expect(buttons(box).map((b) => b.textContent)).toEqual([
      "F#m7(b5)",
      "Dsus4/F#",
    ]);
  });

  it("a chord at end of line is rendered in the end slot, as an anchor", () => {
    const { root } = renderEditing(HE_NIQQUD, "rtl");
    const end = root.lastElementChild!;
    expect(end.getAttribute("data-end-slot")).toBe("");
    expect(end.getAttribute("data-pos")).toBe("4");
    expect(end.getAttribute("data-anchor")).toBe("");
    expect(end.getAttribute("data-index")).toBe("4");
    expect(ownText(end)).toBe("");
    const box = end.querySelector("[data-chord-box]")!;
    expect(box.getAttribute("dir")).toBe("rtl");
    expect(box.textContent).toBe("C");
    expect(buttons(end)).toHaveLength(1);
    expect(buttons(end)[0]!.getAttribute("data-anchor-index")).toBe("3");
    // An ltr line gives the end box the line direction.
    const en = renderEditing({
      kind: "lyric",
      lyric: "la",
      chords: [{ index: 2, chord: "D" }],
    });
    expect(
      en.root.lastElementChild!.querySelector("[data-chord-box]")!,
    ).toHaveAttribute("dir", "ltr");
  });

  it("keeps the read-only anchor structure the overlap pass relies on", () => {
    for (const line of [EN, HE, HE_NIQQUD, MIXED]) {
      for (const dir of [undefined, "rtl", "ltr"] as const) {
        const ro = render(<ChordLine line={line} songDirection={dir} />);
        const ed = renderEditing(line, dir);
        const roRoot = ro.container.querySelector('[data-line="lyric"]')!;
        expect(anchorShape(ed.root)).toEqual(anchorShape(roRoot));
        expect(ed.root.getAttribute("dir")).toBe(roRoot.getAttribute("dir"));
        expect(ownText(ed.root)).toBe(ownText(roRoot));
        // Every chord box's parent is its anchor and has a previous sibling to pad,
        // except at position 0 (as in read-only mode).
        for (const box of ed.root.querySelectorAll("[data-chord-box]")) {
          const anchor = box.parentElement!;
          expect(anchor.hasAttribute("data-anchor")).toBe(true);
          expect(anchor.previousElementSibling === null).toBe(
            anchor.getAttribute("data-index") === "0",
          );
        }
        ro.unmount();
        ed.unmount();
      }
    }
  });

  it("marks only the caret position with data-caret", () => {
    const caretAt = (caret?: number) =>
      Array.from(
        renderEditing(HE, "rtl", caret).root.querySelectorAll("[data-caret]"),
      ).map((e) => [e.getAttribute("data-pos"), e.getAttribute("data-caret")]);
    expect(caretAt(undefined)).toEqual([]);
    expect(caretAt(0)).toEqual([["0", ""]]);
    expect(caretAt(5)).toEqual([["5", ""]]); // a position with a chord
    expect(caretAt(3)).toEqual([["3", ""]]);
    expect(caretAt(9)).toEqual([["9", ""]]); // graphemeCount: the end slot
    expect(caretAt(10)).toEqual([]); // just out of range
    expect(caretAt(-1)).toEqual([]);
    expect(caretAt(1.5)).toEqual([]);
  });

  it("the caret on the end slot marks the end slot", () => {
    const { root } = renderEditing(HE, "rtl", 9);
    expect(root.lastElementChild!.hasAttribute("data-caret")).toBe(true);
    expect(root.lastElementChild!.hasAttribute("data-end-slot")).toBe(true);
  });

  it("Hebrew line: clicks report logical indices", () => {
    const { root, editing } = renderEditing(HE, "rtl");
    fireEvent.click(root.querySelector('[data-pos="0"]')!);
    expect(editing.onPosition.mock.calls).toEqual([[0]]);
    expect(editing.onChord).not.toHaveBeenCalled();

    editing.onPosition.mockClear();
    fireEvent.click(root.querySelector('[data-anchor-index="1"]')!);
    expect(editing.onChord.mock.calls).toEqual([[1]]);
    expect(editing.onPosition).not.toHaveBeenCalled();
  });

  it("clicks: every position once; chord buttons never reach onPosition", () => {
    for (const [line, dir] of [
      [EN, undefined],
      [HE_NIQQUD, "rtl"],
      [MIXED, "rtl"],
    ] as const) {
      const { root, editing, unmount } = renderEditing(line, dir);
      const pos = positions(root);
      pos.forEach((p, i) => {
        // Click the lyric text node where there is one, else the element.
        const text = Array.from(p.childNodes).find(
          (n) => n.nodeType === Node.TEXT_NODE,
        );
        fireEvent.click(text?.parentElement ?? p);
        expect(editing.onPosition.mock.calls).toEqual([[i]]);
        editing.onPosition.mockClear();
      });
      expect(editing.onChord).not.toHaveBeenCalled();
      for (const b of buttons(root)) {
        const a = Number(b.getAttribute("data-anchor-index"));
        // Clicking the chord symbol inside the button counts as the button.
        fireEvent.click(b.firstElementChild!);
        expect(editing.onChord.mock.calls).toEqual([[a]]);
        editing.onChord.mockClear();
      }
      expect(editing.onPosition).not.toHaveBeenCalled();
      // The line itself is not a position.
      fireEvent.click(root);
      expect(editing.onPosition).not.toHaveBeenCalled();
      expect(editing.onChord).not.toHaveBeenCalled();
      unmount();
    }
  });

  it("clamps out-of-range anchors as read-only mode does, keeping the array index", () => {
    const line: LyricLine = {
      kind: "lyric",
      lyric: "abc",
      chords: [
        { index: 99, chord: "E" },
        { index: -3, chord: "A" },
        { index: 3, chord: "B7" },
      ],
    };
    const { root, editing } = renderEditing(line);
    expectContract(root, line);
    const ro = render(<ChordLine line={line} />);
    expect(anchorShape(root)).toEqual(
      anchorShape(ro.container.querySelector('[data-line="lyric"]')!),
    );
    expect(anchorShape(root)).toEqual([
      { index: "0", text: "a", dir: "ltr", chords: "A" },
      { index: "3", text: "", dir: "ltr", chords: "E B7" },
    ]);
    const end = root.lastElementChild!;
    expect(
      buttons(end).map((b) => b.getAttribute("data-anchor-index")),
    ).toEqual(["0", "2"]);
    expect(
      buttons(root.querySelector('[data-pos="0"]')!).map((b) =>
        b.getAttribute("data-anchor-index"),
      ),
    ).toEqual(["1"]);
    fireEvent.click(buttons(end)[0]!);
    expect(editing.onChord.mock.calls).toEqual([[0]]);
    expect(editing.onPosition).not.toHaveBeenCalled();
  });

  it("ignores editing on a chords line", () => {
    const line = { kind: "chords" as const, chords: ["C#", "Bb", "Em"] };
    const editing = handlers(0);
    const plain = render(<ChordLine line={line} songDirection="rtl" />);
    const edited = render(
      <ChordLine line={line} songDirection="rtl" editing={editing} />,
    );
    expect(edited.container.innerHTML).toBe(plain.container.innerHTML);
    expect(edited.container.querySelector("[data-editing]")).toBeNull();
    expect(edited.container.querySelector("[data-pos]")).toBeNull();
    expect(edited.container.querySelector("button")).toBeNull();
    fireEvent.click(edited.container.querySelector(".chord")!);
    expect(editing.onChord).not.toHaveBeenCalled();
    expect(editing.onPosition).not.toHaveBeenCalled();
  });

  it("without editing (absent or undefined) renders the read-only DOM", () => {
    for (const line of [EN, HE, HE_NIQQUD, MIXED]) {
      const absent = render(<ChordLine line={line} songDirection="rtl" />);
      const undef = render(
        <ChordLine line={line} songDirection="rtl" editing={undefined} />,
      );
      expect(undef.container.innerHTML).toBe(absent.container.innerHTML);
      const c = absent.container;
      for (const sel of [
        "[data-editing]",
        "[data-pos]",
        "[data-end-slot]",
        "[data-caret]",
        "[data-chord-button]",
        "button",
      ]) {
        expect(c.querySelector(sel)).toBeNull();
      }
      absent.unmount();
      undef.unmount();
    }
    // The read-only shape itself: segments between anchors, no per-grapheme elements.
    const { container } = render(<ChordLine line={EN} />);
    const root = container.querySelector('[data-line="lyric"]')!;
    expect(
      Array.from(root.children).map((e) =>
        e.hasAttribute("data-seg") ? `seg:${e.textContent}` : ownText(e),
      ),
    ).toEqual(["H", "seg:ello ", "s", "seg:un"]);
  });
});

describe("lineDirection", () => {
  const base: LyricLine = { kind: "lyric", lyric: "שיר", chords: [] };
  it("prefers line.direction, then the song, then first-strong, then ltr", () => {
    expect(lineDirection({ ...base, direction: "ltr" }, "rtl")).toBe("ltr");
    expect(lineDirection({ ...base, lyric: "abc" }, "rtl")).toBe("rtl");
    expect(lineDirection(base, "ltr")).toBe("ltr");
    expect(lineDirection(base)).toBe("rtl");
    expect(lineDirection({ ...base, lyric: "abc" })).toBe("ltr");
    expect(lineDirection({ ...base, lyric: "12 34" })).toBe("ltr");
    expect(lineDirection({ ...base, lyric: "" })).toBe("ltr");
  });
});

describe("ChordLine editing CSS", () => {
  // A variable path keeps Vite from rewriting the URL into an asset import.
  const cssFile = "./ChordLine.module.css";
  const css = nodeFs.readFileSync(new URL(cssFile, import.meta.url), "utf8");
  const printAt = css.indexOf("@media print");
  const screen = css.slice(0, printAt);
  const print = css.slice(printAt);
  const rule = (source: string, selector: string) => {
    const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = new RegExp(`(?:^|[},])\\s*${esc}\\s*{([^}]*)}`, "m").exec(source);
    return m ? m[1]! : null;
  };
  /**
   * Matches CSS text holding a `selector { … }` rule (located as `rule` does)
   * whose body matches `declaration`; used on the CSS text itself so a missing
   * rule fails with an assertion message.
   */
  const ruleWith = (selector: string, declaration: RegExp) => {
    const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(
      `(?:^|[},])\\s*${esc}\\s*{[^}]*${declaration.source}[^}]*}`,
      "m",
    );
  };

  it("has a print block after the screen rules", () => {
    expect(printAt).toBeGreaterThan(0);
    expect(css.match(/@media print/g)).toHaveLength(1);
  });

  it("draws positions, caret and end slot without shifting lyric text", () => {
    const pos = rule(screen, ".pos")!;
    expect(pos).toMatch(/cursor:\s*pointer/);
    expect(pos).toMatch(/display:\s*inline;/);
    expect(pos).not.toMatch(/margin|padding|border/);
    const caret = rule(screen, ".pos[data-caret]")!;
    expect(caret).toMatch(/outline:\s*2px solid/);
    expect(caret).not.toMatch(/margin|padding|border|inline-size|position/);
    // Only the end slot (always last on the line) takes inline space.
    expect(rule(screen, ".pos[data-end-slot]")).toMatch(
      /padding-inline-end:\s*0\.75em/,
    );
    expect(screen.match(/padding-inline|margin-inline|border-inline/g)).toEqual(
      ["padding-inline"],
    );
  });

  it("resets native button styling and keeps a visible focus outline", () => {
    const button = rule(screen, ".chordbtn")!;
    expect(button).toMatch(/font:\s*inherit/);
    expect(button).toMatch(/border:\s*0/);
    expect(button).toMatch(/background:\s*transparent/);
    expect(button).toMatch(/padding:\s*0/);
    expect(button).toMatch(/margin:\s*0/);
    expect(rule(screen, ".chordbtn:focus-visible")).toMatch(
      /outline:\s*2px solid/,
    );
  });

  it("@media print resets the caret, hover, cursor and end-slot rules", () => {
    expect(print).toMatch(ruleWith(".pos[data-caret]", /outline:\s*none/));
    expect(print).toMatch(
      ruleWith(".pos[data-caret]", /background-color:\s*transparent/),
    );
    expect(print).toMatch(
      ruleWith(".pos[data-end-slot]", /padding-inline-end:\s*0;/),
    );
    expect(print).toMatch(
      ruleWith(".pos:hover", /background-color:\s*transparent/),
    );
    expect(print).toMatch(/\.pos,\s*\.chordbtn\s*{[^}]*cursor:\s*auto/);
  });

  it("uses logical properties only", () => {
    expect(css).not.toMatch(
      /(^|[\s;{])(left|right|(margin|padding|border)-(left|right)[a-z-]*)\s*:/m,
    );
    expect(css).not.toMatch(/text-align:\s*(left|right)|float:/);
    expect(css).not.toMatch(/inline-block|inline-flex|display:\s*(flex|grid)/);
  });
});
