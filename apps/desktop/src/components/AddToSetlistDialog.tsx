import { useId, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { useT } from "../i18n";
import { MAX_SETLIST_NAME_CHARS, setlistNameLength } from "../setlists";
import type { SetlistSummary } from "../storage";
import styles from "./ConfirmDiscard.module.css";
import listStyles from "./AddToSetlistDialog.module.css";
import { useDialogFocus } from "./useDialogFocus";

export interface AddToSetlistDialogProps {
  setlists: readonly SetlistSummary[];
  /** Number of songs that will be added. */
  songCount: number;
  busy: boolean;
  onCancel(): void;
  onAdd(setlistId: string): void;
  onCreateAndAdd(name: string): void;
}

const NEW = "new";
const FOCUSABLE = "button:not(:disabled), input:not(:disabled)";

/** Modal that adds the chosen songs to an existing setlist or to a new one. */
export function AddToSetlistDialog({
  setlists,
  songCount,
  busy,
  onCancel,
  onAdd,
  onCreateAndAdd,
}: AddToSetlistDialogProps) {
  const t = useT();
  const titleId = useId();
  const groupName = useId();
  const [choice, setChoice] = useState<string | null>(
    setlists.length === 0 ? NEW : null,
  );
  const [name, setName] = useState("");
  const { dialog, onKeyDown } = useDialogFocus(onCancel);

  const trimmed = name.trim();
  const nameLength = setlistNameLength(name);
  const valid =
    choice === NEW
      ? nameLength !== 0 && nameLength <= MAX_SETLIST_NAME_CHARS
      : choice !== null && setlists.some((s) => s.id === choice);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    if (choice === NEW) onCreateAndAdd(trimmed);
    else if (choice !== null) onAdd(choice);
  };

  // Tab cycles over every enabled control of the dialog, not only the two action buttons.
  const onDialogKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") {
      onKeyDown(e);
      return;
    }
    const controls = [
      ...e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE),
    ];
    const first = controls[0];
    const last = controls[controls.length - 1];
    const active = document.activeElement;
    const onRadio =
      active instanceof HTMLInputElement && active.type === "radio";
    if (
      e.shiftKey &&
      (active === first || active === e.currentTarget || onRadio)
    ) {
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
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={styles.dialog}
        data-testid="add-to-setlist"
        onKeyDown={onDialogKeyDown}
      >
        <h2 id={titleId} className={styles.title}>
          {t("addToSetlistTitle", { count: songCount })}
        </h2>
        <form onSubmit={submit}>
          <fieldset className={listStyles.options}>
            <legend className={listStyles.label}>{t("setlistChoice")}</legend>
            {setlists.map((s) => (
              <label key={s.id} className={listStyles.option}>
                <input
                  type="radio"
                  name={groupName}
                  checked={choice === s.id}
                  data-testid="add-to-setlist-option"
                  onChange={() => setChoice(s.id)}
                />
                <bdi>{s.name}</bdi>
              </label>
            ))}
            <label className={listStyles.option}>
              <input
                type="radio"
                name={groupName}
                checked={choice === NEW}
                data-testid="add-to-setlist-new-option"
                onChange={() => setChoice(NEW)}
              />
              {t("newSetlistOption")}
            </label>
            <input
              type="text"
              dir="auto"
              value={name}
              aria-label={t("setlistNameLabel")}
              className={listStyles.input}
              data-testid="add-to-setlist-name"
              onChange={(e) => {
                setName(e.target.value);
                setChoice(NEW);
              }}
            />
          </fieldset>
          <div className={styles.actions}>
            <button
              type="button"
              data-testid="add-to-setlist-cancel"
              onClick={onCancel}
            >
              {t("cancel")}
            </button>
            <button
              type="submit"
              disabled={!valid || busy}
              data-testid="add-to-setlist-confirm"
            >
              {t("add")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
