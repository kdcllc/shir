import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { docOf, entry, LABELS, META } from "./testSupport";

vi.mock("./PrintDocument", () => ({
  PrintDocument: () => (
    <div data-print-root="">
      <section data-print-song="">
        <div data-song="" data-overlap-pass="0" />
      </section>
    </div>
  ),
}));

import { printExport } from "./printExport";

const doc = docOf("רשימת/שירים", [entry("he_niqqud")]);
const base = { cover: false, labels: LABELS, meta: META };

let printSpy: ReturnType<typeof vi.fn>;
let appRoot: HTMLElement;

const printRoot = (): Element | null =>
  document.querySelector("[data-print-root]");
const containers = (): NodeListOf<Element> =>
  document.querySelectorAll("[data-print-container]");

/** Marks every song body in the print root as having finished its overlap pass. */
function finishOverlap(): void {
  for (const el of document.querySelectorAll("[data-song]")) {
    el.setAttribute("data-overlap-pass", "1");
  }
}

/** Runs printExport with the pass already done and lets the two frames elapse. */
async function runPrint(mode: "print" | "pdf" = "print"): Promise<void> {
  const p = printExport(doc, { ...base, mode });
  await vi.advanceTimersByTimeAsync(0);
  finishOverlap();
  await vi.advanceTimersByTimeAsync(200);
  await p;
}

beforeEach(() => {
  vi.useFakeTimers();
  appRoot = document.createElement("div");
  appRoot.id = "root";
  appRoot.innerHTML = "<p>app</p>";
  document.body.appendChild(appRoot);
  printSpy = vi.fn();
  window.print = printSpy as unknown as typeof window.print;
  document.title = "Shir";
});

afterEach(() => {
  window.dispatchEvent(new Event("afterprint"));
  vi.useRealTimers();
  appRoot.remove();
  for (const el of containers()) el.remove();
  delete document.documentElement.dataset.printing;
});

