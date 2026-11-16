import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseSong, viewSong } from "chord-core";
import type { Diagnostic, SongModel } from "chord-core";
import { SongView } from "chord-render";
import styles from "./App.module.css";
import { DiagnosticsPanel } from "./components/DiagnosticsPanel";
import { SearchBox } from "./components/SearchBox";
import { SongHeader } from "./components/SongHeader";
import { SongIndex } from "./components/SongIndex";
import type { SongIndexItem } from "./components/SongIndex";
import { SongList } from "./components/SongList";
import { ViewControls } from "./components/ViewControls";
import { capoOptions, loadLibrary } from "./library";
import { createDebouncedSearch, sortByTitle } from "./songSource";
import type {
  DebouncedSearch,
  SearchState,
  SummaryIndex,
  SummaryList,
} from "./songSource";
import { getSong, listSongs, searchSongs } from "./storage";
import type { SongSummary } from "./storage";
import { STRINGS } from "./strings";
import { signalUiReady } from "./uiReady";

type Mode = "loading" | "db" | "bundled";

interface Current {
  title: string;
  artist?: string | undefined;
  song: SongModel;
  diagnostics: Diagnostic[];
}

const loadingMode = (): Mode => "loading";
const noSummaries = (): SongSummary[] => [];
const noId = (): string | undefined => undefined;
const noCurrent = (): Current | undefined => undefined;
const idle = (): SearchState => ({ status: "idle" });
const noList = (): SummaryList | undefined => undefined;
const noSearch = (): DebouncedSearch | undefined => undefined;
const newIndex = (): SummaryIndex => new Map();

function toItem(s: SongSummary): SongIndexItem {
  return { id: s.id, title: s.title, artist: s.artist };
}

