import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { applyEdits, importText, parseSong } from "chord-core";
import type { EditOp, ImportResult, RtlColumns, SongModel } from "chord-core";
import { SongView } from "chord-render";
import { withTitleFallback } from "../importFiles";
import { songMeta } from "../library";
import { useT } from "../i18n";
import { useHistory } from "../useHistory";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import styles from "./Editor.module.css";
import { MetaForm } from "./MetaForm";
import type { MetaFormValues } from "./MetaForm";
import { VisualEditor } from "./VisualEditor";

const PREVIEW_DEBOUNCE_MS = 300;

/** The last paste/convert: its source text and result, the input of Flip alignment. */
export interface ImportSeed {
  source: string;
  result: ImportResult;
}

export interface EditorProps {
  initialText: string;
  /** Text the editor counts as unchanged; defaults to `initialText`. */
  baseline?: string | undefined;
  /** A prior import (queued file): enables Flip alignment and lists its warnings. */
  seed?: ImportSeed | undefined;
  /** Source path of a queued file: Flip re-applies the title fallback for it. */
  titlePath?: string | undefined;
  /** Visible name of the file under review. */
  fileName?: string | undefined;
  onSave(text: string): Promise<void>;
  onCancel(): void;
  onDirtyChange?(dirty: boolean): void;
}

type EditorTab = "visual" | "source";

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

const mirrorMode = (): RtlColumns => "mirror";
const noMessage = (): string | undefined => undefined;
const visualTab = (): EditorTab => "visual";
const noButton = (): HTMLButtonElement | null => null;

const otherMode = (mode: RtlColumns): RtlColumns =>
  mode === "mirror" ? "logical" : "mirror";

/** The song-details values of `song`: the `songMeta` rule, `""` when absent. */
const metaValues = (song: SongModel): MetaFormValues => ({
  title: songMeta(song, "title") ?? "",
  artist: songMeta(song, "artist") ?? "",
  key: songMeta(song, "key") ?? "",
  capo: songMeta(song, "capo") ?? "",
  tempo: songMeta(song, "tempo") ?? "",
});

// Arrow components below: the desktop contract's JSX text scan reads a
// `function` declaration between two components as text.
interface VisualPanelProps {
  /** DOM id of the visual editor root (the Visual tab's `aria-controls`). */
  id: string;
  text: string;
  /** One user action on `song`, the parse of `text`. */
  onApply(song: SongModel, ops: readonly EditOp[]): void;
}

/** The Visual tab: diagnostics, song details and the song as editable rows. */
const VisualPanel = ({ id, text, onApply }: VisualPanelProps) => {
  // Memoized: the visual editor reads a new song object as "the edit arrived".
  const parsed = useMemo(() => parseSong(text), [text]);
  const song = parsed.song;
  return (
    <div className={styles.visual}>
      <DiagnosticsPanel diagnostics={parsed.diagnostics} />
      <MetaForm
        values={metaValues(song)}
        onChange={(name, value) =>
          onApply(song, [{ type: "setMeta", name, value }])
        }
      />
      <VisualEditor id={id} song={song} onEdit={(ops) => onApply(song, ops)} />
    </div>
  );
};

interface SourcePanelProps {
  id: string;
  /** DOM id of the Source tab, the panel's accessible name. */
  labelledBy: string;
  text: string;
  onType(next: string): void;
}

