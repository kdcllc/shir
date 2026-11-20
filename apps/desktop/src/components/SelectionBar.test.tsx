import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { STRINGS } from "../strings";
import { i18n } from "../i18n";
import { SelectionBar } from "./SelectionBar";
import type { SelectionBarProps } from "./SelectionBar";

const selectedCount = (count: number) => i18n.t("selectedCount", { count });

function setup(overrides: Partial<SelectionBarProps> = {}) {
  const props: SelectionBarProps = {
    selecting: false,
    count: 0,
    busy: false,
    onStart: vi.fn(),
    onSelectAll: vi.fn(),
    onDelete: vi.fn(),
    onAddToSetlist: vi.fn(),
    onDone: vi.fn(),
    ...overrides,
  };
  render(<SelectionBar {...props} />);
  return props;
}

const ids = () =>
  [...screen.getByTestId("selection-bar").children].map((el) =>
    el.getAttribute("data-testid"),
  );

describe("SelectionBar", () => {
  it("is a UI-chrome div holding only Select when not selecting", () => {
    const props = setup();
    const bar = screen.getByTestId("selection-bar");
    expect(bar.tagName).toBe("DIV");
    expect(bar).toHaveAttribute("data-ui-chrome");
    expect(ids()).toEqual(["select-songs"]);
    const start = screen.getByTestId("select-songs");
    expect(start.textContent).toBe(STRINGS.selectSongs);
    expect(start).toHaveAttribute("type", "button");
    fireEvent.click(start);
    expect(props.onStart).toHaveBeenCalledTimes(1);
  });

  it("shows count, Select all, Delete selected and Done when selecting", () => {
    setup({ selecting: true, count: 2 });
    expect(ids()).toEqual([
      "selection-count",
      "select-all",
      "add-selected-to-setlist",
      "delete-selected",
      "select-done",
    ]);
    const count = screen.getByTestId("selection-count");
    expect(count.tagName).toBe("P");
    expect(count).toHaveAttribute("role", "status");
    expect(count.textContent).toBe(selectedCount(2));
    expect(count.textContent).toBe("2 selected");
    expect(screen.getByTestId("select-all").textContent).toBe(
      STRINGS.selectAll,
    );
    expect(screen.getByTestId("delete-selected").textContent).toBe(
      STRINGS.deleteSelected,
    );
    expect(screen.getByTestId("add-selected-to-setlist").textContent).toBe(
      STRINGS.addToSetlist,
    );
    expect(screen.getByTestId("select-done").textContent).toBe(
      STRINGS.selectDone,
    );
    expect(screen.queryByTestId("select-songs")).toBeNull();
  });

  it("each button calls its own callback only", () => {
    const props = setup({ selecting: true, count: 1 });
    fireEvent.click(screen.getByTestId("select-all"));
    expect(props.onSelectAll).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("delete-selected"));
    expect(props.onDelete).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("select-done"));
    expect(props.onDone).toHaveBeenCalledTimes(1);
    expect(props.onSelectAll).toHaveBeenCalledTimes(1);
    expect(props.onDelete).toHaveBeenCalledTimes(1);
    expect(props.onStart).not.toHaveBeenCalled();
  });

  it("disables Delete selected at count 0 and enables it at count 1", () => {
    const props = setup({ selecting: true, count: 0 });
    expect(screen.getByTestId("delete-selected")).toBeDisabled();
    fireEvent.click(screen.getByTestId("delete-selected"));
    expect(props.onDelete).not.toHaveBeenCalled();
    expect(screen.getByTestId("select-all")).toBeEnabled();
    expect(screen.getByTestId("select-done")).toBeEnabled();
  });

  it("enables Delete selected with one song selected", () => {
    setup({ selecting: true, count: 1 });
    expect(screen.getByTestId("delete-selected")).toBeEnabled();
  });

  it("disables Delete selected while busy even with a selection", () => {
    setup({ selecting: true, count: 3, busy: true });
    expect(screen.getByTestId("delete-selected")).toBeDisabled();
  });

  it("Add to setlist is disabled at count 0 and calls its callback otherwise", () => {
    const props = setup({ selecting: true, count: 0 });
    const add = screen.getByTestId("add-selected-to-setlist");
    expect(add).toBeDisabled();
    fireEvent.click(add);
    expect(props.onAddToSetlist).not.toHaveBeenCalled();
  });

  it("Add to setlist calls only its callback with a selection", () => {
    const props = setup({ selecting: true, count: 2 });
    const add = screen.getByTestId("add-selected-to-setlist");
    expect(add).toBeEnabled();
    expect(add).toHaveAttribute("data-ui-chrome");
    fireEvent.click(add);
    expect(props.onAddToSetlist).toHaveBeenCalledTimes(1);
    expect(props.onDelete).not.toHaveBeenCalled();
  });

  it("startRef receives the Select button", () => {
    const startRef = createRef<HTMLButtonElement>();
    setup({ startRef });
    expect(startRef.current).toBe(screen.getByTestId("select-songs"));
  });

  it("startRef stays empty in select mode", () => {
    const startRef = createRef<HTMLButtonElement>();
    setup({ selecting: true, startRef });
    expect(startRef.current).toBeNull();
  });
});
