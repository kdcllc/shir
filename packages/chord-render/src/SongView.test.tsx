import { render } from "@testing-library/react";
import type { SongLine, SongModel } from "chord-core";
import { describe, expect, it } from "vitest";
import { SongView } from "./SongView";

const allKinds: SongModel = {
  lines: [
    { kind: "meta", name: "title", value: "T" },
    { kind: "remark", text: " note" },
    { kind: "directive", name: "x_custom", value: "v" },
    { kind: "comment", style: "italic", text: "hello" },
    { kind: "section", edge: "start", section: "verse", label: "Verse 1" },
    { kind: "lyric", lyric: "ab", chords: [{ index: 0, chord: "C" }] },
    { kind: "chords", chords: ["G", "Am"] },
    { kind: "empty" },
    { kind: "section", edge: "end", section: "verse" },
    { kind: "section", edge: "start", section: "tab" },
    { kind: "tab", text: "e|--0--|" },
    { kind: "raw", text: "{broken" },
  ],
};

describe("SongView line kinds", () => {
  it("renders exactly the R1 elements in order for all 10 kinds", () => {
    const { container } = render(<SongView song={allKinds} />);
    const lines = [...container.querySelectorAll("[data-line]")];
    expect(lines.map((l) => l.getAttribute("data-line"))).toEqual([
      "comment",
      "section",
      "lyric",
      "chords",
      "empty",
      "section",
      "tab",
      "raw",
    ]);
    expect(lines[0]?.getAttribute("data-style")).toBe("italic");
    expect(lines[1]?.textContent).toBe("Verse 1");
    expect(lines[1]?.getAttribute("data-section")).toBe("verse");
    expect(lines[6]?.getAttribute("dir")).toBe("ltr");
    expect(lines[7]?.getAttribute("dir")).toBe("auto");
    expect(container.textContent).not.toContain("note");
    expect(container.textContent).not.toContain("x_custom");
  });

  it("renders a Hebrew comment with dir=auto", () => {
    const { container } = render(
      <SongView
        song={{
          lines: [{ kind: "comment", style: "normal", text: "שלום עולם" }],
        }}
      />,
    );
    const p = container.querySelector('[data-line="comment"]');
    expect(p?.getAttribute("dir")).toBe("auto");
    expect(p?.textContent).toBe("שלום עולם");
  });

  it("keeps leading spaces of a tab line", () => {
    const { container } = render(
      <SongView song={{ lines: [{ kind: "tab", text: "   e|-1-|" }] }} />,
    );
    expect(container.querySelector('[data-line="tab"]')?.textContent).toBe(
      "   e|-1-|",
    );
  });

  it("shows the section name when there is no label", () => {
    const { container } = render(
      <SongView
        song={{
          lines: [{ kind: "section", edge: "start", section: "chorus" }],
        }}
      />,
    );
    expect(container.querySelector('[data-line="section"]')?.textContent).toBe(
      "chorus",
    );
  });

  it("does not use HTML injection for text", () => {
    const { container } = render(
      <SongView
        song={{
          lines: [{ kind: "raw", text: "<b>x</b>" }],
        }}
      />,
    );
    expect(container.querySelector("b")).toBeNull();
  });

  it("is exhaustive over SongLine kinds (type-level)", () => {
    // @ts-expect-error a fake kind is not a SongLine
    const fake: SongLine = { kind: "nope" };
    expect(fake.kind).toBe("nope");
  });
});
