import { firstStrongDirection } from "chord-core";
import { useT } from "../i18n";
import styles from "./SongHeader.module.css";

export interface SongHeaderProps {
  title: string;
  artist?: string;
  soundingKey?: string;
  capo: number;
}

export function SongHeader({
  title,
  artist,
  soundingKey,
  capo,
}: SongHeaderProps) {
  const t = useT();
  return (
    <header
      data-testid="song-header"
      dir={firstStrongDirection(title) ?? undefined}
      className={styles.header}
    >
      <h2 dir="auto" data-testid="song-title" className={styles.title}>
        {title}
      </h2>
      {artist !== undefined && (
        <p dir="auto" data-testid="song-artist" className={styles.artist}>
          {artist}
        </p>
      )}
      <p dir="ltr" className={styles.meta}>
        <span className={styles.label}>{t("key")}</span>{" "}
        <span data-testid="sounding-key">
          {soundingKey !== undefined ? (
            <bdi dir="ltr">{soundingKey}</bdi>
          ) : (
            t("noKey")
          )}
        </span>
        {capo > 0 && (
          <>
            {" "}
            <span className={styles.label}>{t("capo")}</span>{" "}
            <bdi dir="ltr" data-testid="capo-value">
              {capo}
            </bdi>
          </>
        )}
      </p>
    </header>
  );
}
