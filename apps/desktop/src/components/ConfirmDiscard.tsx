import { useId } from "react";
import { useT } from "../i18n";
import styles from "./ConfirmDiscard.module.css";
import { useDialogFocus } from "./useDialogFocus";

export interface ConfirmDiscardProps {
  onKeep(): void;
  onDiscard(): void;
}

/** In-app unsaved-changes confirmation (never `window.confirm`). */
export function ConfirmDiscard({ onKeep, onDiscard }: ConfirmDiscardProps) {
  const t = useT();
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
          {t("discardTitle")}
        </h2>
        <p id={bodyId} className={styles.body}>
          {t("discardBody")}
        </p>
        <div className={styles.actions}>
          <button
            ref={keep}
            type="button"
            data-testid="confirm-keep"
            onClick={onKeep}
          >
            {t("keepEditing")}
          </button>
          <button
            ref={discard}
            type="button"
            data-testid="confirm-discard-yes"
            onClick={onDiscard}
          >
            {t("discard")}
          </button>
        </div>
      </div>
    </div>
  );
}
