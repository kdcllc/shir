import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { STRINGS } from "../strings";
import { i18n } from "../i18n";
import { ConfirmDelete } from "./ConfirmDelete";

const deleteConfirmTitle = (title: string) =>
  i18n.t("deleteConfirmTitle", { title });
const deleteManyTitle = (count: number) => i18n.t("deleteManyTitle", { count });

const TITLE = deleteConfirmTitle("Alpha");

describe("ConfirmDelete", () => {
  it("is a labelled, described modal alertdialog that takes focus", () => {
    render(
      <ConfirmDelete title={TITLE} onCancel={vi.fn()} onConfirm={vi.fn()} />,
    );
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toBe(screen.getByTestId("confirm-delete"));
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName(TITLE);
    expect(dialog).toHaveAccessibleDescription(STRINGS.deleteConfirmBody);
    expect(dialog).toHaveFocus();
    expect(dialog.parentElement).toHaveAttribute("data-ui-chrome");
  });

  it("isolates a Hebrew title: dir=auto heading with the U+2068…U+2069 wrapped text", () => {
    const title = deleteConfirmTitle("שיר לשבת");
    expect(title).toBe("Delete \u2068שיר לשבת\u2069?");
    render(
      <ConfirmDelete title={title} onCancel={vi.fn()} onConfirm={vi.fn()} />,
    );
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading).toHaveAttribute("dir", "auto");
    expect(heading.textContent).toBe(title);
  });

  it("shows a count title as given", () => {
    render(
      <ConfirmDelete
        title={deleteManyTitle(3)}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      "Delete 3 songs?",
    );
  });

  it("orders the buttons Cancel first, then Delete", () => {
    render(
      <ConfirmDelete title={TITLE} onCancel={vi.fn()} onConfirm={vi.fn()} />,
    );
    const buttons = within(screen.getByRole("alertdialog")).getAllByRole(
      "button",
    );
    expect(buttons.map((b) => b.getAttribute("data-testid"))).toEqual([
      "confirm-delete-cancel",
      "confirm-delete-yes",
    ]);
    expect(buttons.map((b) => b.textContent)).toEqual([
      STRINGS.cancel,
      STRINGS.deleteAction,
    ]);
    for (const b of buttons) expect(b).toHaveAttribute("type", "button");
  });

  it("the buttons call their own callback only", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ConfirmDelete title={TITLE} onCancel={onCancel} onConfirm={onConfirm} />,
    );
    fireEvent.click(screen.getByTestId("confirm-delete-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("confirm-delete-yes"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("Escape cancels and never confirms", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ConfirmDelete title={TITLE} onCancel={onCancel} onConfirm={onConfirm} />,
    );
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("returns focus to the trigger when it closes", () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const { unmount } = render(
      <ConfirmDelete title={TITLE} onCancel={vi.fn()} onConfirm={vi.fn()} />,
    );
    expect(trigger).not.toHaveFocus();
    unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it("Tab wraps between Cancel and Delete in both directions", () => {
    render(
      <ConfirmDelete title={TITLE} onCancel={vi.fn()} onConfirm={vi.fn()} />,
    );
    const dialog = screen.getByRole("alertdialog");
    screen.getByTestId("confirm-delete-yes").focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(screen.getByTestId("confirm-delete-cancel")).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(screen.getByTestId("confirm-delete-yes")).toHaveFocus();
  });
});
