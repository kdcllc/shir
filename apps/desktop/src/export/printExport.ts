import type { ExportDocument } from "chord-core";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { exportFileName } from "./fileName";
import { PrintDocument } from "./PrintDocument";
import type { ExportLabels, ExportMeta } from "./types";

const CONTAINER_ATTR = "data-print-container";
const OVERLAP_WAIT_MS = 2000;
const POLL_MS = 16;

let activeCleanup: (() => void) | undefined;

function removeStale(): void {
  activeCleanup?.();
  activeCleanup = undefined;
  for (const el of document.querySelectorAll(`[${CONTAINER_ATTR}]`)) {
    el.remove();
  }
  delete document.documentElement.dataset.printing;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, POLL_MS);
    }
  });

/** True once every song body in the print root finished its B4 overlap pass. */
function overlapDone(container: HTMLElement, expected: number): boolean {
  const songs = container.querySelectorAll("[data-print-song] [data-song]");
  if (songs.length < expected) return false;
  return Array.from(songs).every(
    (el) => Number(el.getAttribute("data-overlap-pass") ?? "0") >= 1,
  );
}

/**
 * Prints an export document through the webview's print dialog (also used for "Save as PDF").
 * Resolves once `window.print()` returned; cleanup follows `afterprint` (or, for webviews that
 * never fire it, the first user input after `print()` returned, since the dialog is modal).
 */
export async function printExport(
  doc: ExportDocument,
  opts: {
    cover: boolean;
    labels: ExportLabels;
    meta: ExportMeta;
    mode: "print" | "pdf";
  },
): Promise<void> {
  removeStale();

  const previousTitle = document.title;
  const container = document.createElement("div");
  container.setAttribute(CONTAINER_ATTR, "");
  container.setAttribute("aria-hidden", "true");
  document.body.appendChild(container);
  const root = createRoot(container);

  let done = false;
  const listeners: (() => void)[] = [];
  const cleanup = (): void => {
    if (done) return;
    done = true;
    for (const off of listeners) off();
    root.unmount();
    container.remove();
    delete document.documentElement.dataset.printing;
    if (opts.mode === "pdf") document.title = previousTitle;
    if (activeCleanup === cleanup) activeCleanup = undefined;
  };
  activeCleanup = cleanup;

  flushSync(() => {
    root.render(
      createElement(PrintDocument, {
        doc,
        cover: opts.cover,
        labels: opts.labels,
        meta: opts.meta,
      }),
    );
  });
  document.documentElement.dataset.printing = "export";
  if (opts.mode === "pdf") {
    document.title = exportFileName(doc.title, "pdf").replace(/\.pdf$/u, "");
  }

  const onAfterPrint = (): void => cleanup();
  window.addEventListener("afterprint", onAfterPrint);
  listeners.push(() => window.removeEventListener("afterprint", onAfterPrint));

  try {
    await document.fonts?.ready;
    const deadline = Date.now() + OVERLAP_WAIT_MS;
    while (!overlapDone(container, doc.songs.length) && Date.now() < deadline) {
      await sleep(POLL_MS);
    }
    await nextFrame();
    await nextFrame();
    if (done) return;
    window.print();
  } catch (error) {
    cleanup();
    throw error;
  }

  if (done) return;
  const onInput = (): void => cleanup();
  document.addEventListener("pointerdown", onInput, { once: true });
  document.addEventListener("keydown", onInput, { once: true });
  listeners.push(() => {
    document.removeEventListener("pointerdown", onInput);
    document.removeEventListener("keydown", onInput);
  });
}
