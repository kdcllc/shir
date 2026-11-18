import { useId } from "react";
import { STRINGS } from "../strings";
import styles from "./ConfirmDiscard.module.css";
import { useDialogFocus } from "./useDialogFocus";

export interface ConfirmDiscardProps {
  onKeep(): void;
  onDiscard(): void;
}

/** In-app unsaved-changes confirmation (never `window.confirm`). */
export function ConfirmDiscard({ onKeep, onDiscard }: ConfirmDiscardProps) {
  const titleId = useId();
  const bodyId = useId();
  const {
    dialog,
    first: keep,
    last: discard,
    onKeyDown,
  } = useDialogFocus(onKeep);

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