/** The Source tab: the ChordPro text area and its debounced preview. */
const SourcePanel = ({ id, labelledBy, text, onType }: SourcePanelProps) => {
  const t = useT();
  const inputId = useId();
  const [previewText, setPreviewText] = useState(text);

  useEffect(() => {
    const timer = setTimeout(() => setPreviewText(text), PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const parsed = useMemo(() => parseSong(previewText), [previewText]);

  return (
    <div
      id={id}
      role="tabpanel"
      aria-labelledby={labelledBy}
      className={styles.panes}
      data-testid="editor-source"
    >
      <div className={styles["input-pane"]} data-ui-chrome>
        <label htmlFor={inputId} className={styles.label}>
          {t("editorLabel")}
        </label>
        <textarea
          id={inputId}
          dir="auto"
          spellCheck={false}
          className={styles.input}
          data-testid="editor-input"
          value={text}
          onChange={(e) => onType(e.target.value)}
        />
      </div>
      <div
        className={styles.preview}
        role="region"
        aria-label={t("previewLabel")}
        data-testid="editor-preview"
      >
        <DiagnosticsPanel diagnostics={parsed.diagnostics} />
        <SongView song={parsed.song} />
      </div>
    </div>
  );
};

export function Editor({
  initialText,
  baseline,
  seed,
  titlePath,
  fileName,
  onSave,
  onCancel,
  onDirtyChange,
}: EditorProps) {
  const t = useT();
  const id = useId();
  const visualId = `${id}-visual`;
  const sourceId = `${id}-source`;
  const sourceTabId = `${id}-tab-source`;
  const transposeId = `${id}-transpose`;
  const history = useHistory(initialText);
  const text = history.value;
  const [tab, setTab] = useState(visualTab);
  const [lastImport, setLastImport] = useState(seed);
  const [columns, setColumns] = useState(mirrorMode);
  const [warnings, setWarnings] = useState(seed?.result.warnings ?? []);
  const [alreadyChordPro, setAlreadyChordPro] = useState(false);
  const [pasteFailed, setPasteFailed] = useState(false);
  const [saveError, setSaveError] = useState(noMessage);
  const [saving, setSaving] = useState(false);
  const mounted = useRef(true);
  const visualTabRef = useRef(noButton());
  const sourceTabRef = useRef(noButton());

  const dirty = text !== (baseline ?? initialText);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  /** The text is no longer the last import's result: Flip has nothing to flip. */
  const forgetImport = () => {
    setLastImport(undefined);
    setAlreadyChordPro(false);
  };

  const apply = (source: string, result: ImportResult, mode: RtlColumns) => {
    history.set(result.chordpro);
    setLastImport({ source, result });
    setColumns(mode);
    setWarnings(result.warnings);
  };

  const onType = (next: string) => {
    history.set(next, { coalesce: true });
    forgetImport();
  };

  /** A structured edit of `song` (the parse of the text) as one history entry. */
  const onApply = (song: SongModel, ops: readonly EditOp[]) => {
    const result = applyEdits(song, ops);
    if (!result.changed || result.text === text) return;
    history.set(result.text);
    forgetImport();
  };

  const onTranspose = (semitones: -1 | 1) =>
    onApply(parseSong(text).song, [{ type: "transpose", semitones }]);

  const onUndo = () => {
    if (!history.canUndo) return;
    history.undo();
    forgetImport();
  };

  const onRedo = () => {
    if (!history.canRedo) return;
    history.redo();
    forgetImport();
  };

  const onPaste = async () => {
    setPasteFailed(false);
    setAlreadyChordPro(false);
    let clip: string;
    try {
      clip = await navigator.clipboard.readText();
    } catch {
      if (mounted.current) setPasteFailed(true);
      return;
    }
    if (!mounted.current) return;
    apply(clip, importText(clip, { rtlColumns: columns }), columns);
  };

  const onConvert = () => {
    setPasteFailed(false);
    const result = importText(text, { rtlColumns: columns });
    if (result.format === "chordpro") {
      setAlreadyChordPro(true);
      setLastImport(undefined);
      setWarnings(result.warnings);
      return;
    }
    setAlreadyChordPro(false);
    apply(text, result, columns);
  };

  const onFlip = () => {
    if (!lastImport) return;
    const mode = otherMode(columns);
    const result = importText(lastImport.source, { rtlColumns: mode });
    const chordpro =
      titlePath === undefined
        ? result.chordpro
        : withTitleFallback(result.chordpro, titlePath);
    apply(lastImport.source, { ...result, chordpro }, mode);
  };

  const onSaveClick = async () => {
    setSaveError(undefined);
    setSaving(true);
    try {
      await onSave(text);
    } catch (reason) {
      if (mounted.current) setSaveError(messageOf(reason));
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  /** Undo / redo shortcuts; inside an input element the browser's own undo stays. */
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (e.target instanceof HTMLInputElement) return;
    const key = e.key.toLowerCase();
    if (key === "z" && !e.shiftKey) {
      e.preventDefault();
      onUndo();
    } else if (
      (key === "z" && e.shiftKey) ||
      (key === "y" && e.ctrlKey && !e.shiftKey)
    ) {
      e.preventDefault();
      onRedo();
    }
  };

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const visual = tab === "source";
    setTab(visual ? "visual" : "source");
    (visual ? visualTabRef : sourceTabRef).current?.focus();
  };

  const showFlip = lastImport?.result.hasRtlChords === true;

  return (
    <section
      className={styles.editor}
      data-testid="editor"
      onKeyDown={onKeyDown}
    >
      {fileName !== undefined && (
        <p className={styles.file} data-testid="reviewing-file" data-ui-chrome>
          {t("reviewingFile")} <bdi dir="auto">{fileName}</bdi>
        </p>
      )}
      <div className={styles.toolbar} data-ui-chrome>
        <div className={styles.group}>
          <button
            type="button"
            data-testid="editor-save"
            disabled={saving}
            onClick={() => void onSaveClick()}
          >
            {t("save")}
          </button>
          <button type="button" data-testid="editor-cancel" onClick={onCancel}>
            {t("cancel")}
          </button>
        </div>
        <div className={styles.group}>
          <button
            type="button"
            data-testid="editor-undo"
            disabled={!history.canUndo}
            onClick={onUndo}
          >
            {t("undo")}
          </button>
          <button
            type="button"
            data-testid="editor-redo"
            disabled={!history.canRedo}
            onClick={onRedo}
          >
            {t("redo")}
          </button>
        </div>
        <div
          className={styles.group}
          role="group"
          aria-labelledby={transposeId}
        >
          <span id={transposeId} className={styles.label}>
            {t("transpose")}
          </span>
          <button
            type="button"
            className={styles.step}
            data-testid="editor-transpose-down"
            aria-label={t("transposeSongDown")}
            onClick={() => onTranspose(-1)}
          >
            {t("transposeDownGlyph")}
          </button>
          <button
            type="button"
            className={styles.step}
            data-testid="editor-transpose-up"
            aria-label={t("transposeSongUp")}
            onClick={() => onTranspose(1)}
          >
            {t("transposeUpGlyph")}
          </button>
        </div>
        <div className={styles.group}>
          <button
            type="button"
            data-testid="editor-paste"
            onClick={() => void onPaste()}
          >
            {t("paste")}
          </button>
          {tab === "source" && (
            <button
              type="button"
              data-testid="editor-convert"
              onClick={onConvert}
            >
              {t("convert")}
            </button>
          )}
          {showFlip && (
            <button type="button" data-testid="editor-flip" onClick={onFlip}>
              {t("flipAlignment")}
            </button>
          )}
        </div>
      </div>
      <p
        role="status"
        className={styles.status}
        data-testid="editor-status"
        data-ui-chrome
      >
        {alreadyChordPro ? t("alreadyChordPro") : ""}
      </p>
      {pasteFailed && (
        <p role="alert" data-testid="editor-paste-error" data-ui-chrome>
          {t("pasteFailed")}
        </p>
      )}
      {saveError !== undefined && (
        <p role="alert" data-testid="editor-save-error" data-ui-chrome>
          {t("saveFailed")}: {saveError}
        </p>
      )}
      {warnings.length > 0 && (
        <section
          className={styles.warnings}
          data-testid="import-warnings"
          data-ui-chrome
        >
          <h3 className={styles["warnings-heading"]}>{t("importWarnings")}</h3>
          <ul className={styles["warning-items"]}>
            {warnings.map((w, i) => (
              <li key={i} data-testid="import-warning">
                <bdi dir="ltr">{w.line}</bdi>{" "}
                <span dir="auto">{w.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div
        className={styles.tabs}
        role="tablist"
        aria-label={t("editorTabs")}
        data-ui-chrome
        onKeyDown={onTabKey}
      >
        <button
          ref={visualTabRef}
          type="button"
          role="tab"
          className={styles.tab}
          data-testid="editor-tab-visual"
          aria-selected={tab === "visual"}
          aria-controls={tab === "visual" ? visualId : undefined}
          tabIndex={tab === "visual" ? 0 : -1}
          onClick={() => setTab("visual")}
        >
          {t("tabVisual")}
        </button>
        <button
          ref={sourceTabRef}
          type="button"
          role="tab"
          id={sourceTabId}
          className={styles.tab}
          data-testid="editor-tab-source"
          aria-selected={tab === "source"}
          aria-controls={tab === "source" ? sourceId : undefined}
          tabIndex={tab === "source" ? 0 : -1}
          onClick={() => setTab("source")}
        >
          {t("tabSource")}
        </button>
      </div>
      {tab === "visual" ? (
        <VisualPanel id={visualId} text={text} onApply={onApply} />
      ) : (
        <SourcePanel
          id={sourceId}
          labelledBy={sourceTabId}
          text={text}
          onType={onType}
        />
      )}
    </section>
  );
}
