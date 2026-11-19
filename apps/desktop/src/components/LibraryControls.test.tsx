import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LanguageFilter, SortOrder } from "../libraryView";
import { STRINGS } from "../strings";
import { LibraryControls } from "./LibraryControls";

const IDS = [
  "library-filter-all",
  "library-filter-he",
  "library-filter-en",
  "library-filter-mixed",
] as const;

function setup(
  language: LanguageFilter = "all",
  dir: "ltr" | "rtl" = "ltr",
  sort: SortOrder = "title",
) {
  const onSort = vi.fn();
  const onLanguage = vi.fn();
  render(
    <div dir={dir}>
      <LibraryControls
        sort={sort}
        language={language}
        onSort={onSort}
        onLanguage={onLanguage}
      />
    </div>,
  );
  return { onSort, onLanguage };
}

const radio = (id: (typeof IDS)[number]) => screen.getByTestId(id);

describe("LibraryControls", () => {
  it("is a labelled UI-chrome group", () => {
    setup();
    const group = screen.getByRole("group", { name: STRINGS.libraryView });
    expect(group).toHaveAttribute("data-ui-chrome");
  });

  it("has a labelled sort select with three options", () => {
    setup("all", "ltr", "artist");
    const select = screen.getByLabelText(STRINGS.sortLabel);
    expect(select).toBe(screen.getByTestId("library-sort"));
    expect(select.tagName).toBe("SELECT");
    expect(select).toHaveValue("artist");
    const options = within(select).getAllByRole("option");
    expect(options.map((o) => o.getAttribute("value"))).toEqual([
      "title",
      "artist",
      "updated",
    ]);
    expect(options.map((o) => o.textContent)).toEqual([
      STRINGS.sortTitle,
      STRINGS.sortArtist,
      STRINGS.sortUpdated,
    ]);
  });

  it("reports a sort change", () => {
    const { onSort } = setup();
    fireEvent.change(screen.getByTestId("library-sort"), {
      target: { value: "updated" },
    });
    expect(onSort).toHaveBeenCalledWith("updated");
  });

  it("is a radiogroup of four radios with one checked and roving tabIndex", () => {
    setup("en");
    const group = screen.getByRole("radiogroup", {
      name: STRINGS.filterLanguage,
    });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual([
      STRINGS.filterAll,
      STRINGS.filterHebrew,
      STRINGS.filterEnglish,
      STRINGS.filterMixed,
    ]);
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual([
      "false",
      "false",
      "true",
      "false",
    ]);
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, -1, 0, -1]);
    expect(radios.map((r) => r.dataset.testid)).toEqual([...IDS]);
  });

  it("reports a click on a radio", () => {
    const { onLanguage } = setup();
    fireEvent.click(radio("library-filter-mixed"));
    expect(onLanguage).toHaveBeenCalledWith("mixed");
  });

  it("moves with ArrowRight / ArrowLeft in ltr and focuses the new radio", () => {
    const { onLanguage } = setup("he");
    radio("library-filter-he").focus();
    fireEvent.keyDown(radio("library-filter-he"), { key: "ArrowRight" });
    expect(onLanguage).toHaveBeenLastCalledWith("en");
    expect(radio("library-filter-en")).toHaveFocus();
    fireEvent.keyDown(radio("library-filter-he"), { key: "ArrowLeft" });
    expect(onLanguage).toHaveBeenLastCalledWith("all");
  });

  it("swaps ArrowLeft / ArrowRight under dir=rtl", () => {
    const { onLanguage } = setup("he", "rtl");
    fireEvent.keyDown(radio("library-filter-he"), { key: "ArrowLeft" });
    expect(onLanguage).toHaveBeenLastCalledWith("en");
    fireEvent.keyDown(radio("library-filter-he"), { key: "ArrowRight" });
    expect(onLanguage).toHaveBeenLastCalledWith("all");
  });

  it("wraps around and supports ArrowDown / ArrowUp", () => {
    const { onLanguage } = setup("all");
    fireEvent.keyDown(radio("library-filter-all"), { key: "ArrowLeft" });
    expect(onLanguage).toHaveBeenLastCalledWith("mixed");
    fireEvent.keyDown(radio("library-filter-all"), { key: "ArrowDown" });
    expect(onLanguage).toHaveBeenLastCalledWith("he");
    fireEvent.keyDown(radio("library-filter-all"), { key: "ArrowUp" });
    expect(onLanguage).toHaveBeenLastCalledWith("mixed");
  });

  it("ignores other keys", () => {
    const { onLanguage } = setup();
    fireEvent.keyDown(radio("library-filter-all"), { key: "a" });
    expect(onLanguage).not.toHaveBeenCalled();
  });
});
