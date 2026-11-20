import { useLayoutEffect, useRef, useState } from "react";
import { transposeKey } from "chord-core";
import { useT } from "../i18n";
import { capoOptions } from "../library";
import type { Setlist, SetlistItem } from "../storage";
import styles from "./SetlistEditor.module.css";
import { useReorderDrag } from "./useReorderDrag";

export interface SetlistEditorProps {
  setlist: Setlist;
  /** A storage call is running: edits are disabled. */
  busy: boolean;
  onReorder(itemIds: string[]): void;
  onMove(itemId: string, delta: -1 | 1): void;
  onTranspose(itemId: string, transpose: number): void;
  onCapo(itemId: string, capo: number | null): void;
  onRemove(itemId: string): void;
  onOpenSong(songId: string, itemId: string): void;
  onPrint(): void;
  onExportPdf(): void;
  onExportWord(): void;
}

const MAX_TRANSPOSE = 11;

/** Typed `null` start value of the refocus ref. */
const NO_ID = null as string | null;

/** The part of a key event the row handler reads. */
interface RowKeyEvent {
  altKey: boolean;
  key: string;
  preventDefault(): void;
}

const formatTranspose = (n: number): string => (n > 0 ? `+${n}` : String(n));

/** Main-pane editor of one setlist: ordered entries with per-entry transpose and capo. */
export function SetlistEditor({
  setlist,
  busy,
  onReorder,
  onMove,
  onTranspose,
  onCapo,
  onRemove,
  onOpenSong,
  onPrint,
  onExportPdf,
  onExportWord,
}: SetlistEditorProps) {
  const t = useT();
  const items = setlist.items;
  const ids = items.map((item) => item.id);
  const [announcement, setAnnouncement] = useState("");
  const refocus = useRef(NO_ID);

  const announce = (item: SetlistItem, position: number) =>
    setAnnouncement(t("movedAnnounce", { title: item.title, n: position }));

  const drag = useReorderDrag(ids, (next, movedId) => {
    const item = items.find((candidate) => candidate.id === movedId);
    onReorder(next);
    if (item) announce(item, next.indexOf(item.id) + 1);
  });
  const { rowElement } = drag;

  // Keep keyboard focus on the moved row once the parent re-renders the new order.
  useLayoutEffect(() => {
    const id = refocus.current;
    if (id === null) return;
    refocus.current = null;
    rowElement(id)?.focus();
  }, [items, rowElement]);

  const move = (index: number, delta: -1 | 1, keepFocus: boolean) => {
    const item = items[index];
    if (!item || busy || index + delta < 0 || index + delta >= items.length)
      return;
    if (keepFocus) refocus.current = item.id;
    onMove(item.id, delta);
    announce(item, index + delta + 1);
  };

  const onRowKeyDown = (e: RowKeyEvent, index: number) => {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    move(index, e.key === "ArrowUp" ? -1 : 1, true);
  };

  const dropEdge = (index: number): "before" | "after" | undefined => {
    const target = drag.targetIndex;
    if (drag.draggingId === null || target === null) return undefined;
    const others = ids.filter((id) => id !== drag.draggingId);
    if (target < others.length)
      return others[target] === ids[index] ? "before" : undefined;
    return others[others.length - 1] === ids[index] ? "after" : undefined;
  };

  return (
    <section className={styles.editor} data-testid="setlist-editor">
      <header className={styles.header}>
        <h2 className={styles.title}>
          <bdi>{setlist.name}</bdi>
        </h2>
        <div className={styles.exports} data-ui-chrome>
          <button type="button" data-testid="setlist-print" onClick={onPrint}>
            {t("print")}
          </button>
          <button
            type="button"
            disabled={busy}
            data-testid="setlist-export-pdf"
            onClick={onExportPdf}
          >
            {t("exportPdf")}
          </button>
          <button
            type="button"
            disabled={busy}
            data-testid="setlist-export-word"
            onClick={onExportWord}
          >
            {t("exportWord")}
          </button>
        </div>
      </header>
      <p
        className={styles.announce}
        aria-live="polite"
        data-testid="setlist-announce"
      >
        {announcement}
      </p>
      {items.length === 0 ? (
        <p className={styles.empty} data-testid="setlist-entries-empty">
          {t("setlistEmpty")}
        </p>
      ) : (
        <ol
          className={styles.list}
          aria-label={t("setlistEntries")}
          data-testid="setlist-entries"
        >
          {items.map((item, index) => {
            const key = item.key
              ? (transposeKey(item.key, item.transpose) ?? item.key)
              : null;
            const edge = dropEdge(index);
            return (
              <li
                key={item.id}
                ref={(el) => drag.registerRow(item.id, el)}
                tabIndex={0}
                aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                className={styles.row}
                data-testid="setlist-entry"
                data-dragging={drag.draggingId === item.id ? "true" : undefined}
                data-drop={edge}
                data-ui-chrome
                onKeyDown={(e) => onRowKeyDown(e, index)}
              >
                <button
                  type="button"
                  className={styles.handle}
                  aria-label={t("dragHandle")}
                  disabled={busy}
                  data-testid="setlist-entry-handle"
                  {...drag.handleProps(item.id)}
                >
                  {t("dragGlyph")}
                </button>
                <span
                  className={styles.position}
                  data-testid="setlist-entry-position"
                >
                  {index + 1}
                </span>
                <div className={styles.song}>
                  <button
                    type="button"
                    className={styles.open}
                    data-testid="setlist-entry-title"
                    onClick={() => onOpenSong(item.songId, item.id)}
                  >
                    <bdi>{item.title}</bdi>
                  </button>
                  {item.artist && (
                    <span dir="auto" className={styles.artist}>
                      {item.artist}
                    </span>
                  )}
                  {key !== null && (
                    <bdi
                      dir="ltr"
                      className={styles.key}
                      data-testid="setlist-entry-key"
                    >
                      {key}
                    </bdi>
                  )}
                </div>
                <div className={styles.controls}>
                  <button
                    type="button"
                    aria-label={t("transposeDown")}
                    disabled={busy || item.transpose <= -MAX_TRANSPOSE}
                    data-testid="setlist-entry-transpose-down"
                    onClick={() =>
                      onTranspose(
                        item.id,
                        Math.max(-MAX_TRANSPOSE, item.transpose - 1),
                      )
                    }
                  >
                    {t("transposeDownGlyph")}
                  </button>
                  <bdi
                    dir="ltr"
                    className={styles.value}
                    data-testid="setlist-entry-transpose-value"
                  >
                    {formatTranspose(item.transpose)}
                  </bdi>
                  <button
                    type="button"
                    aria-label={t("transposeUp")}
                    disabled={busy || item.transpose >= MAX_TRANSPOSE}
                    data-testid="setlist-entry-transpose-up"
                    onClick={() =>
                      onTranspose(
                        item.id,
                        Math.min(MAX_TRANSPOSE, item.transpose + 1),
                      )
                    }
                  >
                    {t("transposeUpGlyph")}
                  </button>
                  <select
                    aria-label={t("capo")}
                    value={item.capo == null ? "" : String(item.capo)}
                    disabled={busy}
                    data-testid="setlist-entry-capo"
                    onChange={(e) =>
                      onCapo(
                        item.id,
                        e.target.value === "" ? null : Number(e.target.value),
                      )
                    }
                  >
                    <option value="">
                      {t("capoSongDefault", { n: item.songCapo ?? 0 })}
                    </option>
                    {capoOptions(item.songCapo ?? undefined).map((n) => (
                      <option key={n} value={String(n)}>
                        {n}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    aria-label={t("moveUp")}
                    disabled={busy || index === 0}
                    data-testid="setlist-entry-up"
                    onClick={() => move(index, -1, false)}
                  >
                    {t("upGlyph")}
                  </button>
                  <button
                    type="button"
                    aria-label={t("moveDown")}
                    disabled={busy || index === items.length - 1}
                    data-testid="setlist-entry-down"
                    onClick={() => move(index, 1, false)}
                  >
                    {t("downGlyph")}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    data-testid="setlist-entry-remove"
                    onClick={() => onRemove(item.id)}
                  >
                    {t("removeFromSetlist")}
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
