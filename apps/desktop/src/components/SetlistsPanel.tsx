import { useId, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { useT } from "../i18n";
import { MAX_SETLIST_NAME_CHARS, setlistNameLength } from "../setlists";
import type { SetlistSummary } from "../storage";
import { ConfirmDeleteSetlist } from "./ConfirmDeleteSetlist";
import styles from "./SetlistsPanel.module.css";

export interface SetlistsPanelProps {
  setlists: readonly SetlistSummary[];
  selectedId: string | null;
  /** A storage call is running: actions are disabled. */
  busy: boolean;
  onSelect(id: string): void;
  onCreate(name: string): Promise<boolean>;
  onRename(id: string, name: string): Promise<boolean>;
  onDuplicate(id: string): void;
  onDelete(id: string): void;
}

const validName = (name: string): boolean => {
  const length = setlistNameLength(name);
  return length !== 0 && length <= MAX_SETLIST_NAME_CHARS;
};

/** Sidebar list of setlists with create, select, rename, duplicate and delete. */
export function SetlistsPanel({
  setlists,
  selectedId,
  busy,
  onSelect,
  onCreate,
  onRename,
  onDuplicate,
  onDelete,
}: SetlistsPanelProps) {
  const t = useT();
  const nameId = useId();
  const [draft, setDraft] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [deleting, setDeleting] = useState<SetlistSummary | null>(null);

  /** Keeps the typed name until the parent reports success; a rejection counts as failure. */
  const settle = (call: Promise<boolean>, onOk: () => void) =>
    call.then(
      (ok) => {
        if (ok) onOk();
      },
      () => undefined,
    );

  const submitCreate = (e: FormEvent) => {
    e.preventDefault();
    if (busy || !validName(draft)) return;
    const submitted = draft;
    // The updater sees the latest draft: one edited while the call ran is kept.
    void settle(onCreate(submitted.trim()), () =>
      setDraft((cur) => (cur === submitted ? "" : cur)),
    );
  };

  const onRenameKey = (e: KeyboardEvent<HTMLInputElement>, current: string) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setRenaming(null);
    } else if (e.key === "Enter" && renaming) {
      e.preventDefault();
      if (!validName(renaming.name)) return;
      const next = renaming.name.trim();
      if (next === current) {
        setRenaming(null);
        return;
      }
      if (busy) return;
      const { id, name: typed } = renaming;
      void settle(onRename(id, next), () =>
        setRenaming((cur) =>
          cur?.id === id && cur.name === typed ? null : cur,
        ),
      );
    }
  };

  return (
    <div className={styles.panel} data-testid="setlists-panel" data-ui-chrome>
      <form className={styles.create} onSubmit={submitCreate}>
        <label htmlFor={nameId} className={styles.label}>
          {t("setlistNameLabel")}
        </label>
        <div className={styles.field}>
          <input
            id={nameId}
            type="text"
            dir="auto"
            value={draft}
            className={styles.input}
            data-testid="setlist-name-input"
            onChange={(e) => setDraft(e.target.value)}
          />
          <button
            type="submit"
            data-testid="setlist-create"
            disabled={busy || !validName(draft)}
          >
            {t("createSetlist")}
          </button>
        </div>
      </form>
      {setlists.length === 0 ? (
        <p className={styles.empty} data-testid="setlists-empty">
          {t("setlistsEmpty")}
        </p>
      ) : (
        <ul className={styles.list} aria-label={t("tabSetlists")}>
          {setlists.map((s) => (
            <li
              key={s.id}
              className={styles.row}
              data-testid="setlist-row"
              data-ui-chrome
            >
              {renaming?.id === s.id ? (
                <input
                  type="text"
                  dir="auto"
                  autoFocus
                  value={renaming.name}
                  aria-label={t("setlistNameLabel")}
                  aria-invalid={!validName(renaming.name)}
                  className={styles.input}
                  data-testid="setlist-rename-input"
                  onChange={(e) =>
                    setRenaming({ id: s.id, name: e.target.value })
                  }
                  onKeyDown={(e) => onRenameKey(e, s.name)}
                  onBlur={() => setRenaming(null)}
                />
              ) : (
                <button
                  type="button"
                  className={styles.select}
                  aria-current={s.id === selectedId ? "true" : undefined}
                  data-testid="setlist-select"
                  onClick={() => onSelect(s.id)}
                >
                  <bdi className={styles.name}>{s.name}</bdi>
                  <span className={styles.count}>
                    {t("setlistItemCount", { count: s.itemCount })}
                  </span>
                </button>
              )}
              <div className={styles.actions}>
                <button
                  type="button"
                  disabled={busy}
                  data-testid="setlist-rename"
                  onClick={() => setRenaming({ id: s.id, name: s.name })}
                >
                  {t("renameSetlist")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  data-testid="setlist-duplicate"
                  onClick={() => onDuplicate(s.id)}
                >
                  {t("duplicateSetlist")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  data-testid="setlist-delete"
                  onClick={() => setDeleting(s)}
                >
                  {t("deleteAction")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {deleting && (
        <ConfirmDeleteSetlist
          name={deleting.name}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const id = deleting.id;
            setDeleting(null);
            onDelete(id);
          }}
        />
      )}
    </div>
  );
}
