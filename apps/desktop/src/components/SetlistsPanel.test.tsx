import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { STRINGS } from "../strings";
import type { SetlistSummary } from "../storage";
import { SetlistsPanel } from "./SetlistsPanel";

const summary = (id: string, name: string, itemCount = 0): SetlistSummary => ({
  id,
  name,
  itemCount,
  updatedAt: "2026-01-01T00:00:00Z",
});

const LISTS = [summary("s1", "Friday", 1), summary("s2", "שבת בבוקר", 3)];

function setup(over: Partial<Parameters<typeof SetlistsPanel>[0]> = {}) {
  const handlers = {
    onSelect: vi.fn(),
    onCreate: vi.fn(() => Promise.resolve(true)),
    onRename: vi.fn(() => Promise.resolve(true)),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
  };
  const props = {
    setlists: LISTS,
    selectedId: null,
    busy: false,
    ...handlers,
    ...over,
  };
  const view = render(<SetlistsPanel {...props} />);
  return {
    ...handlers,
    rerender: (next: typeof props) =>
      view.rerender(<SetlistsPanel {...next} />),
    props,
  };
}

const rows = () => screen.getAllByTestId("setlist-row");
const input = () => screen.getByTestId("setlist-name-input");
const create = () => screen.getByTestId("setlist-create");
const type = (value: string) =>
  fireEvent.change(input(), { target: { value } });
const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