describe("printExport", () => {
  it("mounts the print root as a hidden sibling of #root while window.print runs", async () => {
    let during: Record<string, unknown> = {};
    printSpy.mockImplementation(() => {
      const container = document.querySelector("[data-print-container]");
      during = {
        root: printRoot() !== null,
        parent: container?.parentElement === document.body,
        aria: container?.getAttribute("aria-hidden"),
        printing: document.documentElement.dataset.printing,
        appHtml: appRoot.innerHTML,
        sibling: container?.previousElementSibling === appRoot,
      };
    });
    await runPrint();
    expect(during).toEqual({
      root: true,
      parent: true,
      aria: "true",
      printing: "export",
      appHtml: "<p>app</p>",
      sibling: true,
    });
  });

  it("waits for the overlap pass and prints once it is done", async () => {
    const p = printExport(doc, { ...base, mode: "print" });
    await vi.advanceTimersByTimeAsync(500);
    expect(printSpy).not.toHaveBeenCalled();
    finishOverlap();
    await vi.advanceTimersByTimeAsync(100);
    await p;
    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it("prints anyway after the 2 s cap when the pass never finishes", async () => {
    const p = printExport(doc, { ...base, mode: "print" });
    await vi.advanceTimersByTimeAsync(1900);
    expect(printSpy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(400);
    await p;
    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it("waits for document.fonts.ready before printing", async () => {
    let resolveFonts: () => void = () => undefined;
    const ready = new Promise<void>((r) => {
      resolveFonts = r;
    });
    Object.defineProperty(document, "fonts", {
      value: { ready },
      configurable: true,
    });
    try {
      const p = printExport(doc, { ...base, mode: "print" });
      await vi.advanceTimersByTimeAsync(0);
      finishOverlap();
      await vi.advanceTimersByTimeAsync(500);
      expect(printSpy).not.toHaveBeenCalled();
      resolveFonts();
      await vi.advanceTimersByTimeAsync(200);
      await p;
      expect(printSpy).toHaveBeenCalledTimes(1);
    } finally {
      delete (document as unknown as { fonts?: unknown }).fonts;
    }
  });

  it("waits for two animation frames before printing", async () => {
    const queue: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      queue.push(cb);
      return queue.length;
    });
    try {
      const p = printExport(doc, { ...base, mode: "print" });
      await vi.advanceTimersByTimeAsync(0);
      finishOverlap();
      await vi.advanceTimersByTimeAsync(100);
      expect(queue).toHaveLength(1);
      expect(printSpy).not.toHaveBeenCalled();
      queue.shift()?.(0);
      await vi.advanceTimersByTimeAsync(0);
      expect(queue).toHaveLength(1);
      expect(printSpy).not.toHaveBeenCalled();
      queue.shift()?.(0);
      await vi.advanceTimersByTimeAsync(0);
      await p;
      expect(printSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("cleans up on afterprint", async () => {
    await runPrint();
    expect(printRoot()).not.toBeNull();
    window.dispatchEvent(new Event("afterprint"));
    expect(printRoot()).toBeNull();
    expect(containers()).toHaveLength(0);
    expect(document.documentElement.dataset.printing).toBeUndefined();
    expect(appRoot.innerHTML).toBe("<p>app</p>");
  });

  it("falls back to cleaning up on the first pointerdown after print returned, not before", async () => {
    printSpy.mockImplementation(() => {
      document.dispatchEvent(new Event("pointerdown"));
      document.dispatchEvent(new Event("keydown"));
      expect(printRoot()).not.toBeNull();
    });
    await runPrint();
    expect(printRoot()).not.toBeNull();
    document.dispatchEvent(new Event("pointerdown"));
    expect(printRoot()).toBeNull();
    expect(document.documentElement.dataset.printing).toBeUndefined();
  });

  it("falls back to cleaning up on keydown after print returned", async () => {
    await runPrint();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(printRoot()).toBeNull();
  });

  it("cleans up idempotently (a late input event does not touch later state)", async () => {
    await runPrint("pdf");
    window.dispatchEvent(new Event("afterprint"));
    expect(document.title).toBe("Shir");
    document.title = "changed later";
    document.dispatchEvent(new Event("pointerdown"));
    window.dispatchEvent(new Event("afterprint"));
    expect(document.title).toBe("changed later");
    expect(printRoot()).toBeNull();
  });

  it("removes a stale print root left by an earlier call", async () => {
    await runPrint();
    const first = document.querySelector("[data-print-container]");
    await runPrint();
    expect(first?.isConnected).toBe(false);
    expect(containers()).toHaveLength(1);
    expect(document.documentElement.dataset.printing).toBe("export");
  });

  it("sets the document title for pdf only and restores it", async () => {
    let titleDuringPdf = "";
    printSpy.mockImplementation(() => {
      titleDuringPdf = document.title;
    });
    await runPrint("pdf");
    expect(titleDuringPdf).toBe("רשימת-שירים");
    expect(document.title).toBe(titleDuringPdf);
    window.dispatchEvent(new Event("afterprint"));
    expect(document.title).toBe("Shir");

    let titleDuringPrint = "";
    printSpy.mockImplementation(() => {
      titleDuringPrint = document.title;
    });
    await runPrint("print");
    expect(titleDuringPrint).toBe("Shir");
  });

  it("cleans up immediately and rethrows when window.print throws", async () => {
    printSpy.mockImplementation(() => {
      throw new Error("no printer");
    });
    const p = printExport(doc, { ...base, mode: "pdf" });
    const settled = p.then(
      () => "ok",
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(0);
    finishOverlap();
    await vi.advanceTimersByTimeAsync(200);
    const result = await settled;
    expect((result as Error).message).toBe("no printer");
    expect(printRoot()).toBeNull();
    expect(containers()).toHaveLength(0);
    expect(document.documentElement.dataset.printing).toBeUndefined();
    expect(document.title).toBe("Shir");
  });
});
