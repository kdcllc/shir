import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { importText, parseSong, viewSong } from "chord-core";
import type { Diagnostic, SongModel } from "chord-core";
import { SongView } from "chord-render";
import styles from "./App.module.css";
import { ConfirmDelete } from "./components/ConfirmDelete";
import { ConfirmDiscard } from "./components/ConfirmDiscard";
import { DiagnosticsPanel } from "./components/DiagnosticsPanel";
import { Editor } from "./components/Editor";
import type { ImportSeed } from "./components/Editor";
import { LibraryControls } from "./components/LibraryControls";
import { SearchBox } from "./components/SearchBox";
import { SelectionBar } from "./components/SelectionBar";
import { SongHeader } from "./components/SongHeader";
import { SongIndex } from "./components/SongIndex";
import type { SongIndexItem } from "./components/SongIndex";
import { SongList } from "./components/SongList";
import { ViewControls } from "./components/ViewControls";
import { deleteMany } from "./deleteSongs";
import type { SongIdSet } from "./deleteSongs";
import { pickSongFiles, readTextFile } from "./files";
import { fileNameOf, importSongFiles } from "./importFiles";
import type { FileImportReport, QueuedFile } from "./importFiles";
import { useT } from "./i18n";
import { capoOptions, loadLibrary } from "./library";
import {
  filterHits,
  filterSummaries,
  readLibraryPrefs,
  sortSummaries,
  storeLibraryPrefs,
} from "./libraryView";
import type { LibraryPrefs } from "./libraryView";
import { createDebouncedSearch, sortByTitle } from "./songSource";
import type {
  DebouncedSearch,
  SearchState,
  SummaryIndex,
  SummaryList,
} from "./songSource";
import {
  deleteSong,
  getSong,
  listSongs,
  saveSong,
  searchSongs,
} from "./storage";
import type { Song, SongSummary } from "./storage";
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

/** A translatable message kept as data so it follows a live language switch. */
interface Msg {
  key:
    | "songLoadFailed"
    | "libraryReloadFailed"
    | "importPickFailed"
    | "deleteFailed"
    | "deleteManyFailed"
    | "deleteConfirmTitle"
    | "deleteManyTitle"
    | "deletedCount";
  vars?: { title?: string; count?: number; failed?: number };
  /** Raw error text appended after a colon. */
  detail?: string;
}

/** A delete waiting for the user's confirmation. */
interface DeleteRequest {
  ids: string[];
  /** Dialog heading. */
  title: Msg;
  /** Started from select mode. */
  bulk: boolean;
  /** Position of the list row whose delete button started it; absent otherwise. */
  row?: number | undefined;
}

/** Where focus goes once a row delete has finished. */
interface Refocus {
  /** The song the delete was asked for (still listed when the delete failed). */
  id: string;
  /** Position its row had in the list. */
  row: number;
}

