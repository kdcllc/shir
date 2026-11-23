// g12 cross-task: the F49 letter-based chord spelling (chord-core) shows up, unchanged and in
// order, in the Visual editor's chord picker. Original song text only.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { parseSong, suggestChords } from "chord-core";
import type { EditOp, SongModel } from "chord-core";
import { VisualEditor } from "./components/VisualEditor";

const parsed = (text: string): SongModel => parseSong(text).song;

/** Renders the editor with a song that never changes and opens the picker at the first lyric's `data-pos="1"`. */
function openPicker(song: SongModel): void {
  const first = song.lines.findIndex((l) => l.kind === "lyric");
  expect(first).toBeGreaterThanOrEqual(0);
  render(
    <VisualEditor
      song={song}
      onEdit={vi.fn<(ops: readonly EditOp[]) => void>()}
    />,
  );
  const row = document.querySelector(
    `[data-testid="visual-line"][data-line-index="${first}"]`,
  );
  const pos = row?.querySelector('[data-pos="1"]');
  if (!(pos instanceof HTMLElement)) throw new Error("no data-pos=1 slot");
  fireEvent.click(pos);
}

const options = (): string[] =>
  screen.queryAllByTestId("chord-option").map((o) => o.textContent ?? "");

const CASES: ReadonlyArray<{ key: string; want: string[] }> = [
  { key: "Gb", want: ["Gb", "Abm", "Bbm", "Cb", "Db", "Ebm"] },
  { key: "C#", want: ["C#", "D#m", "E#m", "F#", "G#", "A#m"] },
  { key: "Ebm", want: ["Ebm", "Gb", "Abm", "Bbm", "Cb", "Db"] },
];

describe("F49 letter-based spelling through the chord picker", () => {
  it.each(CASES)(
    "key $key lists $want, equal to suggestChords",
    ({ key, want }) => {
      const song = parsed(
        `{title: Lamp Probe}\n{key: ${key}}\n\n[${key}]small lamps by the water\n`,
      );
      openPicker(song);
      expect(options()).toEqual(want);
      expect(options()).toEqual(suggestChords(song, ""));
    },
  );

  it("filters by an ASCII-case-insensitive prefix and offers no bare B triad", () => {
    const song = parsed(
      "{title: Lamp Probe}\n{key: Gb}\n\n[Gb]small lamps by the water\n",
    );
    openPicker(song);
    const input = screen.getByTestId("chord-input");
    fireEvent.change(input, { target: { value: "c" } });
    expect(options()).toEqual(["Cb"]);
    fireEvent.change(input, { target: { value: "b" } });
    expect(options()).toEqual(["Bbm"]);
    expect(options()).not.toContain("B");
  });
});
