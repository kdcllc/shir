import type { ExportDocument } from "chord-core";
import { SongView } from "chord-render";
import styles from "./PrintDocument.module.css";
import { SongFacts } from "./SongFacts";
import type { ExportLabels, ExportMeta } from "./types";

interface PrintDocumentProps {
  doc: ExportDocument;
  cover: boolean;
  labels: ExportLabels;
  meta: ExportMeta;
}

/**
 * The print-only layout of an export document. The caller mounts it off-screen (see the CSS module);
 * chord-render's `SongView` renders every song body, so chords stay above lyrics (B4) in print.
 */
export function PrintDocument({
  doc,
  cover,
  labels,
  meta,
}: PrintDocumentProps) {
  return (
    <div data-print-root="" dir={meta.dir} lang={meta.lang}>
      {cover && (
        <section data-print-cover="">
          <h1 className={styles.title}>
            <bdi>{doc.title}</bdi>
          </h1>
          <p className={styles.date}>
            {labels.date} <bdi>{meta.dateText}</bdi>
          </p>
          <h2 className={styles.heading}>{labels.songs}</h2>
          <ol className={styles.list}>
            {doc.songs.map((song, i) => (
              <li key={i} data-print-cover-item="">
                <bdi>{song.title}</bdi>
                {song.artist !== undefined && (
                  <>
                    {" "}
                    <bdi>{song.artist}</bdi>
                  </>
                )}{" "}
                <SongFacts song={song} labels={labels} />
              </li>
            ))}
          </ol>
        </section>
      )}
      {doc.songs.map((song, i) => (
        <section key={i} data-print-song="">
          <header data-print-header="" className={styles.header}>
            <h2 className={styles.name}>
              <bdi>{song.title}</bdi>
            </h2>
            <p className={styles.facts}>
              {song.artist !== undefined && <bdi>{song.artist}</bdi>}{" "}
              <SongFacts song={song} labels={labels} />
            </p>
          </header>
          <SongView song={song.model} />
        </section>
      ))}
    </div>
  );
}
