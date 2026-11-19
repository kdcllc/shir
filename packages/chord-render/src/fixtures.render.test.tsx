import { render } from "@testing-library/react";
import { splitGraphemes, parseSong } from "chord-core";
import type { SongLine, SongModel } from "chord-core";
import { ALL_FIXTURE_NAMES } from "test-fixtures";
import { beforeEach, describe, expect, it } from "vitest";
import { SongView } from "./SongView";
import { readFixture, readGolden } from "./test/fixtures";

/** Text of an element excluding every [data-chord-box] subtree. */
function textWithoutChordBoxes(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll("[data-chord-box]").forEach((b) => b.remove());
  return clone.textContent ?? "";
}

/** Golden lines that SongView renders as a [data-line] element (R1). */
const isRendered = (l: SongLine): boolean =>
  !(
    l.kind === "meta" ||
    l.kind === "remark" ||
    l.kind === "directive" ||
    (l.kind === "section" && l.edge === "end")
  );

/** Expected textContent of a plain-text rendered line, else undefined. */
function plainText(l: SongLine): string | undefined {
  switch (l.kind) {
    case "comment":
    case "tab":
    case "raw":
      return l.text;
    case "section":
      return l.edge === "start" ? (l.label ?? l.section) : undefined;
    default:
      return undefined;
  }
}

const chordTexts = (el: Element): string[] =>
  [...el.querySelectorAll(".chord")].map((c) => c.textContent ?? "");

describe.each(ALL_FIXTURE_NAMES)("fixture round trip: %s", (name) => {
  const golden = readGolden(name) as SongModel;
  const song = parseSong(readFixture(name)).song;
  let container: HTMLElement;
  let root: Element | null;
  let lines: Element[];
  // The shared setup cleans up after each test, so render per test.
  beforeEach(() => {
    ({ container } = render(<SongView song={song} />));
    root = container.querySelector("[data-song]");
    lines = [...container.querySelectorAll("[data-line]")];
  });
  const rendered = golden.lines.filter(isRendered);

  it("renders the song root with the golden direction", () => {
    expect(root).not.toBeNull();
    expect(root?.getAttribute("dir")).toBe(golden.direction ?? "auto");
  });

  it("renders one [data-line] per golden line with matching kinds", () => {
    expect(lines.map((l) => l.getAttribute("data-line"))).toEqual(
      rendered.map((l) => l.kind),
    );
    const hidden = golden.lines.some((l) => !isRendered(l));
    if (hidden) expect(lines.length).toBeLessThan(golden.lines.length);
    expect(
      container.querySelector(
        '[data-line="meta"],[data-line="remark"],[data-line="directive"]',
      ),
    ).toBeNull();
  });

  it("comment/section/tab/raw lines render their text", () => {
    rendered.forEach((g, i) => {
      const want = plainText(g);
      if (want !== undefined) expect(lines[i]?.textContent).toBe(want);
    });
  });

  it("lyric text, anchors and chords equal the golden", () => {
    let checked = 0;
    rendered.forEach((g, i) => {
      const el = lines[i];
      if (!el) throw new Error(`missing rendered line ${i}`);
      if (g.kind === "lyric") {
        checked++;
        expect(textWithoutChordBoxes(el)).toBe(g.lyric);
        const anchors = [...el.querySelectorAll("[data-anchor]")];
        const pairs = anchors.flatMap((a) => {
          const box = a.querySelector("[data-chord-box]");
          const index = Number(a.getAttribute("data-index"));
          return box ? chordTexts(box).map((c) => ({ index, chord: c })) : [];
        });
        expect(pairs).toEqual(g.chords);
        const graphemes = splitGraphemes(g.lyric);
        for (const a of anchors) {
          const index = Number(a.getAttribute("data-index"));
          if (index < graphemes.length) {
            expect(textWithoutChordBoxes(a)).toBe(graphemes[index]);
          } else {
            expect(textWithoutChordBoxes(a)).toBe("");
          }
        }
      } else if (g.kind === "chords") {
        checked++;
        expect(chordTexts(el)).toEqual(g.chords);
        expect(el.querySelector("[data-anchor]")).toBeNull();
      } else if (g.kind === "empty") {
        expect(el.textContent).toBe("");
      }
    });
    expect(checked).toBeGreaterThan(0);
  });

  it("every .chord is dir=ltr", () => {
    const all = [...container.querySelectorAll(".chord")];
    expect(all.length).toBeGreaterThan(0);
    for (const c of all) expect(c.getAttribute("dir")).toBe("ltr");
  });
});
