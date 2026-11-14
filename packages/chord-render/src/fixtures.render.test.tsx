import { render } from "@testing-library/react";
import { splitGraphemes, parseSong } from "chord-core";
import type { SongModel } from "chord-core";
import { readFileSync } from "node:fs";
import path from "node:path";
import { FIXTURE_NAMES } from "test-fixtures";
import { beforeEach, describe, expect, it } from "vitest";
import { SongView } from "./SongView";

// test-fixtures' own readers resolve paths via import.meta.url, which jsdom
// breaks (/@fs/ URL); read the same files by a directory-relative path instead.
const FIXTURES_DIR = path.resolve(
  import.meta.dirname,
  "../../test-fixtures/fixtures",
);
const readFixture = (name: string): string =>
  readFileSync(path.join(FIXTURES_DIR, `${name}.cho`), "utf8");
const readGolden = (name: string): unknown =>
  JSON.parse(
    readFileSync(path.join(FIXTURES_DIR, `${name}.golden.json`), "utf8"),
  );

/** Text of an element excluding every [data-chord-box] subtree. */
function textWithoutChordBoxes(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll("[data-chord-box]").forEach((b) => b.remove());
  return clone.textContent ?? "";
}

const chordTexts = (el: Element): string[] =>
  [...el.querySelectorAll(".chord")].map((c) => c.textContent ?? "");

describe.each(FIXTURE_NAMES)("fixture round trip: %s", (name) => {
  const golden = readGolden(name) as SongModel;
  const song = parseSong(readFixture(name));
  let container: HTMLElement;
  let root: Element | null;
  let lines: Element[];
  // The shared setup cleans up after each test, so render per test.
  beforeEach(() => {
    ({ container } = render(<SongView song={song} />));
    root = container.querySelector("[data-song]");
    lines = [...container.querySelectorAll("[data-line]")];
  });

  it("renders the song root with the golden direction", () => {
    expect(root).not.toBeNull();
    expect(root?.getAttribute("dir")).toBe(golden.direction ?? "auto");
  });

  it("renders one [data-line] per golden line with matching kinds", () => {
    expect(lines.map((l) => l.getAttribute("data-line"))).toEqual(
      golden.lines.map((l) => l.kind),
    );
  });

  it("lyric text, anchors and chords equal the golden", () => {
    let checked = 0;
    golden.lines.forEach((g, i) => {
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
      } else {
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
