import { useEffect, useMemo, useState } from "react";
import { viewSong } from "chord-core";
import { SongView } from "chord-render";
import styles from "./App.module.css";
import { DiagnosticsPanel } from "./components/DiagnosticsPanel";
import { SongHeader } from "./components/SongHeader";
import { SongList } from "./components/SongList";
import { ViewControls } from "./components/ViewControls";
import { capoOptions, loadLibrary } from "./library";
import { STRINGS } from "./strings";
import { signalUiReady } from "./uiReady";

export function App() {
  const songs = useMemo(() => loadLibrary(), []);
  const [selectedId, setSelectedId] = useState<string | undefined>(
    songs[0]?.id,
  );
  const [transpose, setTranspose] = useState(0);
  const [capo, setCapo] = useState(songs[0]?.song.capo ?? 0);

  useEffect(() => {
    void signalUiReady();
  }, []);

  const entry = useMemo(
    () => songs.find((s) => s.id === selectedId),
    [songs, selectedId],
  );
  const song = entry?.song;

  const view = useMemo(
    () => (song ? viewSong(song, { transpose, capo }) : undefined),
    [song, transpose, capo],
  );

  const select = (id: string) => {
    setSelectedId(id);
    setTranspose(0);
    setCapo(songs.find((s) => s.id === id)?.song.capo ?? 0);
  };

  const reset = () => {
    setTranspose(0);
    setCapo(song?.capo ?? 0);
  };

  return (
    <div className={styles.root}>
      <div className={styles.sidebar}>
        <h1 className={styles.heading}>
          {STRINGS.appName} · <bdi lang="he">{STRINGS.appNameHebrew}</bdi>
        </h1>
        <SongList songs={songs} selectedId={selectedId} onSelect={select} />
      </div>
      <main data-testid="song-pane" className={styles.pane}>
        {entry && song && view ? (
          <>
            <SongHeader
              title={entry.title}
              artist={entry.artist}
              soundingKey={view.soundingKey}
              capo={capo}
            />
            <ViewControls
              transpose={transpose}
              capo={capo}
              capoOptions={capoOptions(song.capo)}
              shapeKey={view.shapeKey}
              onTranspose={setTranspose}
              onCapo={setCapo}
              onReset={reset}
            />
            <DiagnosticsPanel
              diagnostics={[...entry.diagnostics, ...view.diagnostics]}
            />
            <SongView song={view.song} />
          </>
        ) : (
          <p>{STRINGS.noSongSelected}</p>
        )}
      </main>
    </div>
  );
}
