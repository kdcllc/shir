import type { LibrarySong, SongGroup } from "../library";
import { useT } from "../i18n";
import styles from "./SongList.module.css";

export interface SongListProps {
  songs: readonly LibrarySong[];
  selectedId: string | undefined;
  onSelect(id: string): void;
}

export function SongList({ songs, selectedId, onSelect }: SongListProps) {
  const t = useT();
  const GROUPS: readonly { group: SongGroup; label: string }[] = [
    { group: "samples", label: t("groupSamples") },
    { group: "test-songs", label: t("groupTestSongs") },
  ];
  return (
    <nav
      aria-label={t("songList")}
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
