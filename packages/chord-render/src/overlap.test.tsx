import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SongModel } from "chord-core";
import { SongView } from "./SongView";
import { computeOverlapPadding } from "./overlap";

describe("computeOverlapPadding", () => {
  it("returns zeros without overlap", () => {
    expect(
      computeOverlapPadding([
        { start: 0, end: 10 },
        { start: 20, end: 30 },
      ]),
    ).toEqual([0, 0]);
  });
  it("pads two overlapping boxes exactly", () => {
    expect(
      computeOverlapPadding([
        { start: 0, end: 20 },
        { start: 10, end: 30 },
      ]),
    ).toEqual([0, 14]);
  });
  it("cascades three boxes", () => {
    expect(
      computeOverlapPadding([
        { start: 0, end: 20 },
        { start: 10, end: 30 },
        { start: 20, end: 40 },
      ]),
    ).toEqual([0, 14, 14]);
  });
  it("honours a custom gap", () => {
    expect(
      computeOverlapPadding(
        [
          { start: 0, end: 20 },
          { start: 20, end: 30 },
        ],
        0,
      ),
    ).toEqual([0, 0]);
    expect(
      computeOverlapPadding(
        [
          { start: 0, end: 20 },
          { start: 20, end: 30 },
        ],
        10,
      ),
    ).toEqual([0, 10]);
  });
  it("handles empty input", () => {
    expect(computeOverlapPadding([])).toEqual([]);
  });
  it("clears all earlier ends for non-monotonic input", () => {
    const boxes = [
      { start: 0, end: 100 },
      { start: 50, end: 60 },
      { start: 55, end: 70 },
    ];
    const pads = computeOverlapPadding(boxes);
    expect(pads).toEqual([0, 54, 9]);
    let shift = 0;
    const shifted = boxes.map((b, i) => {
      shift += pads[i]!;
      return { start: b.start + shift, end: b.end + shift };
    });
    expect(shifted[2]!.start).toBeGreaterThanOrEqual(shifted[1]!.end + 4);
    expect(shifted[1]!.start).toBeGreaterThanOrEqual(shifted[0]!.end + 4);
  });
});

const song: SongModel = {
  lines: [
    {
      kind: "lyric",
      lyric: "abcd",
      chords: [
        { index: 0, chord: "C" },
        { index: 1, chord: "G" },
      ],
    },
  ],
};

let width = 500;
let measured: string[] = [];
const origRect = Element.prototype.getBoundingClientRect;

function rect(x: number, w: number): DOMRect {
  const box = {
    top: 0,
    bottom: 10,
    width: w,
    height: 10,
    x,
    y: 0,
    toJSON() {},
  };
  return Object.assign(box, { ["left"]: x, ["right"]: x + w }) as DOMRect;
}

beforeEach(() => {
  width = 500;
  measured = [];
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (this.hasAttribute("data-song")) return rect(0, width);
    if (this.getAttribute("data-line") === "lyric") return rect(0, width);
    if (this.hasAttribute("data-chord-box")) {
      const prev = this.parentElement
        ?.previousElementSibling as HTMLElement | null;
      const pad =
        parseFloat(prev?.style.getPropertyValue("padding-inline-end") ?? "") ||
        0;
      measured.push(`${this.textContent}:${pad}`);
      const idx = Number(this.parentElement?.getAttribute("data-index"));
      return rect(idx * 10 + pad, 40); // boxes always overlap without padding
    }
    return rect(0, 0);
  };
});

afterEach(() => {
  Element.prototype.getBoundingClientRect = origRect;
  Reflect.deleteProperty(globalThis, "ResizeObserver");
  Reflect.deleteProperty(document, "fonts");
});

const pass = (c: HTMLElement) =>
  Number(c.querySelector("[data-song]")!.getAttribute("data-overlap-pass"));

describe("SongView overlap pass", () => {
  it("renders without ResizeObserver and document.fonts and runs the initial pass", () => {
    expect("ResizeObserver" in globalThis).toBe(false);
    const { container } = render(<SongView song={song} />);
    expect(pass(container)).toBe(1);
  });

  it("pads the element preceding the later chord's anchor until boxes clear", () => {
    const { container } = render(<SongView song={song} />);
    const seg = container.querySelector(
      '[data-anchor][data-index="0"]',
    ) as HTMLElement;
    expect(seg.style.getPropertyValue("padding-inline-end")).toBe("34px"); // 40 - 10 + 4
  });

  it("re-runs on ResizeObserver only when the inline size changed", () => {
    let cb: ResizeObserverCallback = () => {};
    const observe = vi.fn();
    const disconnect = vi.fn();
    globalThis.ResizeObserver = class {
      constructor(c: ResizeObserverCallback) {
        cb = c;
      }
      observe = observe;
      disconnect = disconnect;
      unobserve() {}
    } as unknown as typeof ResizeObserver;
    const { container, unmount } = render(<SongView song={song} />);
    expect(observe).toHaveBeenCalledTimes(1);
    expect(pass(container)).toBe(1);
    act(() => cb([], {} as ResizeObserver));
    expect(pass(container)).toBe(1);
    width = 300;
    act(() => cb([], {} as ResizeObserver));
    expect(pass(container)).toBe(2);
    unmount();
    expect(disconnect).toHaveBeenCalled();
  });

  it("re-runs on font loadingdone and after fonts.ready, resetting previous padding first", async () => {
    const fonts = new EventTarget() as EventTarget & {
      ready: Promise<unknown>;
    };
    let resolveReady: () => void = () => {};
    fonts.ready = new Promise<void>((r) => {
      resolveReady = r;
    });
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: fonts,
    });
    const { container } = render(<SongView song={song} />);
    expect(pass(container)).toBe(1);
    measured = [];
    act(() => {
      fonts.dispatchEvent(new Event("loadingdone"));
    });
    expect(pass(container)).toBe(2);
    // first measurement of the new pass sees padding already reset
    expect(measured[1]).toBe("G:0");
    await act(async () => {
      resolveReady();
      await fonts.ready;
    });
    expect(pass(container)).toBe(3);
  });

  it("clears previously applied padding when the song changes", () => {
    const { container, rerender } = render(<SongView song={song} />);
    const anchor0 = () =>
      container.querySelector('[data-anchor][data-index="0"]') as HTMLElement;
    expect(anchor0().style.getPropertyValue("padding-inline-end")).toBe("34px");
    rerender(
      <SongView
        song={{
          lines: [
            {
              kind: "lyric",
              lyric: "abcd",
              chords: [
                { index: 0, chord: "C" },
                { index: 3, chord: "G" },
              ],
            },
          ],
        }}
      />,
    );
    expect(anchor0().style.getPropertyValue("padding-inline-end")).toBe("");
  });
});
