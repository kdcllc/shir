import { useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { buildAiPrompt, parseAiReply } from "chord-core";
import type { AiReplyResult, AiReplySong } from "chord-core";
import { useT } from "../i18n";
import styles from "./AiImportDialog.module.css";
import { useDialogFocus } from "./useDialogFocus";

export interface AiDocument {
  sourceName: string;
  text: string;
}

export interface AiImportDialogProps {
  /** A document to start with; the dialog then opens in text mode. */
  initial?: AiDocument | undefined;
  /** Picks and extracts a document; rejects with an `Error` whose message is already localized. */
  pickDocument(): Promise<(AiDocument & { warnings: string[] }) | undefined>;
  onImport(songs: AiReplySong[]): void;
  onCancel(): void;
}

type Mode = "text" | "attach";
type CopyState = { kind: "copied" | "failed"; prompt: string } | undefined;

const FOCUSABLE =
  "button:not(:disabled), input:not(:disabled), textarea:not(:disabled)";

const noError = (): string | undefined => undefined;
const noWarnings = (): string[] => [];
const noCopy = (): CopyState => undefined;
const noResult = (): AiReplyResult | undefined => undefined;
const noArea = (): HTMLTextAreaElement | null => null;
const noDoc = (): AiDocument | undefined => undefined;

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** Modal with the three steps of the AI conversion: source, prompt to copy, reply to paste. */
export function AiImportDialog({
  initial,
  pickDocument,
  onImport,
  onCancel,
}: AiImportDialogProps) {
  const t = useT();
  const titleId = useId();
  const groupName = useId();
  const promptId = useId();
  const replyId = useId();
  const promptArea = useRef(noArea());
  const { dialog, onKeyDown } = useDialogFocus(onCancel);
  const [mode, setMode] = useState<Mode>(
    initial === undefined ? "attach" : "text",
  );
  const [doc, setDoc] = useState(initial ?? noDoc());
  const [warnings, setWarnings] = useState(noWarnings);
  const [pickError, setPickError] = useState(noError);
  const [picking, setPicking] = useState(false);
  const [copy, setCopy] = useState(noCopy);
  const [reply, setReply] = useState("");
  const [result, setResult] = useState(noResult);

  const prompt = useMemo(() => {
    if (mode === "text") {
      return doc === undefined
        ? undefined
        : buildAiPrompt({
            mode: "text",
            text: doc.text,
            sourceName: doc.sourceName,
          });
    }
    return doc === undefined
      ? buildAiPrompt({ mode: "attach" })
      : buildAiPrompt({ mode: "attach", sourceName: doc.sourceName });
  }, [mode, doc]);

  const pick = async () => {
    setMode("text");
    setPickError(undefined);
    setPicking(true);
    try {
      const picked = await pickDocument();
      if (picked !== undefined) {
        setDoc({ sourceName: picked.sourceName, text: picked.text });
        setWarnings(picked.warnings);
      }
    } catch (reason) {
      setPickError(messageOf(reason));
    } finally {
      setPicking(false);
    }
  };

  const copyPrompt = async () => {
    if (prompt === undefined) return;
    try {
      if (navigator.clipboard === undefined) throw new Error("no clipboard");
      await navigator.clipboard.writeText(prompt);
      setCopy({ kind: "copied", prompt });
    } catch {
      const area = promptArea.current;
      area?.focus();
      area?.select();
      setCopy({ kind: "failed", prompt });
    }
  };

  const parse = () => setResult(parseAiReply(reply));

  /** Enabled controls in tab order: an unchecked radio is skipped, as the browser does. */
  const tabStops = (root: HTMLElement): HTMLElement[] =>
    [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) =>
        !(el instanceof HTMLInputElement && el.type === "radio" && !el.checked),
    );

  const onDialogKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") {
      onKeyDown(e);
      return;
    }
    const controls = tabStops(e.currentTarget);
    const first = controls[0];
    const last = controls[controls.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === e.currentTarget)) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first?.focus();
    }
  };

  const copyStatus =
    copy !== undefined && copy.prompt === prompt ? copy.kind : undefined;
  const songs = result?.songs ?? [];

  return (
    <div className={styles.backdrop} data-ui-chrome>
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={styles.dialog}
        data-testid="ai-import-dialog"
        onKeyDown={onDialogKeyDown}
      >
        <h2 id={titleId} className={styles.title}>
          {t("importWithAi")}
        </h2>
        <ol className={styles.steps}>
          <li className={styles.step}>
            <fieldset className={styles.fieldset}>
              <legend className={styles.heading}>{t("aiStepSource")}</legend>
              <div className={styles.option}>
                <label className={styles.choice}>
                  <input
                    type="radio"
                    name={groupName}
                    checked={mode === "text"}
                    data-testid="ai-source-document"
                    onChange={() => setMode("text")}
                  />
                  {t("aiSourceDocument")}
                </label>
                <button
                  type="button"
                  disabled={picking}
                  data-testid="ai-pick-document"
                  onClick={() => void pick()}
                >
                  {t("aiPickDocument")}
                </button>
                {doc !== undefined && (
                  <p className={styles.picked} data-testid="ai-picked">
                    <bdi>{doc.sourceName}</bdi> {t("separator")}{" "}
                    {t("aiCharCount", { count: doc.text.length })}
                  </p>
                )}
                {pickError !== undefined && (
                  <p
                    role="alert"
                    className={styles.error}
                    data-testid="ai-pick-error"
                  >
                    {pickError}
                  </p>
                )}
                {warnings.length > 0 && (
                  <ul className={styles.list} data-testid="ai-pick-warnings">
                    {warnings.map((w, i) => (
                      <li key={i} dir="auto">
                        {w}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <label className={styles.choice}>
                <input
                  type="radio"
                  name={groupName}
                  checked={mode === "attach"}
                  data-testid="ai-source-attach"
                  onChange={() => setMode("attach")}
                />
                {t("aiSourceAttach")}
              </label>
            </fieldset>
          </li>
          <li className={styles.step}>
            <label htmlFor={promptId} className={styles.heading}>
              {t("aiStepPrompt")}
            </label>
            {prompt === undefined ? (
              <p className={styles.hint} data-testid="ai-prompt-hint">
                {t("aiPromptHint")}
              </p>
            ) : (
              <textarea
                ref={promptArea}
                id={promptId}
                readOnly
                dir="ltr"
                spellCheck={false}
                aria-label={t("aiPromptLabel")}
                className={styles.prompt}
                value={prompt}
                data-testid="ai-prompt"
              />
            )}
            <div className={styles.row}>
              <button
                type="button"
                disabled={prompt === undefined}
                data-testid="ai-copy"
                onClick={() => void copyPrompt()}
              >
                {t("aiCopy")}
              </button>
              {copyStatus === "copied" && (
                <span role="status" data-testid="ai-copied">
                  {t("aiCopied")}
                </span>
              )}
              {copyStatus === "failed" && (
                <span role="status" data-testid="ai-copy-failed">
                  {t("aiCopyFailed")}
                </span>
              )}
            </div>
          </li>
          <li className={styles.step}>
            <label htmlFor={replyId} className={styles.heading}>
              {t("aiStepReply")}
            </label>
            <textarea
              id={replyId}
              dir="auto"
              spellCheck={false}
              aria-label={t("aiReplyLabel")}
              className={styles.reply}
              value={reply}
              data-testid="ai-reply"
              onChange={(e) => {
                setReply(e.target.value);
                setResult(undefined);
              }}
            />
            <div className={styles.row}>
              <button
                type="button"
                disabled={reply.trim() === ""}
                data-testid="ai-parse"
                onClick={parse}
              >
                {t("aiParse")}
              </button>
            </div>
            {result !== undefined && songs.length === 0 && (
              <p
                role="alert"
                className={styles.error}
                data-testid="ai-parse-error"
              >
                {t("aiParseError")}
              </p>
            )}
            {songs.length > 0 && (
              <>
                {result?.truncated === true && (
                  <p
                    role="status"
                    className={styles.hint}
                    data-testid="ai-truncated"
                  >
                    {t("aiTruncated")}
                  </p>
                )}
                <ul
                  className={styles.list}
                  aria-label={t("aiSongsFound")}
                  data-testid="ai-songs"
                >
                  {songs.map((s, i) => (
                    <li key={i} data-testid="ai-song">
                      <bdi>
                        {s.title !== undefined && s.title.trim() !== ""
                          ? s.title
                          : t("aiSongLabel", { n: i + 1 })}
                      </bdi>
                      {s.diagnostics.length > 0 && (
                        <>
                          {" "}
                          {t("separator")}{" "}
                          {t("diagnosticsCount", {
                            count: s.diagnostics.length,
                          })}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
                <div className={styles.row}>
                  <button
                    type="button"
                    data-testid="ai-review"
                    onClick={() => onImport(songs)}
                  >
                    {t("aiReviewSongs", { count: songs.length })}
                  </button>
                </div>
              </>
            )}
          </li>
        </ol>
        <div className={styles.actions}>
          <button type="button" data-testid="ai-cancel" onClick={onCancel}>
            {t("cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
