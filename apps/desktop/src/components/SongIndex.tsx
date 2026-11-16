import { STRINGS } from "../strings";
import styles from "./SongIndex.module.css";

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
}

export function SongIndex({
  items,
  selectedId,
  variant,
  busy,
  onSelect,
}: SongIndexProps) {
  const results = variant === "results";
  // One row renderer for both variants. It lives inside this component because
  // scripts/desktop-contract.test.ts (c) scans one JSX region per file.
  const row = (s: SongIndexItem) => (
    <li key={s.id}>
      <button
        type="button"
        data-testid="song-item"
        className={styles.item}
        aria-current={s.id === selectedId ? "true" : undefined}
        onClick={() => onSelect(s.id)}
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
