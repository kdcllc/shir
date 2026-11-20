import { describe, expect, it } from "vitest";
import { parseSong } from "chord-core";
import {
  duplicateName,
  entriesToExport,
  moveItem,
  songToExport,
} from "./setlists";
import type { Setlist } from "./storage";

describe("moveItem", () => {
  it("moves an item down and up", () => {
    expect(moveItem(["a", "b", "c"], "a", 1)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b", "c"], "c", -1)).toEqual(["a", "c", "b"]);
  });

  it("changes nothing at the ends or for an unknown id", () => {
    expect(moveItem(["a", "b"], "a", -1)).toEqual(["a", "b"]);
    expect(moveItem(["a", "b"], "b", 1)).toEqual(["a", "b"]);
    expect(moveItem(["a", "b"], "z", 1)).toEqual(["a", "b"]);
  });

  it("returns a new array and leaves the input alone", () => {
    const ids = ["a", "b"];
    const out = moveItem(ids, "a", 1);
    expect(out).not.toBe(ids);
    expect(ids).toEqual(["a", "b"]);
  });
});

describe("duplicateName", () => {
  it("appends a space and the suffix", () => {
    expect(duplicateName("Sunday", "(copy)")).toBe("Sunday (copy)");
  });

  it("never exceeds 200 characters and keeps the suffix", () => {
    const out = duplicateName("x".repeat(200), "(copy)");
    expect([...out]).toHaveLength(200);
    expect(out.endsWith(" (copy)")).toBe(true);
  });

  it("cuts on a grapheme boundary (niqqud stays with its letter)", () => {
    const name = "שָׁ".repeat(100); // 3 code points per grapheme
    const out = duplicateName(name, "(עותק)");
    expect([...out].length).toBeLessThanOrEqual(200);
    expect(out.endsWith(" (עותק)")).toBe(true);
    const body = out.slice(0, out.length - " (עותק)".length);
    expect(body).toBe("שָׁ".repeat(body.length / 3));
  });
});

const setlist = (items: Setlist["items"]): Setlist => ({
  id: "s",
  name: "S",
  createdAt: "",
  updatedAt: "",
  items,
});

const item = (
  id: string,
  songId: string,
  transpose: number,
  capo: number | null,
): Setlist["items"][number] => ({
  id,
  songId,
  position: 0,
  transpose,
  capo,
  title: songId,
  artist: null,
  key: null,
  songCapo: null,
  language: "en",
});

describe("entriesToExport", () => {
  const songs = new Map([
    ["a", { chordpro: "{title: A}\n{capo: 2}\n[C]Morning light\n" }],
    ["b", { chordpro: "{title: B}\n[G]Open road\n" }],
  ]);

  it("keeps entry order, transpose and the capo fallback chain", () => {
    const out = entriesToExport(
      setlist([
        item("1", "b", 3, null),
        item("2", "a", -1, null),
        item("3", "a", 0, 5),
      ]),
      songs,
    );
    expect(out.map((e) => [e.song.title, e.transpose, e.capo])).toEqual([
      ["B", 3, 0],
      ["A", -1, 2],
      ["A", 0, 5],
    ]);
  });

  it("throws when a song is missing", () => {
    expect(() =>
      entriesToExport(setlist([item("1", "zzz", 0, null)]), songs),
    ).toThrow();
  });
});

describe("songToExport", () => {
  it("pairs the song with transpose and capo", () => {
    const { song } = parseSong("{title: T}\n[C]Hi\n");
    expect(songToExport(song, 2, 3)).toEqual({ song, transpose: 2, capo: 3 });
  });
});
