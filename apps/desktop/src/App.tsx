import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildExportDocument,
  importText,
  parseSong,
  viewSong,
} from "chord-core";
import type { Diagnostic, ExportDocument, SongModel } from "chord-core";
import { SongView } from "chord-render";
import styles from "./App.module.css";
import { AddToSetlistDialog } from "./components/AddToSetlistDialog";
import { ConfirmDelete } from "./components/ConfirmDelete";
import { ConfirmDiscard } from "./components/ConfirmDiscard";
import { DiagnosticsPanel } from "./components/DiagnosticsPanel";
import { Editor } from "./components/Editor";
import type { ImportSeed } from "./components/Editor";
import { LibraryControls } from "./components/LibraryControls";
import { LocaleToggle } from "./components/LocaleToggle";
import { SearchBox } from "./components/SearchBox";
import { SelectionBar } from "./components/SelectionBar";
import { SetlistEditor } from "./components/SetlistEditor";
import { SetlistsPanel } from "./components/SetlistsPanel";
import { SidebarTabs } from "./components/SidebarTabs";
import type { SidebarView } from "./components/SidebarTabs";
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
import { printExport, saveDocx } from "./export";
import type { ExportLabels, ExportMeta } from "./export";
import { useLocale, useT } from "./i18n";
import { capoOptions, loadLibrary } from "./library";
import {
  filterHits,
  filterSummaries,
  readLibraryPrefs,
  sortSummaries,
  storeLibraryPrefs,
} from "./libraryView";
import type { LibraryPrefs } from "./libraryView";
import {
  duplicateName,
  entriesToExport,
  moveItem,
  songToExport,
} from "./setlists";
import { createDebouncedSearch, sortByTitle } from "./songSource";
import type {
  DebouncedSearch,
  SearchState,
  SummaryIndex,
  SummaryList,
} from "./songSource";
import {
  addSetlistItems,
  createSetlist,
  deleteSetlist,
  deleteSong,
  duplicateSetlist,
  getSetlist,
  getSong,
  listSetlists,
  listSongs,
  removeSetlistItem,
  renameSetlist,
  reorderSetlistItems,
  saveSong,
  searchSongs,
  updateSetlistItem,
} from "./storage";
import type { Setlist, SetlistSummary, Song, SongSummary } from "./storage";
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
    | "deletedCount"
    | "setlistSaveFailed"
    | "setlistsLoadFailed"
    | "exportFailed"
    | "addedToSetlist"
    | "exportSaved";
  vars?: { title?: string; count?: number; failed?: number; name?: string };
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
  /** Listed row of the first song asked for (focus returns near it); -1 when none is listed. */
  row: number;
  /** The song at `row`; absent when none is listed. */
  rowId?: string | undefined;
}

/** Where focus goes once a row delete has finished. */
interface Refocus {
  /** The first listed song the delete was asked for (still listed when its delete failed). */
  id?: string | undefined;
  /** Position its row had in the listed rows; -1 when it was not listed. */
  row: number;
}

/** Latest committed values, read by a delete run after its awaits. */
interface Live {
  /** Id of the open setlist. */
  setlistId: string | undefined;
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
  setlistId: undefined,
  selectedId: undefined,
  session: undefined,
  summaries: [],
});

