import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChordSymbol } from "./ChordSymbol";

const CHORDS = ["C#", "Bb", "F#m7(b5)", "Dsus4/F#"];

describe("ChordSymbol", () => {
  it.each(CHORDS)("renders %s as an LTR-isolated bdi", (chord) => {
    const { container } = render(<ChordSymbol chord={chord} />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.tagName).toBe("BDI");
    expect(el.textContent).toBe(chord);
    expect(el.getAttribute("dir")).toBe("ltr");
    expect(el).toHaveClass("chord");
    expect(el.getAttribute("data-chord")).toBe(chord);
  });

  it.each(CHORDS)(
    "keeps %s byte-identical inside an RTL container",
    (chord) => {
      const { container } = render(
        <div dir="rtl">
          שלום <ChordSymbol chord={chord} /> עולם
        </div>,
      );
      const el = container.querySelector("bdi.chord");
      expect(el?.textContent).toBe(chord);
      expect(el?.getAttribute("dir")).toBe("ltr");
    },
  );
});