describe("SetlistsPanel list", () => {
  it("shows each name in a bdi and the plural item count", () => {
    setup();
    expect(rows()).toHaveLength(2);
    const first = within(rows()[0]!);
    expect(first.getByText("Friday").tagName).toBe("BDI");
    expect(first.getByText("1 song")).toBeInTheDocument();
    const second = within(rows()[1]!);
    expect(second.getByText("שבת בבוקר").tagName).toBe("BDI");
    expect(second.getByText("3 songs")).toBeInTheDocument();
  });

  it("shows the empty state and no list when there are no setlists", () => {
    setup({ setlists: [] });
    expect(screen.getByTestId("setlists-empty")).toHaveTextContent(
      STRINGS.setlistsEmpty,
    );
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("marks the selected setlist and selects on click", () => {
    const { onSelect } = setup({ selectedId: "s2" });
    const buttons = screen.getAllByTestId("setlist-select");
    expect(buttons[0]).not.toHaveAttribute("aria-current");
    expect(buttons[1]).toHaveAttribute("aria-current", "true");
    fireEvent.click(buttons[0]!);
    expect(onSelect).toHaveBeenCalledWith("s1");
  });

  it("keys rows by setlist id (DOM nodes follow their setlist when the order changes)", () => {
    const { rerender, props } = setup();
    const [a, b] = rows();
    rerender({ ...props, setlists: [LISTS[1]!, LISTS[0]!] });
    const after = rows();
    expect(after[0]).toBe(b);
    expect(after[1]).toBe(a);
  });

  it("every control carries data-ui-chrome", () => {
    setup();
    for (const el of [...screen.getAllByRole("button"), input()])
      expect(el.closest("[data-ui-chrome]"), el.outerHTML).not.toBeNull();
  });
});

describe("SetlistsPanel create", () => {
  it("is disabled while the trimmed name is empty", () => {
    setup();
    expect(create()).toBeDisabled();
    type("   ");
    expect(create()).toBeDisabled();
    type(" x ");
    expect(create()).toBeEnabled();
  });

  it("accepts exactly 200 characters and rejects 201", () => {
    setup();
    type("ש".repeat(200));
    expect(create()).toBeEnabled();
    type("ש".repeat(201));
    expect(create()).toBeDisabled();
  });

  it("counts characters, not UTF-16 units", () => {
    setup();
    type("😀".repeat(150));
    expect(create()).toBeEnabled();
    type("😀".repeat(201));
    expect(create()).toBeDisabled();
  });

  it("is disabled while busy", () => {
    setup({ busy: true });
    type("x");
    expect(create()).toBeDisabled();
  });

  it("creates with the trimmed name and clears the field", async () => {
    const { onCreate } = setup();
    type("  Sunday  ");
    fireEvent.click(create());
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledWith("Sunday");
    await flush();
    expect(input()).toHaveValue("");
  });

  it("keeps the draft when the create resolves false", async () => {
    const { onCreate } = setup();
    onCreate.mockResolvedValue(false);
    type("Evening set");
    fireEvent.click(create());
    await flush();
    expect(onCreate).toHaveBeenCalledWith("Evening set");
    expect(input()).toHaveValue("Evening set");
    expect(create()).toBeEnabled();
  });

  it("keeps the draft when the create rejects and raises no unhandled rejection", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const { onCreate } = setup();
      onCreate.mockRejectedValue(new Error("storage down"));
      type("Evening set");
      fireEvent.click(create());
      await flush();
      expect(input()).toHaveValue("Evening set");
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("clears the draft when the create resolves true", async () => {
    setup();
    type("Evening set");
    fireEvent.click(create());
    await flush();
    expect(input()).toHaveValue("");
  });

  it("keeps a draft edited while the create is pending", async () => {
    const { onCreate } = setup();
    let settle: (ok: boolean) => void = () => undefined;
    onCreate.mockReturnValue(
      new Promise<boolean>((resolve) => {
        settle = resolve;
      }),
    );
    type("Evening set");
    fireEvent.click(create());
    type("Morning set");
    settle(true);
    await flush();
    expect(input()).toHaveValue("Morning set");
  });

  it("submitting an invalid name (Enter) creates nothing", () => {
    const { onCreate } = setup();
    type("   ");
    fireEvent.submit(input().closest("form")!);
    expect(onCreate).not.toHaveBeenCalled();
  });
});

describe("SetlistsPanel rename", () => {
  const startRename = (row = 0) =>
    fireEvent.click(within(rows()[row]!).getByTestId("setlist-rename"));
  const renameInput = () => screen.getByTestId("setlist-rename-input");

  it("opens an input with the current name", () => {
    setup();
    startRename();
    expect(renameInput()).toHaveValue("Friday");
    expect(within(rows()[0]!).queryByTestId("setlist-select")).toBeNull();
  });

  it("Enter commits the trimmed new name", async () => {
    const { onRename } = setup();
    startRename();
    fireEvent.change(renameInput(), { target: { value: "  Saturday " } });
    fireEvent.keyDown(renameInput(), { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("s1", "Saturday");
    await flush();
    expect(screen.queryByTestId("setlist-rename-input")).toBeNull();
  });

  it("keeps the rename input open with the typed value when the rename resolves false", async () => {
    const { onRename } = setup();
    onRename.mockResolvedValue(false);
    startRename();
    fireEvent.change(renameInput(), { target: { value: "Morning set" } });
    fireEvent.keyDown(renameInput(), { key: "Enter" });
    await flush();
    expect(onRename).toHaveBeenCalledWith("s1", "Morning set");
    expect(renameInput()).toHaveValue("Morning set");
  });

  it("closes the rename input when the rename resolves true", async () => {
    setup();
    startRename();
    fireEvent.change(renameInput(), { target: { value: "Morning set" } });
    fireEvent.keyDown(renameInput(), { key: "Enter" });
    expect(renameInput()).toHaveValue("Morning set");
    await flush();
    expect(screen.queryByTestId("setlist-rename-input")).toBeNull();
  });

  it("Enter in the rename input while busy makes no call", () => {
    const { onRename, rerender, props } = setup();
    startRename();
    fireEvent.change(renameInput(), { target: { value: "Morning set" } });
    rerender({ ...props, busy: true });
    fireEvent.keyDown(renameInput(), { key: "Enter" });
    expect(onRename).not.toHaveBeenCalled();
    expect(renameInput()).toHaveValue("Morning set");
  });

  it("Escape cancels without a call", () => {
    const { onRename } = setup();
    startRename();
    fireEvent.change(renameInput(), { target: { value: "Other" } });
    fireEvent.keyDown(renameInput(), { key: "Escape" });
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.queryByTestId("setlist-rename-input")).toBeNull();
    expect(within(rows()[0]!).getByText("Friday")).toBeInTheDocument();
  });

  it("an empty name is rejected: no call and the input stays open", () => {
    const { onRename } = setup();
    startRename();
    fireEvent.change(renameInput(), { target: { value: "   " } });
    fireEvent.keyDown(renameInput(), { key: "Enter" });
    expect(onRename).not.toHaveBeenCalled();
    expect(renameInput()).toHaveAttribute("aria-invalid", "true");
  });

  it("a name over 200 characters is rejected", () => {
    const { onRename } = setup();
    startRename();
    fireEvent.change(renameInput(), { target: { value: "x".repeat(201) } });
    fireEvent.keyDown(renameInput(), { key: "Enter" });
    expect(onRename).not.toHaveBeenCalled();
  });

  it("an unchanged name closes the input without a call", () => {
    const { onRename } = setup();
    startRename();
    fireEvent.keyDown(renameInput(), { key: "Enter" });
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.queryByTestId("setlist-rename-input")).toBeNull();
  });
});

describe("SetlistsPanel duplicate and delete", () => {
  it("Duplicate calls onDuplicate with the row's id", () => {
    const { onDuplicate } = setup();
    fireEvent.click(within(rows()[1]!).getByTestId("setlist-duplicate"));
    expect(onDuplicate).toHaveBeenCalledWith("s2");
  });

  it("Delete opens the confirmation and calls nothing yet", () => {
    const { onDelete } = setup();
    fireEvent.click(within(rows()[0]!).getByTestId("setlist-delete"));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("Cancel and Escape close the confirmation without deleting", () => {
    const { onDelete } = setup();
    fireEvent.click(within(rows()[0]!).getByTestId("setlist-delete"));
    fireEvent.click(screen.getByTestId("confirm-delete-setlist-cancel"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    fireEvent.click(within(rows()[0]!).getByTestId("setlist-delete"));
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("only the confirm button deletes, with the id of the chosen row", () => {
    const { onDelete } = setup();
    fireEvent.click(within(rows()[1]!).getByTestId("setlist-delete"));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("שבת בבוקר");
    fireEvent.click(screen.getByTestId("confirm-delete-setlist-yes"));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith("s2");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("row actions are disabled while busy", () => {
    setup({ busy: true });
    for (const id of ["setlist-rename", "setlist-duplicate", "setlist-delete"])
      for (const b of screen.getAllByTestId(id)) expect(b).toBeDisabled();
  });
});
