import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { deleteSongNamed, selectSongNamed, STRINGS } from "../strings";
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

  it("marks only the results list aria-busy when busy", () => {
    const { rerender } = render(
      <SongIndex
        variant="results"
        items={items}
        selectedId={undefined}
        busy
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByTestId("search-results")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    rerender(
      <SongIndex
        variant="results"
        items={items}
        selectedId={undefined}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByTestId("search-results")).not.toHaveAttribute(
      "aria-busy",
    );
    rerender(
      <SongIndex
        variant="library"
        items={items}
        selectedId={undefined}
        busy
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByTestId("song-index")).not.toHaveAttribute("aria-busy");
  });
});

describe("SongIndex row delete", () => {
  const VARIANTS = ["library", "results"] as const;

  it("renders no delete button, checkbox or row class without the new props", () => {
    render(
      <SongIndex
        variant="library"
        items={items}
        selectedId={undefined}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("song-delete")).toBeNull();
    expect(screen.queryByTestId("song-check")).toBeNull();
    for (const li of screen.getByTestId("song-index").children) {
      expect(li.children).toHaveLength(1);
      expect(li).not.toHaveAttribute("class");
    }
  });

  it.each(VARIANTS)(
    "%s: each row has a delete button after the row button, never inside it",
    (variant) => {
      render(
        <SongIndex
          variant={variant}
          items={items}
          selectedId="b"
          onSelect={vi.fn()}
          onDelete={vi.fn()}
        />,
      );
      const rows = screen.getAllByTestId("song-item");
      const removes = screen.getAllByTestId("song-delete");
      expect(removes).toHaveLength(3);
      removes.forEach((remove, i) => {
        expect(remove.tagName).toBe("BUTTON");
        expect(remove).toHaveAttribute("type", "button");
        expect(remove).toHaveAttribute("data-ui-chrome");
        expect(remove.textContent).toBe(STRINGS.removeGlyph);
        expect(remove.parentElement?.tagName).toBe("LI");
        expect(remove.previousElementSibling).toBe(rows[i]);
        expect(rows[i]).not.toContainElement(remove);
        expect(remove).toBeEnabled();
      });
      expect(rows[1]).toHaveAttribute("aria-current", "true");
      expect(screen.queryByTestId("song-check")).toBeNull();
    },
  );

  it.each(VARIANTS)(
    "%s: clicking delete calls onDelete with the id and not onSelect",
    (variant) => {
      const onSelect = vi.fn();
      const onDelete = vi.fn();
      render(
        <SongIndex
          variant={variant}
          items={items}
          selectedId={undefined}
          onSelect={onSelect}
          onDelete={onDelete}
        />,
      );
      fireEvent.click(screen.getAllByTestId("song-delete")[2]!);
      expect(onDelete).toHaveBeenCalledExactlyOnceWith("c");
      expect(onSelect).not.toHaveBeenCalled();
      fireEvent.click(screen.getAllByTestId("song-item")[2]!);
      expect(onSelect).toHaveBeenCalledExactlyOnceWith("c");
      expect(onDelete).toHaveBeenCalledTimes(1);
    },
  );

  it("labels each delete button with the bidi-isolated title, Hebrew included", () => {
    render(
      <SongIndex
        variant="library"
        items={items}
        selectedId={undefined}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    const removes = screen.getAllByTestId("song-delete");
    expect(removes[0]).toHaveAttribute("aria-label", deleteSongNamed("Alpha"));
    expect(removes[1]).toHaveAttribute("aria-label", deleteSongNamed("שיר"));
    expect(removes[1]!.getAttribute("aria-label")).toBe(
      "Delete \u2068שיר\u2069",
    );
  });

  it("deleteDisabled disables every delete button and blocks onDelete", () => {
    const onDelete = vi.fn();
    render(
      <SongIndex
        variant="library"
        items={items}
        selectedId={undefined}
        onSelect={vi.fn()}
        onDelete={onDelete}
        deleteDisabled
      />,
    );
    const removes = screen.getAllByTestId("song-delete");
    expect(removes).toHaveLength(3);
    for (const remove of removes) {
      expect(remove).toBeDisabled();
      fireEvent.click(remove);
    }
    expect(onDelete).not.toHaveBeenCalled();
    for (const row of screen.getAllByTestId("song-item"))
      expect(row).toBeEnabled();
  });
});

describe("SongIndex select mode", () => {
  const VARIANTS = ["library", "results"] as const;

  function renderSelecting(
    variant: "library" | "results",
    selected: ReadonlySet<string> | undefined,
  ) {
    const handlers = {
      onSelect: vi.fn(),
      onDelete: vi.fn(),
      onToggle: vi.fn(),
    };
    render(
      <SongIndex
        variant={variant}
        items={items}
        selectedId="a"
        selecting
        selected={selected}
        {...handlers}
      />,
    );
    return handlers;
  }

  it.each(VARIANTS)(
    "%s: each row has a checkbox before the row button and no delete button",
    (variant) => {
      renderSelecting(variant, new Set(["b"]));
      const rows = screen.getAllByTestId("song-item");
      const checks = screen.getAllByTestId("song-check");
      expect(checks).toHaveLength(3);
      checks.forEach((check, i) => {
        expect(check.tagName).toBe("INPUT");
        expect(check).toHaveAttribute("type", "checkbox");
        expect(check).toHaveAttribute("data-ui-chrome");
        expect(check.parentElement?.tagName).toBe("LI");
        expect(check.nextElementSibling).toBe(rows[i]);
      });
      expect(screen.queryByTestId("song-delete")).toBeNull();
      expect(rows[0]).toHaveAttribute("aria-current", "true");
    },
  );

  it("checks exactly the rows whose id is selected", () => {
    renderSelecting("library", new Set(["a", "c"]));
    const checks = screen.getAllByTestId("song-check");
    expect(checks[0]).toBeChecked();
    expect(checks[1]).not.toBeChecked();
    expect(checks[2]).toBeChecked();
  });

  it("checks nothing when selected is absent", () => {
    renderSelecting("library", undefined);
    for (const check of screen.getAllByTestId("song-check"))
      expect(check).not.toBeChecked();
  });

  it("labels each checkbox with the bidi-isolated title, Hebrew included", () => {
    renderSelecting("results", new Set());
    const checks = screen.getAllByTestId("song-check");
    expect(checks[0]).toHaveAttribute("aria-label", selectSongNamed("Alpha"));
    expect(checks[1]!.getAttribute("aria-label")).toBe(
      "Select \u2068שיר\u2069",
    );
  });

  it.each(VARIANTS)(
    "%s: the checkbox and the row both call onToggle, never onSelect",
    (variant) => {
      const { onSelect, onDelete, onToggle } = renderSelecting(
        variant,
        new Set(),
      );
      fireEvent.click(screen.getAllByTestId("song-check")[1]!);
      expect(onToggle).toHaveBeenCalledExactlyOnceWith("b");
      fireEvent.click(screen.getAllByTestId("song-item")[2]!);
      expect(onToggle).toHaveBeenCalledTimes(2);
      expect(onToggle).toHaveBeenLastCalledWith("c");
      expect(onSelect).not.toHaveBeenCalled();
      expect(onDelete).not.toHaveBeenCalled();
    },
  );
});

describe("SongIndex focus target", () => {
  const VARIANTS = ["library", "results"] as const;

  it.each(VARIANTS)(
    "%s: focusRef receives the main button of the row at focusIndex",
    (variant) => {
      const focusRef = createRef<HTMLButtonElement>();
      const { rerender } = render(
        <SongIndex
          variant={variant}
          items={items}
          selectedId={undefined}
          onSelect={vi.fn()}
          onDelete={vi.fn()}
          focusIndex={1}
          focusRef={focusRef}
        />,
      );
      expect(focusRef.current).toBe(screen.getAllByTestId("song-item")[1]);
      expect(document.activeElement).toBe(document.body);
      rerender(
        <SongIndex
          variant={variant}
          items={items}
          selectedId={undefined}
          onSelect={vi.fn()}
          onDelete={vi.fn()}
          focusIndex={2}
          focusRef={focusRef}
        />,
      );
      expect(focusRef.current).toBe(screen.getAllByTestId("song-item")[2]);
    },
  );

  it("attaches focusRef to no row without focusIndex or past the last row", () => {
    const focusRef = createRef<HTMLButtonElement>();
    const { rerender } = render(
      <SongIndex
        variant="library"
        items={items}
        selectedId={undefined}
        onSelect={vi.fn()}
        focusRef={focusRef}
      />,
    );
    expect(focusRef.current).toBeNull();
    rerender(
      <SongIndex
        variant="library"
        items={items}
        selectedId={undefined}
        onSelect={vi.fn()}
        focusIndex={3}
        focusRef={focusRef}
      />,
    );
    expect(focusRef.current).toBeNull();
  });
});
