// g12 cross-task guards over the shared document and AI-reply fixtures. Original text only.
import { describe, expect, it } from "vitest";
import {
  readAiReply,
  readAiReplyExpected,
  readDocExpected,
  readDocPdfLines,
} from "test-fixtures";
import { parseAiReply } from "./aiReply";
import { documentToText } from "./documentText";
import { splitGraphemes } from "./graphemes";
import { importText } from "./import";
import { parseSong } from "./song";

const HEBREW_MARK = /[\u0591-\u05C7]/u;
const FORBIDDEN = ["Harbor", "Light"].join(" ");

/** The renamed songbook title: the `{title: ...}` of the second song of the fixture reply. */
function renamedTitle(): string {
  const second = readAiReplyExpected("two_songs_fenced")[1] as string;
  const m = /^\{title:\s*([^}]*?)\s*\}/m.exec(second);
  if (m === null) throw new Error("no title in the second fixture song");
  return m[1] as string;
}

describe("PDF niqqud line through documentToText and importText", () => {
  it("keeps every niqqud lyric line, mark for mark, once the chord anchors are removed", () => {
    const oracle = readDocPdfLines("he_chords_above");
    const { text, rtlColumns } = documentToText({
      format: "pdf",
      blocks: oracle.map((t) => ({ kind: "paragraph" as const, text: t })),
    });
    const { chordpro } = importText(text, { rtlColumns });
    const stripped = chordpro
      .split("\n")
      .map((l) => l.replace(/\[[^\]]*\]/g, ""));

    const marked = oracle.filter((l) => HEBREW_MARK.test(l));
    // Precondition: the fixture really has a niqqud lyric line.
    expect(marked).toContain("הַשֶּׁמֶשׁ עַל הַגֶּשֶׁר");
    for (const line of marked) {
      const got = stripped.find((l) => l === line);
      expect(got, line).toBeDefined();
      expect(splitGraphemes(got as string).length).toBe(
        splitGraphemes(line).length,
      );
    }
    // The chord line above the niqqud line became anchors on it.
    expect(chordpro).toMatch(/\[[A-G][^\]]*\][^\n]*ַ/u);
  });
});

describe("renamed songbook title across fixtures and the AI reply parser", () => {
  it("is consistent between the document fixtures, the reply fixture and parseAiReply", () => {
    const T = renamedTitle();
    expect(T).not.toBe("");
    expect(T).not.toContain(FORBIDDEN);

    const paragraphs = readDocExpected("songbook_mixed")
      .filter(
        (b): b is { kind: "paragraph"; text: string } =>
          (b as { kind: string }).kind === "paragraph",
      )
      .map((b) => b.text);
    expect(paragraphs.filter((t) => t === T)).toHaveLength(1);
    expect(
      readDocPdfLines("songbook_mixed").filter((l) => l === T),
    ).toHaveLength(1);

    const reply = readAiReply("two_songs_fenced");
    const { songs } = parseAiReply(reply);
    expect(songs).toHaveLength(2);
    expect(
      parseSong((songs[1] as { chordpro: string }).chordpro).song.title,
    ).toBe(T);
    expect(songs.map((s) => s.chordpro)).toEqual(
      readAiReplyExpected("two_songs_fenced"),
    );
  });
});
