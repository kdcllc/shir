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
  onSelect(id: string): void;
}

export function SongIndex({
  items,
  selectedId,
  variant,
  onSelect,
}: SongIndexProps) {
  const results = variant === "results";
  return (
    <>
      {results && (
        <ul
          className={styles.items}
          data-testid="search-results"
          aria-label={STRINGS.searchResults}
        >
          {items.map((s) => (
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
          ))}
        </ul>
      )}
      {!results && (
        <ul className={styles.items} data-testid="song-index">
          {items.map((s) => (
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
          ))}
        </ul>
      )}
    </>
  );
}
