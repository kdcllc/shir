import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PrintDocument } from "./PrintDocument";
import { docOf, entry, inlineEntry, LABELS, META } from "./testSupport";

const props = { labels: LABELS, meta: META };

describe("PrintDocument", () => {
  it("renders the root with dir and lang, a cover and one song section per song", () => {
    const doc = docOf("רשימה", [
      inlineEntry("{title: שיר}\n{artist: מישהו}\n{key: G}\n\n[G]שלום\n"),
      entry("en_plain", { capo: 2 }),
    ]);
    const { container } = render(<PrintDocument doc={doc} cover {...props} />);
    const root = container.querySelector("[data-print-root]") as HTMLElement;
    expect(root.getAttribute("dir")).toBe("rtl");
    expect(root.getAttribute("lang")).toBe("he");
    const cover = root.querySelector("[data-print-cover]") as HTMLElement;
    expect(cover.querySelector("bdi")?.textContent).toBe("רשימה");
    expect(cover.textContent).toContain(`${LABELS.date} ${META.dateText}`);
    const items = Array.from(cover.querySelectorAll("li"));
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain("מישהו");
    expect(items[0]?.textContent).toContain(`${LABELS.key} G`);
    expect(items[0]?.textContent).not.toContain(LABELS.capo);
    expect(items[1]?.textContent).toContain(`${LABELS.capo} 2`);
    const songs = root.querySelectorAll("[data-print-song]");
    expect(songs).toHaveLength(2);
    for (const s of songs) {
      expect(s.querySelector("[data-print-header] h2 > bdi")).not.toBeNull();
      expect(s.querySelector("[data-song]")).not.toBeNull();
    }
  });

  it("omits the cover when asked and capo 0 / missing artist from the header", () => {
    const doc = docOf("T", [entry("he_niqqud")]);
    const { container } = render(
      <PrintDocument doc={doc} cover={false} {...props} />,
    );
    expect(container.querySelector("[data-print-cover]")).toBeNull();
    const header = container.querySelector(
      "[data-print-header]",
    ) as HTMLElement;
    expect(header.textContent).not.toContain(LABELS.capo);
  });
});
