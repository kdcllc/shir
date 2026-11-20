import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { STRINGS } from "../strings";
import { i18n } from "../i18n";
import { ConfirmDeleteSetlist } from "./ConfirmDeleteSetlist";

const NAME = "Friday set";

function setup() {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  render(
    <ConfirmDeleteSetlist
      name={NAME}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />,
  );
  return { onCancel, onConfirm };
}

describe("ConfirmDeleteSetlist", () => {
  it("is a labelled, described modal alertdialog that takes focus", () => {
    setup();
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toBe(screen.getByTestId("confirm-delete-setlist"));
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName(
      i18n.t("deleteSetlistTitle", { name: NAME }),
    );
    expect(dialog).toHaveAccessibleDescription(STRINGS.deleteSetlistBody);
    expect(STRINGS.deleteSetlistBody).toMatch(/songs in it are not deleted/);
    expect(dialog).toHaveFocus();
    expect(dialog.parentElement).toHaveAttribute("data-ui-chrome");
  });

  it("names the setlist inside bidi isolates", () => {
    const hebrew = "סט לשבת";
    render(
      <ConfirmDeleteSetlist
        name={hebrew}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading).toHaveAttribute("dir", "auto");
    expect(heading.textContent).toBe(`Delete ⁨${hebrew}⁩?`);
  });

  it("the buttons call their own callback only", () => {
    const { onCancel, onConfirm } = setup();
    const buttons = within(screen.getByRole("alertdialog")).getAllByRole(
      "button",
    );
    expect(buttons.map((b) => b.textContent)).toEqual([
      STRINGS.cancel,
      STRINGS.deleteAction,
    ]);
    fireEvent.click(screen.getByTestId("confirm-delete-setlist-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("confirm-delete-setlist-yes"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("Escape cancels and never confirms", () => {
    const { onCancel, onConfirm } = setup();
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("returns focus to the trigger when it closes", () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const { unmount } = render(
      <ConfirmDeleteSetlist
        name={NAME}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(trigger).not.toHaveFocus();
    unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it("Tab wraps between Cancel and Delete in both directions", () => {
    setup();
    const dialog = screen.getByRole("alertdialog");
    screen.getByTestId("confirm-delete-setlist-yes").focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(screen.getByTestId("confirm-delete-setlist-cancel")).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(screen.getByTestId("confirm-delete-setlist-yes")).toHaveFocus();
  });
});
