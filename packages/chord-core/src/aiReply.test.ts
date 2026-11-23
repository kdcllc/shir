import { describe, expect, it } from "vitest";
import {
  AI_REPLY_FIXTURE_NAMES,
  readAiReply,
  readAiReplyExpected,
} from "test-fixtures";
import { parseAiReply } from "./aiReply";

const song = (n: number): string => `{title: Song ${n}}\nA [C]line ${n}\n`;

describe("parseAiReply", () => {
  it.each(AI_REPLY_FIXTURE_NAMES)("%s matches its expected songs", (name) => {
    const r = parseAiReply(readAiReply(name));
    expect(r.songs.map((s) => s.chordpro)).toEqual(readAiReplyExpected(name));
    expect(r.truncated).toBe(false);
  });

  it("extracts titles", () => {
    const r = parseAiReply(readAiReply("two_songs_fenced"));
    expect(r.songs.map((s) => s.title)).toEqual([
      "שיר הנחל",
      "Saltwater Steps",
    ]);
  });

  it("leaves title unset when the song has none", () => {
    expect(parseAiReply("A [C]line\n").songs[0]?.title).toBeUndefined();
  });

  it("returns the diagnostic of an unclosed section", () => {
    const r = parseAiReply("{title: T}\n{start_of_chorus}\nA [C]line\n");
    expect(r.songs[0]?.diagnostics.map((d) => d.code)).toContain(
      "section-unclosed",
    );
  });

  it("handles BOM and CRLF", () => {
    const r = parseAiReply(
      `\uFEFF${song(1).replace(/\n/g, "\r\n")}{ns}\r\n${song(2).replace(/\n/g, "\r\n")}`,
    );
    expect(r.songs.map((s) => s.chordpro)).toEqual([song(1), song(2)]);
  });

  it("supports ~~~ fences", () => {
    const r = parseAiReply(`Intro\n~~~chordpro\n${song(1)}~~~\nOutro\n`);
    expect(r.songs.map((s) => s.chordpro)).toEqual([song(1)]);
  });

  it("closes a fenced block only on the same fence characters", () => {
    const tildeInBackticks = parseAiReply(
      `\`\`\`\n{title: A}\n~~~\nA [C]line\n\`\`\`\n`,
    );
    expect(tildeInBackticks.songs.map((s) => s.chordpro)).toEqual([
      "{title: A}\n~~~\nA [C]line\n",
    ]);
    const backticksInTildes = parseAiReply(
      `~~~\n{title: B}\n\`\`\`\nA [C]line\n~~~\n`,
    );
    expect(backticksInTildes.songs.map((s) => s.chordpro)).toEqual([
      "{title: B}\n```\nA [C]line\n",
    ]);
  });

  it("uses an unterminated fence up to the end of the reply", () => {
    const r = parseAiReply(`Intro\n\`\`\`\n${song(1)}`);
    expect(r.songs.map((s) => s.chordpro)).toEqual([song(1)]);
  });

  it("treats each fenced block as its own chunk", () => {
    const r = parseAiReply(
      `\`\`\`\n${song(1)}\`\`\`\ntext\n\`\`\`\n${song(2)}\`\`\`\n`,
    );
    expect(r.songs).toHaveLength(2);
  });

  it("matches the delimiter case-insensitively with spaces", () => {
    const r = parseAiReply(`${song(1)}  { New_Song }  \n${song(2)}`);
    expect(r.songs).toHaveLength(2);
  });

  it("drops an empty first piece before a leading delimiter", () => {
    const r = parseAiReply(`{new_song}\n${song(1)}`);
    expect(r.songs.map((s) => s.chordpro)).toEqual([song(1)]);
  });

  it("returns no songs for an empty reply", () => {
    expect(parseAiReply("")).toEqual({ songs: [], truncated: false });
    expect(parseAiReply("\n\n  \n").songs).toEqual([]);
  });

  it("caps at 500 songs and flags truncation", () => {
    const reply = Array.from({ length: 501 }, (_, i) => song(i)).join("{ns}\n");
    const r = parseAiReply(reply);
    expect(r.songs).toHaveLength(500);
    expect(r.truncated).toBe(true);
    expect(
      parseAiReply(
        Array.from({ length: 500 }, (_, i) => song(i)).join("{ns}\n"),
      ).truncated,
    ).toBe(false);
  });

  describe("CommonMark fences", () => {
    const chordpro = (reply: string): string[] =>
      parseAiReply(reply).songs.map((x) => x.chordpro);

    it("closes only on the same character, at least as long, with nothing after", () => {
      expect(
        chordpro("```\n{title: A}\n```chordpro\nA [C]line\n```\n"),
      ).toEqual(["{title: A}\n```chordpro\nA [C]line\n"]);
      expect(chordpro("````\n{title: A}\n```\nA [C]line\n````\n")).toEqual([
        "{title: A}\n```\nA [C]line\n",
      ]);
    });

    it("closes on a fence followed by trailing spaces", () => {
      expect(chordpro("```\n{title: A}\nA [C]line\n```   \n")).toEqual([
        "{title: A}\nA [C]line\n",
      ]);
    });
  });

  describe("unfenced fallback", () => {
    const chordpro = (reply: string): string[] =>
      parseAiReply(reply).songs.map((x) => x.chordpro);

    it("keeps an unfenced reply that ends with a stray fence line", () => {
      expect(chordpro("{title: A}\nA [C]line\n```\n")).toEqual([
        "{title: A}\nA [C]line\n",
      ]);
    });

    it("keeps the songs before a decorative fence line", () => {
      expect(
        chordpro(
          "{title: A}\nA [C]line\n{new_song}\n~~~~\n{title: B}\nB [G]line\n",
        ),
      ).toEqual(["{title: A}\nA [C]line\n", "{title: B}\nB [G]line\n"]);
    });

    it("keeps an unfenced reply when its only fence has nothing inside", () => {
      expect(chordpro("Intro text\n```\n")).toEqual(["Intro text\n"]);
    });

    it("gives no songs for an empty fenced block", () => {
      expect(chordpro("```\n```\n")).toEqual([]);
    });
  });
});
