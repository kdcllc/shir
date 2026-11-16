import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SongIndex } from "./SongIndex";
import type { SongIndexItem } from "./SongIndex";

const items: SongIndexItem[] = [
  { id: "a", title: "Alpha", artist: "Ann", snippet: "first <b>line</b>" },
  { id: "b", title: "שיר", artist: null, snippet: null },
  { id: "c", title: "Gamma" },
];

describe("SongIndex", () => {
  it("renders the library variant as a ul with one button per song", () => {
    render(
      <SongIndex
        variant="library"
        items={items}
        selectedId={undefined}
        onSelect={vi.fn()}
      />,
    );
    const ul = screen.getByTestId("song-index");
    expect(ul.tagName).toBe("UL");
    expect(screen.queryByTestId("search-results")).toBeNull();
    const rows = screen.getAllByTestId("song-item");
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.tagName).toBe("BUTTON");
      expect(r).toHaveAttribute("type", "button");
    }
  });

  it("renders the results variant labelled Search results", () => {
    render(
      <SongIndex
        variant="results"
        items={items}
        selectedId={undefined}
        onSelect={vi.fn()}
      />,
    );
    const ul = screen.getByTestId("search-results");
    expect(ul).toHaveAttribute("aria-label", "Search results");
    expect(screen.queryByTestId("song-index")).toBeNull();
  });

  it("marks only the selected row with aria-current", () => {
    render(
      <SongIndex
        variant="library"
        items={items}
        selectedId="b"
        onSelect={vi.fn()}
      />,
    );
    const rows = screen.getAllByTestId("song-item");
    expect(rows[1]).toHaveAttribute("aria-current", "true");
    expect(rows[0]).not.toHaveAttribute("aria-current");
    expect(rows[2]).not.toHaveAttribute("aria-current");
  });

  it("shows title and artist with dir=auto, the snippet only when non-null", () => {
    render(
      <SongIndex
        variant="results"
        items={items}
        selectedId={undefined}
        onSelect={vi.fn()}
      />,
    );
    const rows = screen.getAllByTestId("song-item");
    expect(screen.getByText("Alpha")).toHaveAttribute("dir", "auto");
    expect(screen.getByText("Ann")).toHaveAttribute("dir", "auto");
    expect(rows[0]!.querySelectorAll("[dir=auto]")).toHaveLength(3);
    expect(rows[1]!.querySelectorAll("[dir=auto]")).toHaveLength(1);
    expect(rows[1]!.querySelector("[data-testid=song-snippet]")).toBeNull();
    expect(rows[2]!.querySelector("[data-testid=song-snippet]")).toBeNull();
    expect(screen.getAllByTestId("song-snippet")).toHaveLength(1);
    expect(screen.getByTestId("song-snippet")).toHaveAttribute("dir", "auto");
  });

  it("renders the snippet as literal text, never HTML", () => {
    render(
      <SongIndex
        variant="results"
        items={items}
        selectedId={undefined}
        onSelect={vi.fn()}
      />,
    );
    const snippet = screen.getByTestId("song-snippet");
    expect(snippet.textContent).toBe("first <b>line</b>");
    expect(snippet.querySelector("b")).toBeNull();
    expect(snippet.children).toHaveLength(0);
  });

  it("calls onSelect with the id", () => {
    const onSelect = vi.fn();
    render(
      <SongIndex
        variant="library"
        items={items}
        selectedId={undefined}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByText("Gamma"));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("c");
  });
});
