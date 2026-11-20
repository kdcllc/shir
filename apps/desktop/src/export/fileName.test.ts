import { describe, expect, it } from "vitest";
import { exportFileName } from "./fileName";

describe("exportFileName", () => {
  it("replaces forbidden characters and control characters with a dash", () => {
    expect(exportFileName('a/b\\c:d*e?f"g<h>i|j', "docx")).toBe(
      "a-b-c-d-e-f-g-h-i-j.docx",
    );
    expect(exportFileName("a\u0000b\u001fc\u007fd", "pdf")).toBe("a-b-c-d.pdf");
  });

  it("trims and collapses whitespace", () => {
    expect(exportFileName("  Sunday   night \t set  ", "pdf")).toBe(
      "Sunday night set.pdf",
    );
  });

  it("keeps Hebrew titles including niqqud", () => {
    expect(exportFileName("שִׁיר הַשָּׁלוֹם", "docx")).toBe("שִׁיר הַשָּׁלוֹם.docx");
  });

  it("caps at 100 graphemes without splitting a grapheme", () => {
    const cluster = "שָׁ"; // 1 grapheme, several code points
    const name = exportFileName(cluster.repeat(150), "docx");
    expect(name).toBe(`${cluster.repeat(100)}.docx`);
    expect(exportFileName("x".repeat(150), "pdf")).toBe(
      `${"x".repeat(100)}.pdf`,
    );
  });

  it("falls back to setlist when nothing is left", () => {
    expect(exportFileName("", "docx")).toBe("setlist.docx");
    expect(exportFileName("  \t ", "pdf")).toBe("setlist.pdf");
  });
});
