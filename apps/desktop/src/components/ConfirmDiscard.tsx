import { useEffect, useId, useRef } from "react";
import type { KeyboardEvent } from "react";
import { STRINGS } from "../strings";
import styles from "./ConfirmDiscard.module.css";

const noDiv = (): HTMLDivElement | null => null;
const noButton = (): HTMLButtonElement | null => null;

export interface ConfirmDiscardProps {
  onKeep(): void;
  onDiscard(): void;
}

/** In-app unsaved-changes confirmation (never `window.confirm`). */
export function ConfirmDiscard({ onKeep, onDiscard }: ConfirmDiscardProps) {
  const titleId = useId();
  const bodyId = useId();
  const dialog = useRef(noDiv());
  const keep = useRef(noButton());
  const discard = useRef(noButton());

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
      onKeep();
      return;
    }
    if (e.key !== "Tab") return;
    const first = keep.current;
    const last = discard.current;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === dialog.current)) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first?.focus();
    }
  };

  return (
    <div className={styles.backdrop} data-ui-chrome>
      <div
        ref={dialog}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        className={styles.dialog}
        data-testid="confirm-discard"
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId} className={styles.title}>
          {STRINGS.discardTitle}
        </h2>
        <p id={bodyId} className={styles.body}>
          {STRINGS.discardBody}
        </p>
        <div className={styles.actions}>
          <button
            ref={keep}
            type="button"
            data-testid="confirm-keep"
            onClick={onKeep}
          >
            {STRINGS.keepEditing}
          </button>
          <button
            ref={discard}
            type="button"
            data-testid="confirm-discard-yes"
            onClick={onDiscard}
          >
            {STRINGS.discard}
          </button>
        </div>
      </div>
    </div>
  );
}
