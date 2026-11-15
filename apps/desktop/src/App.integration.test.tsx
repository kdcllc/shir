import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { viewSong } from "chord-core";
import type { SongModel } from "chord-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { loadLibrary } from "./library";
import { STRINGS } from "./strings";

vi.mock("./uiReady", () => ({ signalUiReady: vi.fn() }));

const library = loadLibrary();

function modelChords(song: SongModel): string[] {
  const out: string[] = [];
  for (const line of song.lines) {
    if (line.kind === "lyric") out.push(...line.chords.map((c) => c.chord));
    else if (line.kind === "chords") out.push(...line.chords);
  }
  return out;
}

function renderedChords(): string[] {
  return [...document.querySelectorAll("[data-song] .chord")].map(
    (el) => el.textContent ?? "",
  );
}

describe("App integration: every bundled song", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    cleanup();
    errorSpy.mockRestore();
  });

  it("has a non-trivial library", () => {
    expect(library.length).toBeGreaterThan(1);
  });

  it("covers key, capo and diagnostics branches", () => {
    const diagCount = (e: (typeof library)[number]): number =>
      e.diagnostics.length +
      viewSong(e.song, { capo: e.song.capo ?? 0 }).diagnostics.length;
    expect(
      library.some(
        (e) =>
          viewSong(e.song, { capo: e.song.capo ?? 0 }).soundingKey !==
          undefined,
      ),
    ).toBe(true);
    expect(library.some((e) => (e.song.capo ?? 0) > 0)).toBe(true);
    expect(library.some((e) => diagCount(e) > 0)).toBe(true);
    expect(library.some((e) => diagCount(e) === 0)).toBe(true);
  });

  it.each(library.map((e) => [e.id, e] as const))("%s", (_id, entry) => {
    render(<App />);
    const index = library.findIndex((s) => s.id === entry.id);
    fireEvent.click(screen.getAllByTestId("song-item")[index]!);

    const capo = entry.song.capo ?? 0;
    expect(screen.getByTestId("song-title").textContent).toBe(entry.title);

    const base = viewSong(entry.song, { capo });
    expect(renderedChords()).toEqual(modelChords(base.song));

    const diagCount = entry.diagnostics.length + base.diagnostics.length;
    if (diagCount > 0) {
      expect(screen.getAllByTestId("diagnostic-item")).toHaveLength(diagCount);
    } else {
      expect(screen.queryByTestId("diagnostics")).toBeNull();
    }
    expect(screen.queryByTestId("diagnostics") !== null).toBe(diagCount > 0);

    if (entry.song.key !== undefined) {
      fireEvent.click(screen.getByTestId("transpose-up"));
      fireEvent.click(screen.getByTestId("transpose-up"));
      fireEvent.click(screen.getByTestId("transpose-up"));
      expect(screen.getByTestId("transpose-value").textContent).toBe("+3");
      expect(renderedChords()).toEqual(
        modelChords(viewSong(entry.song, { transpose: 3, capo }).song),
      );

      fireEvent.change(screen.getByTestId("capo-select"), {
        target: { value: "0" },
      });
      const sounding = viewSong(entry.song, {
        transpose: 3,
        capo: 0,
      }).soundingKey;
      expect(sounding).toBeDefined();
      expect(screen.getByTestId("sounding-key").textContent).toBe(sounding);
      expect(screen.getByTestId("shape-key").textContent).toBe(sounding);
      expect(screen.getByTestId("sounding-key").textContent).not.toBe(
        STRINGS.noKey,
      );
    }

    expect(errorSpy).not.toHaveBeenCalled();
  });
});