/** Latest committed values, read by a delete run after its awaits. */
interface Live {
  selectedId: string | undefined;
  session: Session | undefined;
  summaries: SongSummary[];
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

const noSession = (): Session | undefined => undefined;
const noQueue = (): QueuedFile[] => [];
const noPaths = (): string[] => [];
const noReport = (): FileImportReport | undefined => undefined;
const noMessage = (): Msg | undefined => undefined;
const noAction = (): (() => void) | undefined => undefined;
const noDelete = (): DeleteRequest | undefined => undefined;
const noSelection = (): SongIdSet => new Set();
const noRefocus = (): Refocus | undefined => undefined;
const noButton = (): HTMLButtonElement | null => null;
const noLive = (): Live => ({
  selectedId: undefined,
  session: undefined,
  summaries: [],
});

const loadingMode = (): Mode => "loading";
const noSummaries = (): SongSummary[] => [];
const noId = (): string | undefined => undefined;
const noCurrent = (): Current | undefined => undefined;
const idle = (): SearchState => ({ status: "idle" });
const noList = (): SummaryList | undefined => undefined;
const noSearch = (): DebouncedSearch | undefined => undefined;
const newIndex = (): SummaryIndex => new Map();

function toItem(s: SongSummary): SongIndexItem {
  return {
    id: s.id,
    title: s.title,
    artist: s.artist,
    songKey: s.key,
    language: s.language,
  };
}

export function App() {
  const t = useT();
  const say = (m: Msg): string => {
    const text = (t as unknown as (k: string, v?: object) => string)(
      m.key,
      m.vars,
    );
    return m.detail === undefined ? text : `${text}: ${m.detail}`;
  };
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
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState(noSelection);
  const [deleting, setDeleting] = useState(noDelete);
  const [removing, setRemoving] = useState(false);
  const [deleteStatus, setDeleteStatus] = useState(noMessage);
  const [refocus, setRefocus] = useState(noRefocus);
  const [prefs, setPrefsState] = useState(() =>
    readLibraryPrefs(window.localStorage),
  );
  const live = useRef(noLive());
  const sessionKey = useRef(0);
  const request = useRef(0);
  const listing = useRef(noList());
  const debounced = useRef(noSearch());
  const knownHits = useRef(newIndex());
  /** Ids deleted in this session; a late search response never shows them. */
  const removed = useRef(noSelection());
  const rowTarget = useRef(noButton());
  const startTarget = useRef(noButton());

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
        .catch(() => setNotice({ key: "songLoadFailed" }));
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

  const setPrefs = (next: LibraryPrefs) => {
    setPrefsState(next);
    storeLibraryPrefs(window.localStorage, next);
  };

  const refreshList = async (select: Song) => {
    let summary: SongSummary | undefined;
    try {
      const fresh = await listSongs();
      setSummaries(fresh);
      summary = fresh.find((s) => s.id === select.id);
    } catch {
      setNotice({ key: "libraryReloadFailed" });
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
          setNotice({ key: "importPickFailed", detail: messageOf(reason) }),
        )
        .finally(() => setImporting(false));
    });

  /** The library as listed: chosen order, language filter applied. */
  const shown = useMemo(
    () => filterSummaries(sortSummaries(summaries, prefs.sort), prefs.language),
    [summaries, prefs],
  );

  useEffect(() => {
    live.current = { selectedId, session, summaries: shown };
  });

  const titleOf = (id: string): string =>
    summaries.find((s) => s.id === id)?.title ??
    knownHits.current.get(id)?.title ??
    (id === selectedId ? dbCurrent?.title : undefined) ??
    "";

  /** Opens the delete confirmation; nothing is deleted before the user confirms. */
  const askDelete = (ids: string[], bulk: boolean, row?: number) => {
    const [only] = ids;
    if (only === undefined || removing) return;
    setDeleteStatus(undefined);
    setDeleting({
      ids,
      bulk,
      row,
      title:
        ids.length === 1
          ? { key: "deleteConfirmTitle", vars: { title: titleOf(only) } }
          : { key: "deleteManyTitle", vars: { count: ids.length } },
    });
  };

  /** Deletes the confirmed songs, then brings list, hits, selection, pane and editor in line. */
  const runDelete = async (asked: DeleteRequest) => {
    setDeleting(undefined);
    setRemoving(true);
    setNotice(undefined);
    const { deleted, failed } = await deleteMany(asked.ids, deleteSong);
    const gone = new Set(deleted);
    removed.current = new Set([...removed.current, ...deleted]);
    const alive = (s: SongSummary) => !gone.has(s.id);
    const before = live.current;
    let listed = before.summaries.filter(alive);
    if (gone.size > 0) {
      try {
        listed = await listSongs();
        setSummaries(listed);
      } catch {
        setSummaries((prev) => prev.filter(alive));
        setNotice({ key: "libraryReloadFailed" });
      }
    }
    setRemoving(false);

    if (gone.size > 0) {
      for (const id of gone) knownHits.current.delete(id);
      setSearch((prev) =>
        prev.status === "done"
          ? { ...prev, hits: prev.hits.filter((h) => !gone.has(h.song.id)) }
          : prev,
      );
      setPicked((prev) => new Set([...prev].filter((id) => !gone.has(id))));

      const now = live.current;
      if (now.session?.id !== undefined && gone.has(now.session.id)) {
        endSession();
      }
      const openId = now.selectedId;
      if (openId !== undefined && gone.has(openId)) {
        const at = before.summaries.findIndex((s) => s.id === openId);
        const next =
          at < 0
            ? undefined
            : (before.summaries.slice(at + 1).find(alive) ??
              before.summaries.slice(0, at).reverse().find(alive));
        if (next === undefined) {
          request.current += 1;
          setSelectedId(undefined);
          setDbCurrent(undefined);
          setLoadFailed(false);
        } else {
          selectDb(next.id, listed.find((s) => s.id === next.id) ?? next);
        }
      }
      setDeleteStatus({ key: "deletedCount", vars: { count: deleted.length } });
    }

    const [askedId] = asked.ids;
    const active = document.activeElement;
    if (
      asked.row !== undefined &&
      askedId !== undefined &&
      (active === null || active === document.body)
    ) {
      setRefocus({ id: askedId, row: asked.row });
    }

    const [firstFailure] = failed;
    if (firstFailure === undefined) {
      if (asked.bulk) {
        setSelecting(false);
        setPicked(noSelection());
      }
      return;
    }
    setNotice(
      asked.ids.length === 1
        ? { key: "deleteFailed", detail: firstFailure.message }
        : {
            key: "deleteManyFailed",
            vars: { failed: failed.length, count: asked.ids.length },
            detail: firstFailure.message,
          },
    );
  };

