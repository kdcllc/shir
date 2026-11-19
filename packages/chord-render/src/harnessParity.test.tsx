import { render } from "@testing-library/react";
import { parseSong } from "chord-core";
import type { SongModel } from "chord-core";
import { ALL_FIXTURE_NAMES } from "test-fixtures";
import { describe, expect, it } from "vitest";
import { EditingSong } from "../harness/EditingSong";
import { SongView } from "./SongView";
import { readFixture } from "./test/fixtures";

const songOf = (name: string): SongModel => parseSong(readFixture(name)).song;

interface RenderedLine {
  kind: string | null;
  html: string;
}

/** Every `[data-line]` element of a rendered song, in DOM order. */
function renderedLines(ui: React.ReactElement): RenderedLine[] {
  const { container, unmount } = render(ui);
  const lines = [...container.querySelectorAll("[data-line]")].map((el) => ({
    kind: el.getAttribute("data-line"),
    html: el.outerHTML,
  }));
  unmount();
  return lines;
}

const nonLyric = (lines: RenderedLine[]): RenderedLine[] =>
  lines.filter((l) => l.kind !== "lyric");

/** Line kinds other than `lyric` that render a `[data-line]` element. */
const NON_LYRIC_KINDS = ["chords", "empty", "comment", "section", "tab", "raw"];

describe("harness EditingSong renders non-lyric lines as SongView does", () => {
  it.each(ALL_FIXTURE_NAMES)("%s", (name) => {
    const song = songOf(name);
    const view = renderedLines(<SongView song={song} />);
    const editing = renderedLines(<EditingSong song={song} />);
    // Precondition: the fixture rendered at all.
    expect(view.length).toBeGreaterThan(0);
    // Same lines of the same kinds, in the same order (lyric lines included).
    expect(editing.map((l) => l.kind)).toEqual(view.map((l) => l.kind));
    const want = nonLyric(view);
    const got = nonLyric(editing);
    expect(got).toHaveLength(want.length);
    want.forEach((line, i) => {
      expect(got[i]?.html, `${name} non-lyric line ${i} (${line.kind})`).toBe(
        line.html,
      );
    });
  });

  it("precondition: the fixtures exercise every non-lyric rendered line kind", () => {
    const seen = new Set(
      ALL_FIXTURE_NAMES.flatMap((name) =>
        nonLyric(renderedLines(<SongView song={songOf(name)} />)).map(
          (l) => l.kind,
        ),
      ),
    );
    expect([...seen].sort()).toEqual([...NON_LYRIC_KINDS].sort());
  });

  it("precondition: lyric lines do differ between the two (the exclusion is needed)", () => {
    const song = songOf("he_plain");
    const lyricHtml = (lines: RenderedLine[]) =>
      lines.filter((l) => l.kind === "lyric").map((l) => l.html);
    const view = lyricHtml(renderedLines(<SongView song={song} />));
    const editing = lyricHtml(renderedLines(<EditingSong song={song} />));
    expect(view.length).toBeGreaterThan(0);
    expect(editing).toHaveLength(view.length);
    expect(editing).not.toEqual(view);
  });
});
