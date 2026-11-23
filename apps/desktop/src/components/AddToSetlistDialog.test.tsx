import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { STRINGS } from "../strings";
import type { SetlistSummary } from "../storage";
import { AddToSetlistDialog } from "./AddToSetlistDialog";

const summary = (id: string, name: string): SetlistSummary => ({
  id,
  name,
  itemCount: 0,
  updatedAt: "2026-01-01T00:00:00Z",
});
const LISTS = [summary("s1", "Friday"), summary("s2", "שבת")];

function setup(over: Partial<Parameters<typeof AddToSetlistDialog>[0]> = {}) {
  const onCancel = vi.fn();
  const onAdd = vi.fn();
  const onCreateAndAdd = vi.fn();
  render(
    <AddToSetlistDialog
      setlists={LISTS}
      songCount={2}
      busy={false}
      onCancel={onCancel}
      onAdd={onAdd}
      onCreateAndAdd={onCreateAndAdd}
      {...over}
    />,
  );
  return { onCancel, onAdd, onCreateAndAdd };
}

const dialog = () => screen.getByRole("dialog");
const confirm = () => screen.getByTestId("add-to-setlist-confirm");
const options = () => screen.getAllByTestId("add-to-setlist-option");
const newOption = () => screen.getByTestId("add-to-setlist-new-option");
const nameInput = () => screen.getByTestId("add-to-setlist-name");

describe("AddToSetlistDialog", () => {
  it("is a labelled modal dialog that takes focus", () => {
    setup();
    expect(dialog()).toBe(screen.getByTestId("add-to-setlist"));
    expect(dialog()).toHaveAttribute("aria-modal", "true");
    expect(dialog()).toHaveAccessibleName("Add 2 songs to a setlist");
    expect(dialog()).toHaveFocus();
    expect(dialog().parentElement).toHaveAttribute("data-ui-chrome");
  });

  it("says how many songs are added (singular and plural)", () => {
    setup({ songCount: 1 });
    expect(dialog()).toHaveAccessibleName("Add 1 song to a setlist");
  });

  it("lists every setlist as a radio, then the New setlist radio", () => {
    setup();
    expect(options()).toHaveLength(2);
    for (const o of options()) expect(o).toHaveAttribute("type", "radio");
    expect(screen.getByText("Friday").tagName).toBe("BDI");
    expect(
      within(newOption().closest("label")!).getByText(STRINGS.newSetlistOption),
    ).toBeInTheDocument();
  });

  it("the confirm button is disabled until a choice is made", () => {
    const { onAdd } = setup();
    expect(confirm()).toBeDisabled();
    fireEvent.click(options()[1]!);
    expect(confirm()).toBeEnabled();
    fireEvent.click(confirm());
    expect(onAdd).toHaveBeenCalledWith("s2");
  });

  it("New setlist needs a non-empty trimmed name of at most 200 characters", () => {
    setup();
    fireEvent.click(newOption());
    expect(confirm()).toBeDisabled();
    fireEvent.change(nameInput(), { target: { value: "   " } });
    expect(confirm()).toBeDisabled();
    fireEvent.change(nameInput(), { target: { value: "ש".repeat(200) } });
    expect(confirm()).toBeEnabled();
    fireEvent.change(nameInput(), { target: { value: "ש".repeat(201) } });
    expect(confirm()).toBeDisabled();
  });

  it("creates and adds with the trimmed name", () => {
    const { onCreateAndAdd, onAdd } = setup();
    fireEvent.click(newOption());
    fireEvent.change(nameInput(), { target: { value: "  Sunday " } });
    fireEvent.click(confirm());
    expect(onCreateAndAdd).toHaveBeenCalledWith("Sunday");
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("typing a name selects the New setlist option", () => {
    setup();
    fireEvent.click(options()[0]!);
    fireEvent.change(nameInput(), { target: { value: "x" } });
    expect(newOption()).toBeChecked();
    expect(options()[0]).not.toBeChecked();
  });

  it("with no setlists the New option is preselected", () => {
    setup({ setlists: [] });
    expect(newOption()).toBeChecked();
    expect(confirm()).toBeDisabled();
  });

  it("submitting without a valid choice calls nothing", () => {
    const { onAdd, onCreateAndAdd } = setup();
    fireEvent.submit(confirm().closest("form")!);
    expect(onAdd).not.toHaveBeenCalled();
    expect(onCreateAndAdd).not.toHaveBeenCalled();
  });

  it("is disabled while busy", () => {
    const { onAdd } = setup({ busy: true });
    fireEvent.click(options()[0]!);
    expect(confirm()).toBeDisabled();
    fireEvent.submit(confirm().closest("form")!);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("Escape and the Cancel button cancel", () => {
    const { onCancel, onAdd } = setup();
    fireEvent.keyDown(dialog(), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("add-to-setlist-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("returns focus to the trigger when it closes", () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const view = render(
      <AddToSetlistDialog
        setlists={LISTS}
        songCount={1}
        busy={false}
        onCancel={vi.fn()}
        onAdd={vi.fn()}
        onCreateAndAdd={vi.fn()}
      />,
    );
    view.unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it("Tab on the last control wraps to the first, Shift+Tab on the first to the last", () => {
    setup();
    fireEvent.click(options()[0]!);
    const controls = [
      ...dialog().querySelectorAll<HTMLElement>("button:not(:disabled), input"),
    ];
    const first = controls[0]!;
    const last = controls[controls.length - 1]!;
    expect(first).toBe(options()[0]);
    expect(last).toBe(confirm());
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
  });

  it("Shift+Tab on the dialog itself wraps to the last control", () => {
    setup();
    fireEvent.click(options()[0]!);
    dialog().focus();
    fireEvent.keyDown(dialog(), { key: "Tab", shiftKey: true });
    expect(confirm()).toHaveFocus();
  });

  it("Shift+Tab from a non-first radio or the New radio wraps to the last control", () => {
    setup();
    fireEvent.click(options()[1]!);
    options()[1]!.focus();
    fireEvent.keyDown(options()[1]!, { key: "Tab", shiftKey: true });
    expect(confirm()).toHaveFocus();
    newOption().focus();
    fireEvent.keyDown(newOption(), { key: "Tab", shiftKey: true });
    expect(confirm()).toHaveFocus();
  });

  it("with Confirm disabled, Tab wraps from Cancel to the first radio and Shift+Tab back", () => {
    setup();
    expect(confirm()).toBeDisabled();
    const cancel = screen.getByTestId("add-to-setlist-cancel");
    cancel.focus();
    fireEvent.keyDown(cancel, { key: "Tab" });
    expect(options()[0]).toHaveFocus();
    fireEvent.keyDown(options()[0]!, { key: "Tab", shiftKey: true });
    expect(cancel).toHaveFocus();
  });

  it("Tab in the middle is left to the browser", () => {
    setup();
    options()[0]!.focus();
    const event = fireEvent.keyDown(options()[0]!, { key: "Tab" });
    expect(event).toBe(true);
    expect(options()[0]).toHaveFocus();
  });
});
