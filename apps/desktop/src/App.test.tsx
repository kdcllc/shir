import { fireEvent, render, screen, within } from "@testing-library/react";
import { viewSong } from "chord-core";
import type { SongModel } from "chord-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { loadLibrary } from "./library";
import { signalUiReady } from "./uiReady";

vi.mock("./uiReady", () => ({ signalUiReady: vi.fn() }));

function byId(id: string) {
  const entry = loadLibrary().find((s) => s.id === id);
  if (!entry) throw new Error(`missing ${id}`);
  return entry;
}

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

function pickSong(id: string) {
  const index = loadLibrary().findIndex((s) => s.id === id);
  fireEvent.click(screen.getAllByTestId("song-item")[index]!);
}

describe("App", () => {
  beforeEach(() => {
    vi.mocked(signalUiReady).mockClear();
  });

  it("renders the Shir heading", () => {
    render(<App />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("Shir · שיר");
    expect(h1).toHaveAttribute("data-ui-chrome");
    expect(h1.querySelector("bdi")).toHaveAttribute("lang", "he");
  });

  it("lists every library song with the first selected", () => {
    render(<App />);
    const items = screen.getAllByTestId("song-item");
    expect(items).toHaveLength(loadLibrary().length);
    expect(items[0]).toHaveAttribute("aria-current", "true");
    expect(items[1]).not.toHaveAttribute("aria-current");
  });

  it("shows the first song's header initially", () => {
    render(<App />);
    expect(screen.getByTestId("song-title").textContent).toBe(
      "שיר הדגמה / Demo Song",
    );
    expect(screen.getByTestId("song-artist").textContent).toBe("Shir demo");
    expect(screen.getByTestId("sounding-key").textContent).toBe("Am");
  });

  it("selecting a song updates the header and capo", () => {
    render(<App />);
    pickSong("test-songs:sections_he");
    const entry = byId("test-songs:sections_he");
    expect(screen.getByTestId("song-title").textContent).toBe(entry.title);
    expect(screen.getByTestId("capo-select")).toHaveValue("2");
    expect(screen.getByTestId("capo-value").textContent).toBe("2");
  });

  it("switching to a capo-less song resets capo to 0", () => {
    const lib = loadLibrary();
    const withCapo = lib.find((s) => s.song.capo === 2);
    const without = lib.find((s) => s.song.capo === undefined);
    expect(withCapo).toBeDefined();
    expect(without).toBeDefined();
    render(<App />);
    pickSong(withCapo!.id);
    expect(screen.getByTestId("capo-select")).toHaveValue("2");
    pickSong(without!.id);
    expect(screen.getByTestId("capo-select")).toHaveValue("0");
    expect(screen.queryByTestId("capo-value")).toBeNull();
  });

  it("transpose +1 renders the chords viewSong predicts", () => {
    render(<App />);
    const entry = byId("samples:demo-shir-bilingual");
    const before = renderedChords();
    fireEvent.click(screen.getByTestId("transpose-up"));
    const expected = modelChords(
      viewSong(entry.song, { transpose: 1, capo: entry.song.capo ?? 0 }).song,
    );
    expect(expected.length).toBeGreaterThan(0);
    expect(renderedChords()).toEqual(expected);
    expect(renderedChords()).not.toEqual(before);
    expect(screen.getByTestId("transpose-value").textContent).toBe("+1");
  });

  it("capo changes update the shape key", () => {
    render(<App />);
    const entry = byId("samples:demo-shir-bilingual");
    const shape = (capo: number) =>
      viewSong(entry.song, { transpose: 0, capo }).shapeKey;
    expect(screen.getByTestId("shape-key").textContent).toBe(shape(0));
    fireEvent.change(screen.getByTestId("capo-select"), {
      target: { value: "3" },
    });
    expect(shape(3)).not.toBe(shape(0));
    expect(screen.getByTestId("shape-key").textContent).toBe(shape(3));
    expect(screen.getByTestId("capo-value").textContent).toBe("3");
  });

  it("Reset restores transpose and the song's capo", () => {
    render(<App />);
    pickSong("test-songs:sections_he");
    fireEvent.click(screen.getByTestId("transpose-up"));
    fireEvent.change(screen.getByTestId("capo-select"), {
      target: { value: "5" },
    });
    fireEvent.click(screen.getByTestId("reset-view"));
    expect(screen.getByTestId("transpose-value").textContent).toBe("0");
    expect(screen.getByTestId("capo-select")).toHaveValue("2");
  });

  it("switching songs resets transpose", () => {
    render(<App />);
    fireEvent.click(screen.getByTestId("transpose-up"));
    expect(screen.getByTestId("transpose-value").textContent).toBe("+1");
    pickSong("test-songs:en_plain");
    expect(screen.getByTestId("transpose-value").textContent).toBe("0");
  });

  it("malformed_input shows parse and view diagnostics", () => {
    render(<App />);
    pickSong("test-songs:malformed_input");
    const entry = byId("test-songs:malformed_input");
    const view = viewSong(entry.song, {
      transpose: 0,
      capo: entry.song.capo ?? 0,
    });
    const panel = screen.getByTestId("diagnostics");
    expect(within(panel).getAllByTestId("diagnostic-item")).toHaveLength(
      entry.diagnostics.length + view.diagnostics.length,
    );
    expect(entry.diagnostics.length).toBeGreaterThan(0);
  });

  it("slash_chords_key shows parse plus view diagnostics", () => {
    render(<App />);
    pickSong("test-songs:slash_chords_key");
    const entry = byId("test-songs:slash_chords_key");
    const view = viewSong(entry.song, { capo: entry.song.capo ?? 0 });
    expect(view.diagnostics.length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("diagnostic-item")).toHaveLength(
      entry.diagnostics.length + view.diagnostics.length,
    );
  });

  it("signals UI ready once after mount", () => {
    render(<App />);
    fireEvent.click(screen.getByTestId("transpose-up"));
    expect(signalUiReady).toHaveBeenCalledTimes(1);
  });

  it("does not mutate library songs when transposing", () => {
    const before = structuredClone(loadLibrary());
    render(<App />);
    fireEvent.click(screen.getByTestId("transpose-up"));
    fireEvent.click(screen.getByTestId("transpose-up"));
    expect(loadLibrary()).toEqual(before);
  });
});
