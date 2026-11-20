import { useId } from "react";
import { useT } from "../i18n";
import styles from "./ConfirmDiscard.module.css";
import { useDialogFocus } from "./useDialogFocus";

export interface ConfirmDeleteSetlistProps {
  /** Name of the setlist to delete. */
  name: string;
  onCancel(): void;
  onConfirm(): void;
}

/** In-app setlist delete confirmation (never `window.confirm`). The songs stay. */
export function ConfirmDeleteSetlist({
  name,
  onCancel,
  onConfirm,
}: ConfirmDeleteSetlistProps) {
  const t = useT();
  const titleId = useId();
  const bodyId = useId();
  const { dialog, first, last, onKeyDown } = useDialogFocus(onCancel);

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
        data-testid="confirm-delete-setlist"
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId} dir="auto" className={styles.title}>
          {t("deleteSetlistTitle", { name })}
        </h2>
        <p id={bodyId} className={styles.body}>
          {t("deleteSetlistBody")}
        </p>
        <div className={styles.actions}>
          <button
            ref={first}
            type="button"
            data-testid="confirm-delete-setlist-cancel"
            onClick={onCancel}
          >
            {t("cancel")}
          </button>
          <button
            ref={last}
            type="button"
            data-testid="confirm-delete-setlist-yes"
            onClick={onConfirm}
          >
            {t("deleteAction")}
          </button>
        </div>
      </div>
    </div>
  );
}
