import { useEffect, useId, useMemo, useRef, useState } from "react";
import { importText, parseSong } from "chord-core";
import type { ImportResult, RtlColumns } from "chord-core";
import { SongView } from "chord-render";
import { withTitleFallback } from "../importFiles";
import { STRINGS } from "../strings";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import styles from "./Editor.module.css";

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

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

const mirrorMode = (): RtlColumns => "mirror";
const noMessage = (): string | undefined => undefined;

const otherMode = (mode: RtlColumns): RtlColumns =>
  mode === "mirror" ? "logical" : "mirror";

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
  const inputId = useId();
  const [text, setText] = useState(initialText);
  const [previewText, setPreviewText] = useState(initialText);
  const [lastImport, setLastImport] = useState(seed);
  const [columns, setColumns] = useState(mirrorMode);
  const [warnings, setWarnings] = useState(seed?.result.warnings ?? []);
  const [alreadyChordPro, setAlreadyChordPro] = useState(false);
  const [pasteFailed, setPasteFailed] = useState(false);
  const [saveError, setSaveError] = useState(noMessage);
  const [saving, setSaving] = useState(false);
  const mounted = useRef(true);

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

  useEffect(() => {
    const timer = setTimeout(() => setPreviewText(text), PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const parsed = useMemo(() => parseSong(previewText), [previewText]);

  const apply = (
    source: string,
    result: ImportResult,
    mode: RtlColumns,
    keepText = false,
  ) => {
    if (!keepText) setText(result.chordpro);
    setLastImport({ source, result });
    setColumns(mode);
    setWarnings(result.warnings);
  };

  const onType = (next: string) => {
    setText(next);
    setLastImport(undefined);
    setAlreadyChordPro(false);
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

  const showFlip = lastImport?.result.hasRtlChords === true;

  return (
    <section className={styles.editor} data-testid="editor">
      {fileName !== undefined && (
        <p className={styles.file} data-testid="reviewing-file" data-ui-chrome>
          {STRINGS.reviewingFile} <bdi dir="auto">{fileName}</bdi>
        </p>
      )}
      <div className={styles.toolbar} data-ui-chrome>
        <button
          type="button"
          data-testid="editor-save"
          disabled={saving}
          onClick={() => void onSaveClick()}
        >
          {STRINGS.save}
        </button>
        <button type="button" data-testid="editor-cancel" onClick={onCancel}>
          {STRINGS.cancel}
        </button>
        <button
          type="button"
          data-testid="editor-paste"
          onClick={() => void onPaste()}
        >
          {STRINGS.paste}
        </button>
        <button type="button" data-testid="editor-convert" onClick={onConvert}>
          {STRINGS.convert}
        </button>
        {showFlip && (
          <button type="button" data-testid="editor-flip" onClick={onFlip}>
            {STRINGS.flipAlignment}
          </button>
        )}
      </div>
      <p
        role="status"
        className={styles.status}
        data-testid="editor-status"
        data-ui-chrome
      >
        {alreadyChordPro ? STRINGS.alreadyChordPro : ""}
      </p>
      {pasteFailed && (
        <p role="alert" data-testid="editor-paste-error" data-ui-chrome>
          {STRINGS.pasteFailed}
        </p>
      )}
      {saveError !== undefined && (
        <p role="alert" data-testid="editor-save-error" data-ui-chrome>
          {STRINGS.saveFailed}: {saveError}
        </p>
      )}
      {warnings.length > 0 && (
        <section
          className={styles.warnings}
          data-testid="import-warnings"
          data-ui-chrome
        >
          <h3 className={styles["warnings-heading"]}>
            {STRINGS.importWarnings}
          </h3>
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
      <div className={styles.panes}>
        <div className={styles["input-pane"]}>
          <label htmlFor={inputId} className={styles.label} data-ui-chrome>
            {STRINGS.editorLabel}
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
          aria-label={STRINGS.previewLabel}
          data-testid="editor-preview"
        >
          <DiagnosticsPanel diagnostics={parsed.diagnostics} />
          <SongView song={parsed.song} />
        </div>
      </div>
    </section>
  );
}