export function App() {
  const bundled = useMemo(() => loadLibrary(), []);
  const [mode, setMode] = useState(loadingMode);
  const [summaries, setSummaries] = useState(noSummaries);
  const [selectedId, setSelectedId] = useState(noId);
  const [dbCurrent, setDbCurrent] = useState(noCurrent);
  const [loadFailed, setLoadFailed] = useState(false);
  const [transpose, setTranspose] = useState(0);
  const [capo, setCapo] = useState(0);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState(idle);
  const request = useRef(0);
  const listing = useRef(noList());
  const debounced = useRef(noSearch());
  const knownHits = useRef(newIndex());

  const selectDb = useCallback((id: string, summary?: SongSummary) => {
    const token = ++request.current;
    setSelectedId(id);
    setLoadFailed(false);
    setTranspose(0);
    getSong(id)
      .then((stored) => {
        if (token !== request.current) return;
        const { song, diagnostics } = parseSong(stored.chordpro);
        setDbCurrent({
          title: summary?.title ?? song.title?.trim() ?? "",
          artist: summary?.artist ?? undefined,
          song,
          diagnostics,
        });
        setCapo(song.capo ?? 0);
      })
      .catch(() => {
        if (token !== request.current) return;
        setDbCurrent(undefined);
        setLoadFailed(true);
      });
  }, []);

  const pickDb = (id: string) =>
    selectDb(
      id,
      summaries.find((s) => s.id === id) ?? knownHits.current.get(id),
    );

  useEffect(() => {
    void signalUiReady();
  }, []);

  useEffect(() => {
    let cancelled = false;
    listing.current ??= listSongs();
    listing.current.then(
      (list) => {
        if (cancelled) return;
        const sorted = sortByTitle(list);
        setSummaries(sorted);
        setMode("db");
        const demoTitle = bundled[0]?.title;
        const first = sorted.find((s) => s.title === demoTitle) ?? sorted[0];
        if (first) selectDb(first.id, first);
      },
      () => {
        if (cancelled) return;
        setMode("bundled");
        setSelectedId(bundled[0]?.id);
        setCapo(bundled[0]?.song.capo ?? 0);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [bundled, selectDb]);

  useEffect(() => {
    if (mode !== "db") return undefined;
    const d = createDebouncedSearch(searchSongs, (s) => {
      if (s.status === "done") {
        for (const h of s.hits) knownHits.current.set(h.song.id, h.song);
      }
      setSearch((prev) =>
        s.status === "loading" && prev.status === "done" ? prev : s,
      );
    });
    debounced.current = d;
    return () => {
      d.cancel();
      debounced.current = undefined;
    };
  }, [mode]);

  const onQuery = (next: string) => {
    setQuery(next);
    debounced.current?.setQuery(next);
  };

  const bundledEntry =
    mode === "bundled" ? bundled.find((s) => s.id === selectedId) : undefined;
  const entry: Current | undefined = bundledEntry ?? dbCurrent;
  const song = entry?.song;

  const view = useMemo(
    () => (song ? viewSong(song, { transpose, capo }) : undefined),
    [song, transpose, capo],
  );

  const selectBundled = (id: string) => {
    setSelectedId(id);
    setTranspose(0);
    setCapo(bundled.find((s) => s.id === id)?.song.capo ?? 0);
  };

  const reset = () => {
    setTranspose(0);
    setCapo(song?.capo ?? 0);
  };

  const trimmed = query.trim();
  const settled =
    (search.status === "done" || search.status === "error") &&
    search.query === trimmed;
  const pending = trimmed !== "" && !settled;

  const hitItems: SongIndexItem[] =
    search.status === "done"
      ? search.hits.map((h) => ({ ...toItem(h.song), snippet: h.snippet }))
      : [];

  const showLoading = mode === "loading";
  const showBundled = mode === "bundled";
  const showDb = mode === "db";
  const showError = showDb && search.status === "error";
  const showEmpty = showDb && search.status === "done" && hitItems.length === 0;
  const showHits = showDb && search.status === "done" && !showEmpty;
  const showLibrary =
    showDb && search.status !== "error" && search.status !== "done";
  const showNoSongs = showLibrary && summaries.length === 0;
  const showSongs = showLibrary && !showNoSongs;
  const showPane =
    entry !== undefined && song !== undefined && view !== undefined;
  const showLoadFailed = !showPane && loadFailed;
  const showNoSelection = !showPane && !loadFailed;

  return (
    <div className={styles.root}>
      <div className={styles.sidebar}>
        <h1 className={styles.heading} data-ui-chrome>
          {STRINGS.appName} {STRINGS.separator}{" "}
          <bdi lang="he">{STRINGS.appNameHebrew}</bdi>
        </h1>
        {showLoading && <p data-ui-chrome>{STRINGS.loadingLibrary}</p>}
        {showBundled && (
          <>
            <SearchBox value="" disabled onChange={() => undefined} />
            <p
              className={styles.notice}
              data-testid="search-unavailable"
              data-ui-chrome
            >
              {STRINGS.searchUnavailable}
            </p>
            <SongList
              songs={bundled}
              selectedId={selectedId}
              onSelect={selectBundled}
            />
          </>
        )}
        {showDb && (
          <>
            <SearchBox value={query} onChange={onQuery} />
            <p
              role="status"
              className={styles.status}
              data-testid="search-pending"
              data-ui-chrome
            >
              {pending ? STRINGS.searching : ""}
            </p>
            <nav
              aria-label={STRINGS.songList}
              data-testid="song-list"
              data-ui-chrome
              className={styles.library}
            >
              {showError && <p role="alert">{STRINGS.searchFailed}</p>}
              {showEmpty && (
                <p data-testid="search-empty">{STRINGS.noResults}</p>
              )}
              {showHits && (
                <SongIndex
                  variant="results"
                  busy={pending}
                  items={hitItems}
                  selectedId={selectedId}
                  onSelect={pickDb}
                />
              )}
              {showNoSongs && <p>{STRINGS.libraryEmpty}</p>}
              {showSongs && (
                <SongIndex
                  variant="library"
                  items={summaries.map(toItem)}
                  selectedId={selectedId}
                  onSelect={pickDb}
                />
              )}
            </nav>
          </>
        )}
      </div>
      <main data-testid="song-pane" className={styles.pane}>
        {entry && song && view && (
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
        )}
        {showLoadFailed && <p role="alert">{STRINGS.songLoadFailed}</p>}
        {showNoSelection && <p>{STRINGS.noSongSelected}</p>}
      </main>
    </div>
  );
}
