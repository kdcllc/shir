import { useEffect, useRef } from "react";
import type { KeyboardEvent, RefObject } from "react";

const noDiv = (): HTMLDivElement | null => null;
const noButton = (): HTMLButtonElement | null => null;

export interface DialogFocus {
  /** The dialog element (`tabIndex={-1}`); it takes focus on mount. */
  dialog: RefObject<HTMLDivElement | null>;
  /** The first action button. */
  first: RefObject<HTMLButtonElement | null>;
  /** The last action button. */
  last: RefObject<HTMLButtonElement | null>;
  onKeyDown(e: KeyboardEvent<HTMLDivElement>): void;
}

/**
 * Focus handling of an in-app modal dialog: focus moves into the dialog on
 * mount and back to the previously focused element on unmount, `Escape` calls
 * `onCancel`, and `Tab` / `Shift+Tab` cycle between the first and last buttons.
 */
export function useDialogFocus(onCancel: () => void): DialogFocus {
  const dialog = useRef(noDiv());
  const first = useRef(noButton());
  const last = useRef(noButton());

  useEffect(() => {
    const trigger = document.activeElement;
    dialog.current?.focus();
    return () => {
      if (trigger instanceof HTMLElement) trigger.focus();
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
      return;
    }
    if (e.key !== "Tab") return;
    const active = document.activeElement;
    if (e.shiftKey && (active === first.current || active === dialog.current)) {
      e.preventDefault();
      last.current?.focus();
    } else if (!e.shiftKey && active === last.current) {
      e.preventDefault();
      first.current?.focus();
    }
  };

  return { dialog, first, last, onKeyDown };
}
