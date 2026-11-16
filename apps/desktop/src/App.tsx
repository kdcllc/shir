import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { importText, parseSong, viewSong } from "chord-core";
import type { Diagnostic, SongModel } from "chord-core";
import { SongView } from "chord-render";
import styles from "./App.module.css";
import { ConfirmDiscard } from "./components/ConfirmDiscard";
import { DiagnosticsPanel } from "./components/DiagnosticsPanel";
import { Editor } from "./components/Editor";
import type { ImportSeed } from "./components/Editor";
import { SearchBox } from "./components/SearchBox";
import { SongHeader } from "./components/SongHeader";
import { SongIndex } from "./components/SongIndex";
import type { SongIndexItem } from "./components/SongIndex";
import { SongList } from "./components/SongList";
import { ViewControls } from "./components/ViewControls";
import { pickSongFiles, readTextFile } from "./files";
import { fileNameOf, importSongFiles } from "./importFiles";
import type { FileImportReport, QueuedFile } from "./importFiles";
import { capoOptions, loadLibrary } from "./library";
import { createDebouncedSearch, sortByTitle } from "./songSource";
import type {
  DebouncedSearch,
  SearchState,
  SummaryIndex,
  SummaryList,
} from "./songSource";
import { getSong, listSongs, saveSong, searchSongs } from "./storage";
import type { Song, SongSummary } from "./storage";
import { STRINGS, importQueued, importSummary } from "./strings";
import { signalUiReady } from "./uiReady";

type Mode = "loading" | "db" | "bundled";

interface Current {
  title: string;
  artist?: string | undefined;
  song: SongModel;
  diagnostics: Diagnostic[];
}

interface Session {
  key: number;
  /** Song being edited; absent for a new song. */
  id?: string | undefined;
  text: string;
  baseline: string;
  seed?: ImportSeed | undefined;
  /** Source path of a queued file under review. */
  path?: string | undefined;
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

const noSession = (): Session | undefined => undefined;
const noQueue = (): QueuedFile[] => [];
const noPaths = (): string[] => [];
const noReport = (): FileImportReport | undefined => undefined;
const noMessage = (): string | undefined => undefined;
const noAction = (): (() => void) | undefined => undefined;

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
  const [session, setSession] = useState(noSession);
  const [dirty, setDirty] = useState(false);
  const [queue, setQueue] = useState(noQueue);
  const [skipped, setSkipped] = useState(noPaths);
  const [report, setReport] = useState(noReport);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState(noMessage);
  const [confirming, setConfirming] = useState(noAction);
  const sessionKey = useRef(0);
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

  /** Runs `action` now, or after the user discards a dirty editor. */
  const guard = (action: () => void) => {
    if (session !== undefined && dirty) setConfirming(() => action);
    else action();
  };

  const endSession = () => {
    setSession(undefined);
    setQueue([]);
    setDirty(false);
  };

  /** Leaves the editor without saving; a queued file and the rest of the queue are skipped. */
  const abandon = () => {
    if (session === undefined) return;
    const left = [
      ...(session.path ? [session.path] : []),
      ...queue.map((q) => q.path),
    ];
    if (left.length > 0) setSkipped((prev) => [...prev, ...left]);
    endSession();
  };

  const openQueued = (list: readonly QueuedFile[]) => {
    const [head, ...rest] = list;
    if (head === undefined) {
      endSession();
      return;
    }
    setQueue(rest);
    setSession({
      key: ++sessionKey.current,
      text: head.result.chordpro,
      baseline: "",
      seed: { source: head.source, result: head.result },
      path: head.path,
    });
  };

  const openNew = () =>
    guard(() => {
      abandon();
      setQueue([]);
      setSession({ key: ++sessionKey.current, text: "", baseline: "" });
    });

  const openEdit = () => {
    const id = selectedId;
    if (id === undefined) return;
    guard(() => {
      getSong(id)
        .then((stored) => {
          abandon();
          setQueue([]);
          setNotice(undefined);
          setSession({
            key: ++sessionKey.current,
            id,
            text: stored.chordpro,
            baseline: stored.chordpro,
          });
        })
        .catch(() => setNotice(STRINGS.songLoadFailed));
    });
  };

  const pickDb = (id: string) =>
    guard(() => {
      abandon();
      selectDb(
        id,
        summaries.find((s) => s.id === id) ?? knownHits.current.get(id),
      );
    });

