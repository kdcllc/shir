import type { SongIdSet } from "../deleteSongs";
import { STRINGS, deleteSongNamed, selectSongNamed } from "../strings";
import styles from "./SongIndex.module.css";
import type { DialogFocus } from "./useDialogFocus";

export interface SongIndexItem {
  id: string;
  title: string;
  artist?: string | null | undefined;
  snippet?: string | null | undefined;
}

export interface SongIndexProps {
  items: readonly SongIndexItem[];
  selectedId: string | undefined;
  variant: "library" | "results";
  /** Marks the results list busy (`aria-busy`) while a newer search is pending. */
  busy?: boolean | undefined;
  onSelect(id: string): void;
  /** Adds a delete button to every row (not shown in select mode). */
  onDelete?: ((id: string) => void) | undefined;
  /** Select mode: rows show a checkbox and toggle instead of opening. */
  selecting?: boolean | undefined;
  /** Ids of the selected songs (select mode). */
  selected?: SongIdSet | undefined;
  onToggle?: ((id: string) => void) | undefined;
  /** Disables every row delete button (a delete is running). */
  deleteDisabled?: boolean | undefined;
  /** Position of the row whose main button is attached to `focusRef`. */
  focusIndex?: number | undefined;
  /** Receives the main button of the row at `focusIndex`, so the owner can focus it. */
  focusRef?: DialogFocus["first"] | undefined;
}

export function SongIndex({
  items,
  selectedId,
  variant,
  busy,
  onSelect,
  onDelete,
  selecting = false,
  selected,
  onToggle,
  deleteDisabled = false,
  focusIndex,
  focusRef,
}: SongIndexProps) {
  const results = variant === "results";
  const removable = onDelete !== undefined && !selecting;
  const extras = selecting || removable;
  // One row renderer for both variants. It lives inside this component because
  // scripts/desktop-contract.test.ts (c) scans one JSX region per file.
  const row = (s: SongIndexItem, index: number) => (
    <li key={s.id} className={extras ? styles.row : undefined}>
      {selecting && (
        <input
          type="checkbox"
          className={styles.check}
          data-testid="song-check"
          data-ui-chrome
          aria-label={selectSongNamed(s.title)}
          checked={selected?.has(s.id) ?? false}
          onChange={() => onToggle?.(s.id)}
        />
      )}
      <button
        ref={index === focusIndex ? focusRef : undefined}
        type="button"
        data-testid="song-item"
        className={styles.item}
        aria-current={s.id === selectedId ? "true" : undefined}
        onClick={() => (selecting ? onToggle?.(s.id) : onSelect(s.id))}
      >
        <span dir="auto" className={styles.title}>
          {s.title}
        </span>
        {s.artist != null && s.artist !== "" && (
          <span dir="auto" className={styles.artist}>
            {s.artist}
          </span>
        )}
        {s.snippet != null && (
          <span
            dir="auto"
            className={styles.snippet}
            data-testid="song-snippet"
          >
            {s.snippet}
          </span>
        )}
      </button>
      {removable && (
        <button
          type="button"
          className={styles.remove}
          data-testid="song-delete"
          data-ui-chrome
          aria-label={deleteSongNamed(s.title)}
          disabled={deleteDisabled}
          onClick={() => onDelete(s.id)}
        >
          {STRINGS.removeGlyph}
        </button>
      )}
    </li>
  );
  return (
    <>
      {results && (
        <ul
          className={styles.items}
          data-testid="search-results"
          aria-label={STRINGS.searchResults}
          aria-busy={busy === true ? "true" : undefined}
        >
          {items.map(row)}
        </ul>
      )}
      {!results && (
        <ul className={styles.items} data-testid="song-index">
          {items.map(row)}
        </ul>
      )}
    </>
  );
}
