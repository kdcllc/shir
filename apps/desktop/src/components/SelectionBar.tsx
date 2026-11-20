import { useT } from "../i18n";
import styles from "./SelectionBar.module.css";
import type { DialogFocus } from "./useDialogFocus";

export interface SelectionBarProps {
  selecting: boolean;
  /** Number of selected songs. */
  count: number;
  /** A delete is running. */
  busy: boolean;
  onStart(): void;
  onSelectAll(): void;
  onDelete(): void;
  onAddToSetlist(): void;
  onDone(): void;
  /** Receives the Select button, so the owner can focus it. */
  startRef?: DialogFocus["first"] | undefined;
}

/** Sidebar bar that enters select mode and holds its bulk controls. */
export function SelectionBar({
  selecting,
  count,
  busy,
  onStart,
  onSelectAll,
  onDelete,
  onAddToSetlist,
  onDone,
  startRef,
}: SelectionBarProps) {
  const t = useT();
  return (
    <div className={styles.bar} data-testid="selection-bar" data-ui-chrome>
      {!selecting && (
        <button
          ref={startRef}
          type="button"
          data-testid="select-songs"
          onClick={onStart}
        >
          {t("selectSongs")}
        </button>
      )}
      {selecting && (
        <>
          <p
            role="status"
            className={styles.count}
            data-testid="selection-count"
          >
            {t("selectedCount", { count })}
          </p>
          <button type="button" data-testid="select-all" onClick={onSelectAll}>
            {t("selectAll")}
          </button>
          <button
            type="button"
            data-testid="add-selected-to-setlist"
            data-ui-chrome
            disabled={count === 0}
            onClick={onAddToSetlist}
          >
            {t("addToSetlist")}
          </button>
          <button
            type="button"
            data-testid="delete-selected"
            disabled={count === 0 || busy}
            onClick={onDelete}
          >
            {t("deleteSelected")}
          </button>
          <button type="button" data-testid="select-done" onClick={onDone}>
            {t("selectDone")}
          </button>
        </>
      )}
    </div>
  );
}