const noSetlists = (): SetlistSummary[] => [];
const noSetlist = (): Setlist | undefined => undefined;
const noAdding = (): string[] | undefined => undefined;
const songsView = (): SidebarView => "songs";

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
  const { locale } = useLocale();
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
  const [sidebarView, setSidebarView] = useState(songsView);
  const [setlists, setSetlists] = useState(noSetlists);
  const [openSetlist, setOpenSetlist] = useState(noSetlist);
  const [setlistBusy, setSetlistBusy] = useState(false);
  const [adding, setAdding] = useState(noAdding);
  const [status, setStatus] = useState(noMessage);
  const [prefs, setPrefsState] = useState(() =>
    readLibraryPrefs(window.localStorage),
  );
  const live = useRef(noLive());
  const sessionKey = useRef(0);
  const request = useRef(0);
  /** Counts Edit clicks; a `getSong` answering for an older click is dropped. */
  const editRequest = useRef(0);
  const sidebar = useRef<HTMLDivElement | null>(null);
  const listing = useRef(noList());
  const debounced = useRef(noSearch());
  const knownHits = useRef(newIndex());
  /** Ids deleted in this session; a late search response never shows them. */
  const removed = useRef(noSelection());
  const rowTarget = useRef(noButton());
  /** True while a setlist call or an export runs; blocks a second one. */
  const setlistRunning = useRef(false);
  /** Counts setlist selections; a `getSetlist` answering for an older one is dropped. */
  const setlistRequest = useRef(0);

  const selectDb = useCallback(
    (
      id: string,
      summary?: SongSummary,
      start?: { transpose: number; capo: number | null },
    ) => {
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
          setTranspose(start?.transpose ?? 0);
          setCapo(start?.capo ?? song.capo ?? 0);
        })
        .catch(() => {
          if (token !== request.current) return;
          setDbCurrent(undefined);
          setLoadFailed(true);
        });
    },
    [],
  );

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
      const edit = ++editRequest.current;
      const selection = request.current;
      /** The song is still the open one, not deleted, and no newer Edit started. */
      const current = () =>
        edit === editRequest.current &&
        selection === request.current &&
        !removed.current.has(id);
      getSong(id)
        .then((stored) => {
          if (!current()) return;
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
        .catch(() => {
          if (current()) setNotice({ key: "songLoadFailed" });
        });
    });
  };

  const pickDb = (id: string) =>
    guard(() => {
      abandon();
      setOpenSetlist(undefined);
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
    setOpenSetlist(undefined);
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

  /** The whole library in the chosen order. */
  const ordered = useMemo(
    () => sortSummaries(summaries, prefs.sort),
    [summaries, prefs.sort],
  );

  /** The library as listed: chosen order, language filter applied. */
  const shown = useMemo(
    () => filterSummaries(ordered, prefs.language),
    [ordered, prefs],
  );

  useEffect(() => {
    live.current = {
      setlistId: openSetlist?.id,
      selectedId,
      session,
      summaries: shown,
    };
  });

  const titleOf = (id: string): string =>
    summaries.find((s) => s.id === id)?.title ??
    knownHits.current.get(id)?.title ??
    (id === selectedId ? dbCurrent?.title : undefined) ??
    "";

  /** Reloads the setlist summaries; a failure keeps the last list and shows a notice. */
  const refreshSetlists = async () => {
    try {
      setSetlists(await listSetlists());
    } catch {
      setNotice({ key: "setlistsLoadFailed" });
    }
  };

  /** After songs were deleted: entries of them are gone, so reload the summaries and the open setlist. */
  const resyncSetlists = async () => {
    const id = live.current.setlistId;
    try {
      const [list, open] = await Promise.all([
        listSetlists(),
        id === undefined ? undefined : getSetlist(id),
      ]);
      setSetlists(list);
      if (open !== undefined) {
        setOpenSetlist((prev) => (prev?.id === open.id ? open : prev));
      }
    } catch {
      setNotice({ key: "setlistsLoadFailed" });
    }
  };

  /**
   * Runs one setlist call (or export) at a time. On success `apply` receives the result and the
   * summaries are reloaded; on failure the state stays as it was and a notice is shown.
   */
  const runSetlistCall = async <T,>(
    call: () => Promise<T>,
    apply: (value: T) => void,
  ): Promise<boolean> => {
    if (setlistRunning.current) return false;
    setlistRunning.current = true;
    setSetlistBusy(true);
    setNotice(undefined);
    setStatus(undefined);
    try {
      apply(await call());
      await refreshSetlists();
      return true;
    } catch {
      setNotice({ key: "setlistSaveFailed" });
      return false;
    } finally {
      setlistRunning.current = false;
      setSetlistBusy(false);
    }
  };

  /** Replaces the open setlist when the result is that same setlist. */
  const replaceOpen = (next: Setlist) =>
    setOpenSetlist((prev) => (prev?.id === next.id ? next : prev));

  const selectSetlist = (id: string) =>
    guard(() => {
      abandon();
      const token = ++setlistRequest.current;
      getSetlist(id).then(
        (next) => {
          if (token === setlistRequest.current) setOpenSetlist(next);
        },
        () => {
          if (token === setlistRequest.current) {
            setNotice({ key: "setlistsLoadFailed" });
          }
        },
      );
    });

  const openNewSetlist = (next: Setlist) => {
    setlistRequest.current += 1;
    setOpenSetlist(next);
  };

  const createNamedSetlist = (name: string) =>
    void runSetlistCall(() => createSetlist(name), openNewSetlist);

  const renameNamedSetlist = (id: string, name: string) =>
    void runSetlistCall(() => renameSetlist(id, name), replaceOpen);

  const duplicateNamedSetlist = (id: string) => {
    const source = setlists.find((s) => s.id === id);
    if (source === undefined) return;
    const name = duplicateName(source.name, t("duplicateSuffix"));
    void runSetlistCall(() => duplicateSetlist(id, name), openNewSetlist);
  };

  const removeSetlist = (id: string) =>
    void runSetlistCall(
      () => deleteSetlist(id),
      () => {
        setlistRequest.current += 1;
        setOpenSetlist((prev) => (prev?.id === id ? undefined : prev));
      },
    );

  /** Runs `call` against the open setlist and shows the returned setlist. */
  const changeOpen = (call: (id: string) => Promise<Setlist>) => {
    if (openSetlist === undefined) return;
    const id = openSetlist.id;
    void runSetlistCall(() => call(id), replaceOpen);
  };

  const moveEntry = (itemId: string, delta: -1 | 1) => {
    if (openSetlist === undefined) return;
    const order = moveItem(
      openSetlist.items.map((i) => i.id),
      itemId,
      delta,
    );
    changeOpen((id) => reorderSetlistItems(id, order));
  };

  const openFromSetlist = (songId: string, itemId: string) => {
    const entryOf = openSetlist?.items.find((i) => i.id === itemId);
    guard(() => {
      abandon();
      setlistRequest.current += 1;
      setOpenSetlist(undefined);
      setSidebarView("songs");
      selectDb(
        songId,
        summaries.find((s) => s.id === songId),
        entryOf && { transpose: entryOf.transpose, capo: entryOf.capo ?? null },
      );
    });
  };

  /** Song ids to add, in library order. */
  const idsToAdd = (): string[] =>
    ordered.map((s) => s.id).filter((id) => picked.has(id));

  const finishAdd = (ok: boolean, count: number) => {
    setAdding(undefined);
    if (ok) setStatus({ key: "addedToSetlist", vars: { count } });
  };

  const confirmAdd = async (setlistId: string) => {
    const ids = adding;
    if (ids === undefined) return;
    const ok = await runSetlistCall(
      () => addSetlistItems(setlistId, ids),
      replaceOpen,
    );
    finishAdd(ok, ids.length);
  };

  const confirmCreateAndAdd = async (name: string) => {
    const ids = adding;
    if (ids === undefined) return;
    const ok = await runSetlistCall(async () => {
      const created = await createSetlist(name);
      try {
        return await addSetlistItems(created.id, ids);
      } catch (reason) {
        await refreshSetlists();
        throw reason;
      }
    }, replaceOpen);
    finishAdd(ok, ids.length);
  };

  const exportLabels = (): ExportLabels => ({
    setlist: t("exportLabelSetlist"),
    key: t("exportLabelKey"),
    capo: t("exportLabelCapo"),
    transpose: t("exportLabelTranspose"),
    songs: t("exportLabelSongs"),
    date: t("exportLabelDate"),
  });

  const exportMeta = (): ExportMeta => ({
    lang: locale,
    dir: locale === "he" ? "rtl" : "ltr",
    dateText: new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(
      new Date(),
    ),
  });

  /** Builds the document, then prints it, saves it as PDF through the print dialog, or saves a Word file. */
  const runExport = async (
    mode: "print" | "pdf" | "word",
    build: () => Promise<{ doc: ExportDocument; cover: boolean }>,
  ) => {
    if (setlistRunning.current) return;
    setlistRunning.current = true;
    setSetlistBusy(true);
    setNotice(undefined);
    setStatus(undefined);
    try {
      const { doc, cover } = await build();
      const labels = exportLabels();
      const meta = exportMeta();
      if (mode === "word") {
        const saved = await saveDocx(doc, {
          cover,
          labels,
          meta,
          filterName: t("fileFilterWord"),
        });
        if (saved.status === "saved") {
          setStatus({
            key: "exportSaved",
            vars: { name: fileNameOf(saved.path) },
          });
        }
      } else {
        await printExport(doc, { cover, labels, meta, mode });
      }
    } catch {
      setNotice({ key: "exportFailed" });
    } finally {
      setlistRunning.current = false;
      setSetlistBusy(false);
    }
  };

  const exportSetlist = (mode: "print" | "pdf" | "word") => {
    const open = openSetlist;
    if (open === undefined) return;
    void runExport(mode, async () => {
      const ids = [...new Set(open.items.map((i) => i.songId))];
      const stored = await Promise.all(ids.map((id) => getSong(id)));
      const byId = new Map(ids.map((id, i) => [id, stored[i]!]));
      return {
        doc: buildExportDocument(open.name, entriesToExport(open, byId)),
        cover: true,
      };
    });
  };

  /** Opens the delete confirmation; nothing is deleted before the user confirms. */
  const askDelete = (ids: string[], bulk: boolean) => {
    const [only] = ids;
    if (only === undefined || removing) return;
    const first = ids
      .map((id) => ({ id, at: listedIds.indexOf(id) }))
      .filter((p) => p.at >= 0)
      .sort((a, b) => a.at - b.at)[0];
    setDeleteStatus(undefined);
    setDeleting({
      ids,
      bulk,
      row: first?.at ?? -1,
      rowId: first?.id,
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
      await resyncSetlists();
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

    const active = document.activeElement;
    if (active === null || active === document.body) {
      setRefocus({ id: asked.rowId, row: asked.row });
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

  /** After a delete: focus the row at that position, or the search box when no row is shown; then drop the request. */
  useEffect(() => {
    if (refocus === undefined) return;
    const row = rowTarget.current;
    const search = sidebar.current?.querySelector<HTMLElement>(
      'input[type="search"]',
    );
    const target =
      row !== null && row.isConnected && !row.disabled ? row : search;
    target?.focus();
    // Cleared right after the commit that applied it, so a later render
    // (typing in the search box, say) cannot move focus again.
    queueMicrotask(() => setRefocus(undefined));
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
    let cancelled = false;
    listSetlists().then(
      (list) => {
        if (!cancelled) setSetlists(list);
      },
      () => {
        if (!cancelled) setNotice({ key: "setlistsLoadFailed" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [mode]);

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

  const exportOpenSong = (mode: "print" | "pdf" | "word") => {
    if (entry === undefined || song === undefined) return;
    void runExport(mode, () =>
      Promise.resolve({
        doc: buildExportDocument(entry.title || (song.title ?? ""), [
          songToExport(song, transpose, capo),
        ]),
        cover: false,
      }),
    );
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
  const askRowDelete = (id: string) => askDelete([id], false);
  const refocusAt =
    refocus?.id === undefined ? -1 : listedIds.indexOf(refocus.id);
  const focusIndex =
    refocus === undefined
      ? undefined
      : refocus.row < 0
        ? -1
        : refocusAt >= 0
          ? refocusAt
          : Math.min(refocus.row, listedIds.length - 1);
  const pickListed = () =>
    setPicked((prev) => new Set([...prev, ...listedIds]));
  const inSetlists = showDb && sidebarView === "setlists";
  const showSetlist = !editing && openSetlist !== undefined;
  const showSong = !editing && !showSetlist && !inSetlists;
  const showLoadFailed = showSong && !showPane && loadFailed;
  const showNoSelection = showSong && !showPane && !loadFailed;
  const noticeEl = notice !== undefined && (
    <p role="alert" data-testid="app-notice" data-ui-chrome>
      {say(notice)}
    </p>
  );

  return (
    <div className={styles.root}>
      <div ref={sidebar} className={styles.sidebar}>
        <div className={styles["heading-row"]}>
          <h1 className={styles.heading} data-ui-chrome>
            {t("appName")} {t("separator")}{" "}
            <bdi lang="he">{t("appNameHebrew")}</bdi>
          </h1>
          <LocaleToggle />
        </div>
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
            {noticeEl}
            <SongList
              songs={bundled}
              selectedId={selectedId}
              onSelect={selectBundled}
            />
          </>
        )}
        {showDb && <SidebarTabs view={sidebarView} onChange={setSidebarView} />}
        {(showDb || showBundled) && status !== undefined && (
          <p
            role="status"
            className={styles.notice}
            data-testid="app-status"
            data-ui-chrome
          >
            {say(status)}
          </p>
        )}
        {inSetlists && (
          <>
            {noticeEl}
            <SetlistsPanel
              setlists={setlists}
              selectedId={openSetlist?.id ?? null}
              busy={setlistBusy}
              onSelect={selectSetlist}
              onCreate={createNamedSetlist}
              onRename={renameNamedSetlist}
              onDuplicate={duplicateNamedSetlist}
              onDelete={removeSetlist}
            />
          </>
        )}
        {showDb && !inSetlists && (
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
            {noticeEl}
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
              onAddToSetlist={() => setAdding(idsToAdd())}
              onDone={leaveSelect}
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
        {showSetlist && openSetlist !== undefined && (
          <>
            <p
              className={styles.hint}
              data-testid="setlist-pdf-hint"
              data-ui-chrome
            >
              {t("pdfHint")}
            </p>
            <SetlistEditor
              setlist={openSetlist}
              busy={setlistBusy}
              onReorder={(order) =>
                changeOpen((id) => reorderSetlistItems(id, order))
              }
              onMove={moveEntry}
              onTranspose={(itemId, value) =>
                changeOpen((id) =>
                  updateSetlistItem(
                    id,
                    itemId,
                    value,
                    openSetlist.items.find((i) => i.id === itemId)?.capo ??
                      null,
                  ),
                )
              }
              onCapo={(itemId, value) =>
                changeOpen((id) =>
                  updateSetlistItem(
                    id,
                    itemId,
                    openSetlist.items.find((i) => i.id === itemId)?.transpose ??
                      0,
                    value,
                  ),
                )
              }
              onRemove={(itemId) =>
                changeOpen((id) => removeSetlistItem(id, itemId))
              }
              onOpenSong={openFromSetlist}
              onPrint={() => exportSetlist("print")}
              onExportPdf={() => exportSetlist("pdf")}
              onExportWord={() => exportSetlist("word")}
            />
          </>
        )}
        {showSong && entry && song && view && (
          <>
            <div className={styles["header-row"]}>
              <SongHeader
                title={entry.title}
                artist={entry.artist}
                soundingKey={view.soundingKey}
                capo={capo}
              />
              <div className={styles["header-actions"]} data-ui-chrome>
                {showDb && (
                  <>
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
                    <button
                      type="button"
                      data-testid="song-add-to-setlist"
                      data-ui-chrome
                      disabled={removing || setlistBusy}
                      onClick={() =>
                        selectedId !== undefined && setAdding([selectedId])
                      }
                    >
                      {t("addToSetlist")}
                    </button>
                  </>
                )}
                <button
                  type="button"
                  data-testid="song-print"
                  data-ui-chrome
                  disabled={setlistBusy}
                  onClick={() => exportOpenSong("print")}
                >
                  {t("print")}
                </button>
                <button
                  type="button"
                  data-testid="song-export-pdf"
                  data-ui-chrome
                  disabled={setlistBusy}
                  onClick={() => exportOpenSong("pdf")}
                >
                  {t("exportPdf")}
                </button>
                <button
                  type="button"
                  data-testid="song-export-word"
                  data-ui-chrome
                  disabled={setlistBusy}
                  onClick={() => exportOpenSong("word")}
                >
                  {t("exportWord")}
                </button>
                <span
                  className={styles.hint}
                  data-testid="song-pdf-hint"
                  data-ui-chrome
                >
                  {t("pdfHint")}
                </span>
              </div>
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
      {adding !== undefined && (
        <AddToSetlistDialog
          setlists={setlists}
          songCount={adding.length}
          busy={setlistBusy}
          onCancel={() => setAdding(undefined)}
          onAdd={(id) => void confirmAdd(id)}
          onCreateAndAdd={(name) => void confirmCreateAndAdd(name)}
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
