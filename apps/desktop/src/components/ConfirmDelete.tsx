import { useId } from "react";
import { useT } from "../i18n";
import styles from "./ConfirmDiscard.module.css";
import { useDialogFocus } from "./useDialogFocus";

export interface ConfirmDeleteProps {
  /** Dialog heading: names the song or the number of songs. */
  title: string;
  onCancel(): void;
  onConfirm(): void;
}

/** In-app delete confirmation (never `window.confirm`). Deletion is permanent. */
export function ConfirmDelete({
  title,
  onCancel,
  onConfirm,
}: ConfirmDeleteProps) {
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
        data-testid="confirm-delete"
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId} dir="auto" className={styles.title}>
          {title}
        </h2>
        <p id={bodyId} className={styles.body}>
          {t("deleteConfirmBody")}
        </p>
        <div className={styles.actions}>
          <button
            ref={first}
            type="button"
            data-testid="confirm-delete-cancel"
            onClick={onCancel}
          >
            {t("cancel")}
          </button>
          <button
            ref={last}
            type="button"
            data-testid="confirm-delete-yes"
            onClick={onConfirm}
          >
            {t("deleteAction")}
          </button>
        </div>
      </div>
    </div>
  );
}
