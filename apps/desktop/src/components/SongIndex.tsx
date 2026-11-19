import type { SongIdSet } from "../deleteSongs";
import { useT } from "../i18n";
import type { Language } from "../storage";
import styles from "./SongIndex.module.css";
import type { DialogFocus } from "./useDialogFocus";

export interface SongIndexItem {
  id: string;
  title: string;
  artist?: string | null | undefined;
  songKey?: string | null | undefined;
  language?: Language | undefined;
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
  const t = useT();
  const results = variant === "results";
  const badge = (l: Language): string =>
    l === "he"
      ? t("badgeHebrew")
      : l === "en"
        ? t("badgeEnglish")
        : t("badgeMixed");
  const badgeName = (l: Language): string =>
    l === "he"
      ? t("filterHebrew")
      : l === "en"
        ? t("filterEnglish")
        : t("filterMixed");
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
          aria-label={t("selectSongNamed", { title: s.title })}
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
        {s.songKey != null && s.songKey !== "" && (
          <span dir="ltr" className={styles.key} data-testid="song-row-key">
            {s.songKey}
          </span>
        )}
        {s.language !== undefined && (
          <span
            className={styles.badge}
            data-testid="song-language"
            title={badgeName(s.language)}
            aria-label={badgeName(s.language)}
          >
            {badge(s.language)}
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
          aria-label={t("deleteSongNamed", { title: s.title })}
          disabled={deleteDisabled}
          onClick={() => onDelete(s.id)}
        >
          {t("removeGlyph")}
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
          aria-label={t("searchResults")}
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
