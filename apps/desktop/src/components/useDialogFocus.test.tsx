import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDialogFocus } from "./useDialogFocus";

function Harness({ onCancel }: { onCancel(): void }) {
  const { dialog, first, last, onKeyDown } = useDialogFocus(onCancel);
  return (
    <div ref={dialog} tabIndex={-1} data-testid="dialog" onKeyDown={onKeyDown}>
      <button ref={first} type="button">
        first
      </button>
      <button type="button">middle</button>
      <button ref={last} type="button">
        last
      </button>
    </div>
  );
}

describe("useDialogFocus", () => {
  it("focuses the dialog element on mount", () => {
    render(<Harness onCancel={vi.fn()} />);
    expect(screen.getByTestId("dialog")).toHaveFocus();
  });

  it("returns focus to the previously focused element on unmount", () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const { unmount } = render(<Harness onCancel={vi.fn()} />);
    expect(trigger).not.toHaveFocus();
    unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it("Escape calls onCancel once and prevents the default", () => {
    const onCancel = vi.fn();
    render(<Harness onCancel={onCancel} />);
    const notPrevented = fireEvent.keyDown(screen.getByTestId("dialog"), {
      key: "Escape",
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(notPrevented).toBe(false);
  });

  it("Escape calls the latest onCancel after a re-render", () => {
    const stale = vi.fn();
    const fresh = vi.fn();
    const { rerender } = render(<Harness onCancel={stale} />);
    rerender(<Harness onCancel={fresh} />);
    fireEvent.keyDown(screen.getByTestId("dialog"), { key: "Escape" });
    expect(fresh).toHaveBeenCalledTimes(1);
    expect(stale).not.toHaveBeenCalled();
  });

  it("Tab on the last button wraps to the first", () => {
    render(<Harness onCancel={vi.fn()} />);
    screen.getByText("last").focus();
    const notPrevented = fireEvent.keyDown(screen.getByTestId("dialog"), {
      key: "Tab",
    });
    expect(screen.getByText("first")).toHaveFocus();
    expect(notPrevented).toBe(false);
  });

  it("Shift+Tab on the first button wraps to the last", () => {
    render(<Harness onCancel={vi.fn()} />);
    screen.getByText("first").focus();
    const notPrevented = fireEvent.keyDown(screen.getByTestId("dialog"), {
      key: "Tab",
      shiftKey: true,
    });
    expect(screen.getByText("last")).toHaveFocus();
    expect(notPrevented).toBe(false);
  });

  it("Shift+Tab while the dialog itself is focused goes to the last button", () => {
    render(<Harness onCancel={vi.fn()} />);
    const dialog = screen.getByTestId("dialog");
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(screen.getByText("last")).toHaveFocus();
  });

  it("leaves Tab alone inside the cycle and ignores other keys", () => {
    const onCancel = vi.fn();
    render(<Harness onCancel={onCancel} />);
    const dialog = screen.getByTestId("dialog");
    screen.getByText("middle").focus();
    expect(fireEvent.keyDown(dialog, { key: "Tab" })).toBe(true);
    expect(fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true })).toBe(
      true,
    );
    expect(screen.getByText("middle")).toHaveFocus();
    screen.getByText("first").focus();
    expect(fireEvent.keyDown(dialog, { key: "Tab" })).toBe(true);
    expect(screen.getByText("first")).toHaveFocus();
    expect(fireEvent.keyDown(dialog, { key: "Enter" })).toBe(true);
    expect(onCancel).not.toHaveBeenCalled();
  });
});
