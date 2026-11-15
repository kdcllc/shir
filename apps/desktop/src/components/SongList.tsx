import type { LibrarySong, SongGroup } from "../library";
import { STRINGS } from "../strings";
import styles from "./SongList.module.css";

export interface SongListProps {
  songs: readonly LibrarySong[];
  selectedId: string | undefined;
  onSelect(id: string): void;
}

const GROUPS: readonly { group: SongGroup; label: string }[] = [
  { group: "samples", label: STRINGS.groupSamples },
  { group: "test-songs", label: STRINGS.groupTestSongs },
];

export function SongList({ songs, selectedId, onSelect }: SongListProps) {
  return (
    <nav
      aria-label={STRINGS.songList}
      data-testid="song-list"
      data-ui-chrome
      className={styles.list}
    >
      {GROUPS.map(({ group, label }) => {
        const inGroup = songs.filter((s) => s.group === group);
        if (inGroup.length === 0) return null;
        return (
          <section key={group} className={styles.group}>
            <h3 className={styles.heading}>{label}</h3>
            <ul className={styles.items}>
              {inGroup.map((s) => (
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
                    {s.artist !== undefined && (
                      <span dir="auto" className={styles.artist}>
                        {s.artist}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </nav>
  );
}
