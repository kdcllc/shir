import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { STRINGS } from "../strings";
import { ConfirmDiscard } from "./ConfirmDiscard";

describe("ConfirmDiscard", () => {
  it("is a labelled, described modal alertdialog that takes focus", () => {
    render(<ConfirmDiscard onKeep={vi.fn()} onDiscard={vi.fn()} />);
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName(STRINGS.discardTitle);
    expect(dialog).toHaveAccessibleDescription(STRINGS.discardBody);
    expect(dialog).toHaveFocus();
  });

  it("Escape keeps editing", () => {
    const onKeep = vi.fn();
    const onDiscard = vi.fn();
    render(<ConfirmDiscard onKeep={onKeep} onDiscard={onDiscard} />);
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(onKeep).toHaveBeenCalledTimes(1);
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it("the buttons call their own callback only", () => {
    const onKeep = vi.fn();
    const onDiscard = vi.fn();
    render(<ConfirmDiscard onKeep={onKeep} onDiscard={onDiscard} />);
    fireEvent.click(screen.getByText(STRINGS.keepEditing));
    expect(onKeep).toHaveBeenCalledTimes(1);
    expect(onDiscard).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText(STRINGS.discard));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onKeep).toHaveBeenCalledTimes(1);
  });

  it("returns focus to the trigger when it closes", () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const { unmount } = render(
      <ConfirmDiscard onKeep={vi.fn()} onDiscard={vi.fn()} />,
    );
    expect(trigger).not.toHaveFocus();
    unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it("Tab wraps between the two buttons", () => {
    render(<ConfirmDiscard onKeep={vi.fn()} onDiscard={vi.fn()} />);
    const dialog = screen.getByRole("alertdialog");
    screen.getByText(STRINGS.discard).focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(screen.getByText(STRINGS.keepEditing)).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(screen.getByText(STRINGS.discard)).toHaveFocus();
  });
});