  const refreshList = async (select: Song) => {
    let summary: SongSummary | undefined;
    try {
      const sorted = sortByTitle(await listSongs());
      setSummaries(sorted);
      summary = sorted.find((s) => s.id === select.id);
    } catch {
      setNotice(STRINGS.libraryReloadFailed);
    }
    selectDb(select.id, summary);
  };

  const saveEditor = async (text: string) => {
    const saved = await saveSong(text, session?.id);
    setNotice(undefined);
    await refreshList(saved);
    if (session?.path !== undefined) openQueued(queue);
    else endSession();
  };

  const cancelEditor = () =>
    guard(() => {
      if (session?.path === undefined) {
        abandon();
        return;
      }
      setSkipped((prev) => [...prev, session.path!]);
      openQueued(queue);
    });

  const runImport = () =>
    guard(() => {
      setImporting(true);
      setNotice(undefined);
      importSongFiles({ pickSongFiles, readTextFile, saveSong, importText })
        .then(async (result) => {
          const total =
            result.saved.length + result.queued.length + result.failed.length;
          if (total === 0) return;
          abandon();
          setSkipped([]);
          setReport(result);
          const last = result.saved[result.saved.length - 1];
          if (last !== undefined) await refreshList(last.song);
          if (result.queued.length > 0) openQueued(result.queued);
        })
        .catch((reason: unknown) =>
          setNotice(`${STRINGS.importPickFailed}: ${messageOf(reason)}`),
        )
        .finally(() => setImporting(false));
    });

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
  const editing = showDb && session !== undefined;
  const showLoadFailed = !editing && !showPane && loadFailed;
  const showNoSelection = !editing && !showPane && !loadFailed;

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
            <div className={styles.actions} data-ui-chrome>
              <button type="button" data-testid="new-song" onClick={openNew}>
                {STRINGS.newSong}
              </button>
              <button
                type="button"
                data-testid="open-files"
                disabled={importing}
                onClick={runImport}
              >
                {STRINGS.openFiles}
              </button>
            </div>
            {report !== undefined && (
              <section
                className={styles.report}
                data-testid="import-report"
                data-ui-chrome
              >
                <p role="status" data-testid="import-summary">
                  {importSummary(
                    report.saved.length,
                    report.saved.length +
                      report.queued.length +
                      report.failed.length,
                  )}
                </p>
                {report.queued.length > 0 && (
                  <p role="status" data-testid="import-queued">
                    {importQueued(report.queued.length)}
                  </p>
                )}
                {report.saved.some((f) => f.converted) && (
                  <div data-testid="import-converted">
                    <p>{STRINGS.importConverted}</p>
                    <ul className={styles["report-items"]}>
                      {report.saved
                        .filter((f) => f.converted)
                        .map((f) => (
                          <li key={f.path} dir="auto">
                            {fileNameOf(f.path)}
                          </li>
                        ))}
                    </ul>
                  </div>
                )}
                {skipped.length > 0 && (
                  <div data-testid="import-skipped">
                    <p>{STRINGS.importSkipped}</p>
                    <ul className={styles["report-items"]}>
                      {skipped.map((path, i) => (
                        <li key={i} dir="auto">
                          {fileNameOf(path)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {report.failed.map((f) => (
                  <p key={f.path} role="alert" data-testid="import-failed">
                    <bdi dir="auto">{fileNameOf(f.path)}</bdi>: {f.message}
                  </p>
                ))}
              </section>
            )}
            {notice !== undefined && (
              <p role="alert" data-testid="app-notice" data-ui-chrome>
                {notice}
              </p>
            )}
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
        {editing && session && (
          <Editor
            key={session.key}
            initialText={session.text}
            baseline={session.baseline}
            seed={session.seed}
            titlePath={session.path}
            fileName={
              session.path === undefined ? undefined : fileNameOf(session.path)
            }
            onSave={saveEditor}
            onCancel={cancelEditor}
            onDirtyChange={setDirty}
          />
        )}
        {!editing && entry && song && view && (
          <>
            <div className={styles["header-row"]}>
              <SongHeader
                title={entry.title}
                artist={entry.artist}
                soundingKey={view.soundingKey}
                capo={capo}
              />
              {showDb && (
                <button
                  type="button"
                  data-testid="edit-song"
                  data-ui-chrome
                  onClick={openEdit}
                >
                  {STRINGS.editSong}
                </button>
              )}
            </div>
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
      {confirming !== undefined && (
        <ConfirmDiscard
          onKeep={() => setConfirming(undefined)}
          onDiscard={() => {
            const action = confirming;
            setConfirming(undefined);
            action();
          }}
        />
      )}
    </div>
  );
}
