// g12 cross-task (V17): the Word cover title takes its own direction (task 07) while the song's
// cells keep chord-core's classify direction, Arabic included (task 02), in one buildDocx document.
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildDocx } from "./export/docx";
import { docOf, inlineEntry, LABELS, META } from "./export/testSupport";

const LTR_META = { lang: "en", dir: "ltr", dateText: "x" } as const;

async function documentXml(
  title: string,
  meta: typeof META | typeof LTR_META,
): Promise<Document> {
  const doc = docOf(title, [
    inlineEntry("{title: Road}\n\n[Am]مرحبا [G]عالم\n"),
  ]);
  const bytes = await buildDocx(doc, { cover: true, labels: LABELS, meta });
  const xml = strFromU8(unzipSync(bytes)["word/document.xml"] as Uint8Array);
  return new DOMParser().parseFromString(xml, "application/xml");
}

const all = (el: Element | Document, tag: string): Element[] =>
  Array.from(el.getElementsByTagName(tag));
const has = (el: Element, tag: string): boolean =>
  el.getElementsByTagName(tag).length > 0;
const text = (el: Element): string =>
  all(el, "w:t")
    .map((t) => t.textContent ?? "")
    .join("");

describe("cover title direction next to Arabic song cells", () => {
  it("a Hebrew title is bidi under an ltr UI, the date is not, and Arabic cells are rtl", async () => {
    const d = await documentXml("ערב שירה", LTR_META);
    const [titleP, dateP] = all(d, "w:p") as [Element, Element];
    // Precondition: these really are the cover title and date paragraphs.
    expect(text(titleP)).toBe("ערב שירה");
    expect(text(dateP)).toBe(`${LABELS.date}: ${LTR_META.dateText}`);
    // (a) the title's own direction wins over meta.dir
    expect(has(titleP, "w:bidi")).toBe(true);
    const titleRuns = all(titleP, "w:r");
    expect(titleRuns.length).toBeGreaterThan(0);
    expect(titleRuns.every((r) => has(r, "w:rtl"))).toBe(true);
    // (b) the date follows meta.dir
    expect(has(dateP, "w:bidi")).toBe(false);
    // (c) the Arabic lyric cells carry the rtl run property
    for (const word of ["مرحبا", "عالم"]) {
      const cellRuns = all(d, "w:tc")
        .flatMap((tc) => all(tc, "w:r"))
        .filter((r) => text(r).trim() === word);
      expect(cellRuns, word).toHaveLength(1);
      expect(has(cellRuns[0] as Element, "w:rtl"), word).toBe(true);
    }
  });

  it("negative control: an ltr title under an rtl UI is not bidi, though the Arabic cells still are rtl", async () => {
    const d = await documentXml("Sunday Set", META);
    const [titleP, dateP] = all(d, "w:p") as [Element, Element];
    expect(text(titleP)).toBe("Sunday Set");
    expect(has(titleP, "w:bidi")).toBe(false);
    expect(all(titleP, "w:r").some((r) => has(r, "w:rtl"))).toBe(false);
    expect(has(dateP, "w:bidi")).toBe(true);
    const arabic = all(d, "w:tc")
      .flatMap((tc) => all(tc, "w:r"))
      .filter((r) => text(r).trim() === "مرحبا");
    expect(arabic).toHaveLength(1);
    expect(has(arabic[0] as Element, "w:rtl")).toBe(true);
  });
});