  const togglePicked = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const leaveSelect = () => {
    setSelecting(false);
    setPicked(noSelection());
  };

  /** After a row delete: focus the row at that position, or Select when no row is shown. */
  useEffect(() => {
    if (refocus === undefined) return;
    (rowTarget.current ?? startTarget.current)?.focus();
  }, [refocus]);

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
        setSummaries(list);
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
    const d = createDebouncedSearch(searchSongs, (state) => {
      const s =
        state.status === "done"
          ? {
              ...state,
              hits: state.hits.filter((h) => !removed.current.has(h.song.id)),
            }
          : state;
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

  const allHits = search.status === "done" ? search.hits : [];
  const hitItems: SongIndexItem[] = filterHits(allHits, prefs.language).map(
    (h) => ({ ...toItem(h.song), snippet: h.snippet }),
  );

  const showLoading = mode === "loading";
  const showBundled = mode === "bundled";
  const showDb = mode === "db";
  const showError = showDb && search.status === "error";
  const showEmpty = showDb && search.status === "done" && allHits.length === 0;
  const showHits = showDb && search.status === "done" && hitItems.length > 0;
  const showLibrary =
    showDb && search.status !== "error" && search.status !== "done";
  const showNoSongs = showLibrary && summaries.length === 0;
  const showSongs = showLibrary && !showNoSongs && shown.length > 0;
  const showFilterEmpty =
    (showDb &&
      search.status === "done" &&
      allHits.length > 0 &&
      hitItems.length === 0) ||
    (showLibrary && !showNoSongs && shown.length === 0);
  const showPane =
    entry !== undefined && song !== undefined && view !== undefined;
  const editing = showDb && session !== undefined;
  const listedIds = showHits
    ? hitItems.map((h) => h.id)
    : showSongs
      ? shown.map((s) => s.id)
      : [];
  const askRowDelete = (id: string) =>
    askDelete([id], false, listedIds.indexOf(id));
  const refocusAt = refocus === undefined ? -1 : listedIds.indexOf(refocus.id);
  const focusIndex =
    refocus === undefined
      ? undefined
      : refocusAt >= 0
        ? refocusAt
        : Math.min(refocus.row, listedIds.length - 1);
  const pickListed = () =>
    setPicked((prev) => new Set([...prev, ...listedIds]));
  const showLoadFailed = !editing && !showPane && loadFailed;
  const showNoSelection = !editing && !showPane && !loadFailed;

  return (
    <div className={styles.root}>
      <div className={styles.sidebar}>
        <h1 className={styles.heading} data-ui-chrome>
          {t("appName")} {t("separator")}{" "}
          <bdi lang="he">{t("appNameHebrew")}</bdi>
        </h1>
        {showLoading && <p data-ui-chrome>{t("loadingLibrary")}</p>}
        {showBundled && (
          <>
            <SearchBox value="" disabled onChange={() => undefined} />
            <p
              className={styles.notice}
              data-testid="search-unavailable"
              data-ui-chrome
            >
              {t("searchUnavailable")}
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
                {t("newSong")}
              </button>
              <button
                type="button"
                data-testid="open-files"
                disabled={importing}
                onClick={runImport}
              >
                {t("openFiles")}
              </button>
            </div>
            {report !== undefined && (
              <section
                className={styles.report}
                data-testid="import-report"
                data-ui-chrome
              >
                <p role="status" data-testid="import-summary">
                  {t("importSummary", {
                    saved: report.saved.length,
                    count:
                      report.saved.length +
                      report.queued.length +
                      report.failed.length,
                  })}
                </p>
                {report.queued.length > 0 && (
                  <p role="status" data-testid="import-queued">
                    {t("importQueued", { count: report.queued.length })}
                  </p>
                )}
                {report.saved.some((f) => f.converted) && (
                  <div data-testid="import-converted">
                    <p>{t("importConverted")}</p>
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
                    <p>{t("importSkipped")}</p>
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
                {say(notice)}
              </p>
            )}
            <SearchBox value={query} onChange={onQuery} />
            <p
              role="status"
              className={styles.status}
              data-testid="search-pending"
              data-ui-chrome
            >
              {pending ? t("searching") : ""}
            </p>
            <LibraryControls
              sort={prefs.sort}
              language={prefs.language}
              onSort={(sort) => setPrefs({ ...prefs, sort })}
              onLanguage={(language) => setPrefs({ ...prefs, language })}
            />
            <SelectionBar
              selecting={selecting}
              count={picked.size}
              busy={removing}
              onStart={() => setSelecting(true)}
              onSelectAll={pickListed}
              onDelete={() => askDelete([...picked], true)}
              onDone={leaveSelect}
              startRef={startTarget}
            />
            <p
              role="status"
              className={styles["delete-status"]}
              data-testid="delete-status"
              data-ui-chrome
            >
              {deleteStatus === undefined ? "" : say(deleteStatus)}
            </p>
            <nav
              aria-label={t("songList")}
              data-testid="song-list"
              data-ui-chrome
              className={styles.library}
            >
              {showError && <p role="alert">{t("searchFailed")}</p>}
              {showEmpty && <p data-testid="search-empty">{t("noResults")}</p>}
              {showHits && (
                <SongIndex
                  variant="results"
                  busy={pending}
                  items={hitItems}
                  selectedId={selectedId}
                  onSelect={pickDb}
                  onDelete={askRowDelete}
                  focusIndex={focusIndex}
                  focusRef={rowTarget}
                  selecting={selecting}
                  selected={picked}
                  onToggle={togglePicked}
                  deleteDisabled={removing}
                />
              )}
              {showFilterEmpty && (
                <p data-testid="filter-empty">{t("noFilterMatches")}</p>
              )}
              {showNoSongs && <p>{t("libraryEmpty")}</p>}
              {showSongs && (
                <SongIndex
                  variant="library"
                  items={shown.map(toItem)}
                  selectedId={selectedId}
                  onSelect={pickDb}
                  onDelete={askRowDelete}
                  focusIndex={focusIndex}
                  focusRef={rowTarget}
                  selecting={selecting}
                  selected={picked}
                  onToggle={togglePicked}
                  deleteDisabled={removing}
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
                <div className={styles["header-actions"]} data-ui-chrome>
                  <button
                    type="button"
                    data-testid="edit-song"
                    data-ui-chrome
                    disabled={removing}
                    onClick={openEdit}
                  >
                    {t("editSong")}
                  </button>
                  <button
                    type="button"
                    data-testid="delete-song"
                    data-ui-chrome
                    disabled={removing}
                    onClick={() =>
                      askDelete(
                        selectedId === undefined ? [] : [selectedId],
                        false,
                      )
                    }
                  >
                    {t("deleteAction")}
                  </button>
                </div>
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
        {showLoadFailed && <p role="alert">{t("songLoadFailed")}</p>}
        {showNoSelection && <p>{t("noSongSelected")}</p>}
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
      {deleting !== undefined && (
        <ConfirmDelete
          title={say(deleting.title)}
          onCancel={() => setDeleting(undefined)}
          onConfirm={() => void runDelete(deleting)}
        />
      )}
    </div>
  );
}
