import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { i18n } from "../i18n";
import { STRINGS } from "../strings";
import type { Setlist, SetlistItem } from "../storage";
import { SetlistEditor } from "./SetlistEditor";
import type { SetlistEditorProps } from "./SetlistEditor";

const item = (id: string, over: Partial<SetlistItem> = {}): SetlistItem => ({
  id,
  songId: `song-${id}`,
  position: 0,
  transpose: 0,
  capo: null,
  title: `Title ${id}`,
  artist: null,
  key: null,
  songCapo: null,
  language: "en",
  ...over,
});

const setlistOf = (items: SetlistItem[], name = "Friday"): Setlist => ({
  id: "sl",
  name,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  items,
});

const ABC = [item("a"), item("b"), item("c")];

function makeHandlers() {
  return {
    onReorder: vi.fn<SetlistEditorProps["onReorder"]>(() =>
      Promise.resolve(true),
    ),
    onMove: vi.fn<SetlistEditorProps["onMove"]>(() => Promise.resolve(true)),
    onTranspose: vi.fn(),
    onCapo: vi.fn(),
    onRemove: vi.fn(),
    onOpenSong: vi.fn(),
    onPrint: vi.fn(),
    onExportPdf: vi.fn(),
    onExportWord: vi.fn(),
  };
}

function setup(
  items: SetlistItem[] = ABC,
  over: { busy?: boolean; dir?: "rtl" | "ltr"; name?: string } = {},
) {
  const handlers = makeHandlers();
  const element = (list: Setlist) => (
    <div dir={over.dir}>
      <SetlistEditor setlist={list} busy={over.busy ?? false} {...handlers} />
    </div>
  );
  const view = render(element(setlistOf(items, over.name)));
  return {
    ...handlers,
    rerenderBusy: (busy: boolean) =>
      view.rerender(
        <div dir={over.dir}>
          <SetlistEditor
            setlist={setlistOf(items, over.name)}
            busy={busy}
            {...handlers}
          />
        </div>,
      ),
    rerender: (next: SetlistItem[]) => view.rerender(element(setlistOf(next))),
  };
}

const entries = () => screen.getAllByTestId("setlist-entry");
const entry = (i: number) => entries()[i]!;
const inEntry = (i: number, id: string) => within(entry(i)).getByTestId(id);

/** Row rectangles: row i spans [i*100, i*100+100). */
function mockRects() {
  entries().forEach((row, i) => {
    row.getBoundingClientRect = () =>
      ({ top: i * 100, bottom: i * 100 + 100, height: 100 }) as DOMRect;
  });
}

function pointer(
  el: Element,
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  clientY = 0,
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientY,
    button: 0,
  });
  Object.defineProperty(event, "pointerId", { value: 1 });
  fireEvent(el, event);
}

describe("SetlistEditor header and list", () => {
  it("shows the name in a bdi inside the heading and the three export buttons", () => {
    const h = setup(ABC, { name: "שבת" });
    const heading = screen.getByRole("heading", { level: 2 });
    expect(within(heading).getByText("שבת").tagName).toBe("BDI");
    fireEvent.click(screen.getByTestId("setlist-print"));
    fireEvent.click(screen.getByTestId("setlist-export-pdf"));
    fireEvent.click(screen.getByTestId("setlist-export-word"));
    expect(h.onPrint).toHaveBeenCalledTimes(1);
    expect(h.onExportPdf).toHaveBeenCalledTimes(1);
    expect(h.onExportWord).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("setlist-print")).toHaveTextContent(
      STRINGS.print,
    );
    expect(screen.getByTestId("setlist-export-pdf")).toHaveTextContent(
      STRINGS.exportPdf,
    );
    expect(screen.getByTestId("setlist-export-word")).toHaveTextContent(
      STRINGS.exportWord,
    );
  });

  it("renders an ordered list with the position, title and artist", () => {
    setup([item("a", { artist: "Some Artist" }), item("b")]);
    const list = screen.getByTestId("setlist-entries");
    expect(list.tagName).toBe("OL");
    expect(inEntry(0, "setlist-entry-position")).toHaveTextContent("1");
    expect(inEntry(1, "setlist-entry-position")).toHaveTextContent("2");
    const title = inEntry(0, "setlist-entry-title");
    expect(within(title).getByText("Title a").tagName).toBe("BDI");
    expect(within(entry(0)).getByText("Some Artist")).toHaveAttribute(
      "dir",
      "auto",
    );
    expect(within(entry(1)).queryByText("Some Artist")).toBeNull();
  });

  it("keys entries by item id: DOM nodes follow their item when the order changes", () => {
    const h = setup();
    const [a, b, c] = entries();
    h.rerender([ABC[1]!, ABC[2]!, ABC[0]!]);
    expect(entries()).toEqual([b, c, a]);
  });

  it("opens the song of the clicked title", () => {
    const h = setup();
    fireEvent.click(inEntry(1, "setlist-entry-title"));
    expect(h.onOpenSong).toHaveBeenCalledWith("song-b", "b");
  });

  it("shows the empty state for a setlist without entries", () => {
    setup([]);
    expect(screen.getByTestId("setlist-entries-empty")).toHaveTextContent(
      STRINGS.setlistEmpty,
    );
    expect(screen.queryByTestId("setlist-entries")).toBeNull();
  });

  it("every control carries data-ui-chrome and entries do not use HTML5 drag", () => {
    setup();
    for (const el of [
      ...screen.getAllByRole("button"),
      ...screen.getAllByRole("combobox"),
    ])
      expect(el.closest("[data-ui-chrome]"), el.outerHTML).not.toBeNull();
    for (const row of entries()) expect(row).not.toHaveAttribute("draggable");
  });

  it("disables every edit control while busy", () => {
    setup(ABC, { busy: true });
    for (const id of [
      "setlist-entry-handle",
      "setlist-entry-transpose-down",
      "setlist-entry-transpose-up",
      "setlist-entry-capo",
      "setlist-entry-up",
      "setlist-entry-down",
      "setlist-entry-remove",
      "setlist-print",
      "setlist-export-pdf",
      "setlist-export-word",
    ])
      for (const el of screen.getAllByTestId(id)) expect(el, id).toBeDisabled();
  });
});

describe("SetlistEditor key, transpose and capo", () => {
  it("shows the effective sounding key only when the song has a key", () => {
    setup([item("a", { key: "C", transpose: 2 }), item("b")]);
    expect(inEntry(0, "setlist-entry-key")).toHaveTextContent("D");
    expect(inEntry(0, "setlist-entry-key").tagName).toBe("BDI");
    expect(within(entry(1)).queryByTestId("setlist-entry-key")).toBeNull();
  });

  it("transposes by one semitone either way", () => {
    const h = setup([item("a", { transpose: 3 })]);
    expect(inEntry(0, "setlist-entry-transpose-value")).toHaveTextContent("+3");
    fireEvent.click(inEntry(0, "setlist-entry-transpose-up"));
    expect(h.onTranspose).toHaveBeenLastCalledWith("a", 4);
    fireEvent.click(inEntry(0, "setlist-entry-transpose-down"));
    expect(h.onTranspose).toHaveBeenLastCalledWith("a", 2);
  });

  it("clamps to -11..+11: the buttons disable at the bounds, one step inside still works", () => {
    const h = setup([
      item("hi", { transpose: 11 }),
      item("lo", { transpose: -11 }),
      item("hi1", { transpose: 10 }),
      item("lo1", { transpose: -10 }),
    ]);
    expect(inEntry(0, "setlist-entry-transpose-up")).toBeDisabled();
    expect(inEntry(0, "setlist-entry-transpose-down")).toBeEnabled();
    expect(inEntry(1, "setlist-entry-transpose-down")).toBeDisabled();
    expect(inEntry(1, "setlist-entry-transpose-up")).toBeEnabled();
    fireEvent.click(inEntry(0, "setlist-entry-transpose-up"));
    fireEvent.click(inEntry(1, "setlist-entry-transpose-down"));
    expect(h.onTranspose).not.toHaveBeenCalled();
    fireEvent.click(inEntry(2, "setlist-entry-transpose-up"));
    expect(h.onTranspose).toHaveBeenLastCalledWith("hi1", 11);
    fireEvent.click(inEntry(3, "setlist-entry-transpose-down"));
    expect(h.onTranspose).toHaveBeenLastCalledWith("lo1", -11);
  });

  it("the capo select offers 'Song default (N)' (null) plus 0..12", () => {
    const h = setup([item("a", { capo: 2, songCapo: 5 })]);
    const select = inEntry(0, "setlist-entry-capo") as HTMLSelectElement;
    const options = [...select.options];
    expect(options.map((o) => o.value)).toEqual([
      "",
      ...Array.from({ length: 13 }, (_, i) => String(i)),
    ]);
    expect(options[0]).toHaveTextContent("Song default (5)");
    expect(select.value).toBe("2");
    fireEvent.change(select, { target: { value: "" } });
    expect(h.onCapo).toHaveBeenLastCalledWith("a", null);
    fireEvent.change(select, { target: { value: "7" } });
    expect(h.onCapo).toHaveBeenLastCalledWith("a", 7);
  });

  it("capo 0 is a real choice, distinct from the song default", () => {
    const h = setup([item("a", { capo: null, songCapo: 3 })]);
    const select = inEntry(0, "setlist-entry-capo") as HTMLSelectElement;
    expect(select.value).toBe("");
    fireEvent.change(select, { target: { value: "0" } });
    expect(h.onCapo).toHaveBeenLastCalledWith("a", 0);
  });

  it("adds the song's own capo to the options when it is 13..24", () => {
    setup([item("a", { songCapo: 15 }), item("b", { songCapo: 12 })]);
    const values = (i: number) =>
      [...(inEntry(i, "setlist-entry-capo") as HTMLSelectElement).options].map(
        (o) => o.value,
      );
    expect(values(0)).toHaveLength(15);
    expect(values(0)[14]).toBe("15");
    expect(values(1)).toHaveLength(14);
  });

  it("removes the clicked entry", () => {
    const h = setup();
    fireEvent.click(inEntry(2, "setlist-entry-remove"));
    expect(h.onRemove).toHaveBeenCalledWith("c");
  });
});

describe("SetlistEditor move", () => {
  it("disables Move up on the first and Move down on the last entry", () => {
    setup();
    expect(inEntry(0, "setlist-entry-up")).toBeDisabled();
    expect(inEntry(0, "setlist-entry-down")).toBeEnabled();
    expect(inEntry(1, "setlist-entry-up")).toBeEnabled();
    expect(inEntry(1, "setlist-entry-down")).toBeEnabled();
    expect(inEntry(2, "setlist-entry-up")).toBeEnabled();
    expect(inEntry(2, "setlist-entry-down")).toBeDisabled();
  });

  it("a single entry has both move buttons disabled", () => {
    setup([item("a")]);
    expect(inEntry(0, "setlist-entry-up")).toBeDisabled();
    expect(inEntry(0, "setlist-entry-down")).toBeDisabled();
  });

  it("the buttons call onMove with -1 and +1", () => {
    const h = setup();
    fireEvent.click(inEntry(1, "setlist-entry-up"));
    expect(h.onMove).toHaveBeenLastCalledWith("b", -1);
    fireEvent.click(inEntry(1, "setlist-entry-down"));
    expect(h.onMove).toHaveBeenLastCalledWith("b", 1);
  });

  it("announces the move in a polite live region", async () => {
    setup();
    const live = screen.getByTestId("setlist-announce");
    expect(live).toHaveAttribute("aria-live", "polite");
    fireEvent.click(inEntry(1, "setlist-entry-down"));
    await waitFor(() =>
      expect(live).toHaveTextContent(
        i18n.t("movedAnnounce", { title: "Title b", n: 3 }),
      ),
    );
    expect(live.textContent).toBe("Moved ⁨Title b⁩ to position 3");
  });

  it("a failed move announces nothing", async () => {
    const h = setup();
    h.onMove.mockResolvedValue(false);
    fireEvent.click(inEntry(1, "setlist-entry-down"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(h.onMove).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("setlist-announce")).toBeEmptyDOMElement();
  });

  it("a rejected move announces nothing and raises no unhandled rejection", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const h = setup();
      h.onMove.mockRejectedValue(new Error("storage down"));
      fireEvent.click(inEntry(1, "setlist-entry-down"));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(screen.getByTestId("setlist-announce")).toBeEmptyDOMElement();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("a failed move does not move focus on a later re-render", async () => {
    const h = setup();
    h.onMove.mockResolvedValue(false);
    entry(0).focus();
    fireEvent.keyDown(entry(0), { key: "ArrowDown", altKey: true });
    await act(async () => {
      await Promise.resolve();
    });
    entry(0).blur();
    act(() => h.rerender([ABC[0]!, ABC[1]!, ABC[2]!]));
    expect(entry(0)).not.toHaveFocus();
    expect(entry(1)).not.toHaveFocus();
  });

  it("Alt+ArrowDown / Alt+ArrowUp on a row call onMove", () => {
    const h = setup();
    fireEvent.keyDown(entry(1), { key: "ArrowDown", altKey: true });
    expect(h.onMove).toHaveBeenLastCalledWith("b", 1);
    fireEvent.keyDown(entry(1), { key: "ArrowUp", altKey: true });
    expect(h.onMove).toHaveBeenLastCalledWith("b", -1);
    expect(h.onMove).toHaveBeenCalledTimes(2);
  });

  it("Alt+Arrow from the capo select does not move the row or get prevented", () => {
    const h = setup();
    const capo = inEntry(1, "setlist-entry-capo");
    const notPrevented = fireEvent.keyDown(capo, {
      key: "ArrowDown",
      altKey: true,
    });
    expect(notPrevented).toBe(true);
    expect(h.onMove).not.toHaveBeenCalled();
    fireEvent.keyDown(entry(1), { key: "ArrowDown", altKey: true });
    expect(h.onMove).toHaveBeenCalledWith("b", 1);
  });

  it("plain arrows do nothing; the ends do not move out of range", () => {
    const h = setup();
    fireEvent.keyDown(entry(1), { key: "ArrowDown" });
    fireEvent.keyDown(entry(0), { key: "ArrowUp", altKey: true });
    fireEvent.keyDown(entry(2), { key: "ArrowDown", altKey: true });
    expect(h.onMove).not.toHaveBeenCalled();
  });

  it("Alt+Arrow does nothing while busy", () => {
    const h = setup(ABC, { busy: true });
    fireEvent.keyDown(entry(1), { key: "ArrowDown", altKey: true });
    expect(h.onMove).not.toHaveBeenCalled();
  });

  it("focus stays on the moved row after the parent re-renders the new order", () => {
    function Parent() {
      const [items, setItems] = useState(ABC);
      return (
        <>
          <button type="button" data-testid="outside">
            outside
          </button>
          <SetlistEditor
            setlist={setlistOf(items)}
            busy={false}
            {...makeHandlers()}
            onMove={(id, delta) => {
              // Focus leaves the row before the parent re-renders the new order.
              screen.getByTestId("outside").focus();
              setItems((current) => {
                const next = [...current];
                const from = next.findIndex((x) => x.id === id);
                const [moved] = next.splice(from, 1);
                next.splice(from + delta, 0, moved!);
                return next;
              });
              return Promise.resolve(true);
            }}
          />
        </>
      );
    }
    render(<Parent />);
    const rowA = entry(0);
    rowA.focus();
    fireEvent.keyDown(rowA, { key: "ArrowDown", altKey: true });
    expect(within(entry(1)).getByText("Title a")).toBeInTheDocument();
    expect(entry(1)).toBe(rowA);
    expect(rowA).toHaveFocus();
    fireEvent.keyDown(rowA, { key: "ArrowDown", altKey: true });
    expect(entry(2)).toBe(rowA);
    expect(rowA).toHaveFocus();
  });

  it("refocuses even when the move arrives with a later render", () => {
    const h = setup();
    entry(0).focus();
    fireEvent.keyDown(entry(0), { key: "ArrowDown", altKey: true });
    entry(0).blur();
    act(() => h.rerender([ABC[1]!, ABC[0]!, ABC[2]!]));
    expect(entry(1)).toHaveFocus();
  });
});

describe("SetlistEditor drag and drop", () => {
  const handle = (i: number) => inEntry(i, "setlist-entry-handle");

  it.each(["ltr", "rtl"] as const)(
    "dragging the first row to the end calls onReorder (dir=%s)",
    (dir) => {
      const h = setup(ABC, { dir });
      mockRects();
      pointer(handle(0), "pointerdown", 50);
      pointer(handle(0), "pointermove", 251);
      pointer(handle(0), "pointerup", 251);
      expect(h.onReorder).toHaveBeenCalledTimes(1);
      expect(h.onReorder).toHaveBeenCalledWith(["b", "c", "a"]);
      expect(h.onMove).not.toHaveBeenCalled();
    },
  );

  it("dragging the last row to the top calls onReorder with the full order", () => {
    const h = setup();
    mockRects();
    pointer(handle(2), "pointerdown", 250);
    pointer(handle(2), "pointermove", 10);
    pointer(handle(2), "pointerup", 10);
    expect(h.onReorder).toHaveBeenCalledWith(["c", "a", "b"]);
  });

  it("captures the pointer on the handle", () => {
    setup();
    mockRects();
    const set = vi.fn();
    handle(0).setPointerCapture = set;
    pointer(handle(0), "pointerdown");
    expect(set).toHaveBeenCalledWith(1);
  });

  it("shows a drop indicator at the target while dragging and removes it after", () => {
    setup();
    mockRects();
    pointer(handle(0), "pointerdown", 50);
    pointer(handle(0), "pointermove", 251);
    expect(entry(2)).toHaveAttribute("data-drop", "after");
    expect(entry(0)).toHaveAttribute("data-dragging", "true");
    pointer(handle(0), "pointermove", 249);
    expect(entry(2)).toHaveAttribute("data-drop", "before");
    expect(entry(1)).not.toHaveAttribute("data-drop");
    pointer(handle(0), "pointerup", 249);
    for (const row of entries()) {
      expect(row).not.toHaveAttribute("data-drop");
      expect(row).not.toHaveAttribute("data-dragging");
    }
  });

  it("Escape aborts the drag with no call", () => {
    const h = setup();
    mockRects();
    pointer(handle(0), "pointerdown", 50);
    pointer(handle(0), "pointermove", 251);
    fireEvent.keyDown(window, { key: "Escape" });
    pointer(handle(0), "pointerup", 251);
    expect(h.onReorder).not.toHaveBeenCalled();
    expect(entry(2)).not.toHaveAttribute("data-drop");
  });

  it("pointercancel aborts the drag with no call", () => {
    const h = setup();
    mockRects();
    pointer(handle(0), "pointerdown", 50);
    pointer(handle(0), "pointermove", 251);
    pointer(handle(0), "pointercancel", 251);
    pointer(handle(0), "pointerup", 251);
    expect(h.onReorder).not.toHaveBeenCalled();
  });

  it("an unchanged order makes no call", () => {
    const h = setup();
    mockRects();
    pointer(handle(1), "pointerdown", 150);
    pointer(handle(1), "pointermove", 160);
    pointer(handle(1), "pointerup", 160);
    expect(h.onReorder).not.toHaveBeenCalled();
  });

  it("announces a drop with the new position", async () => {
    setup();
    mockRects();
    pointer(handle(0), "pointerdown", 50);
    pointer(handle(0), "pointermove", 251);
    pointer(handle(0), "pointerup", 251);
    await waitFor(() =>
      expect(screen.getByTestId("setlist-announce").textContent).toBe(
        "Moved ⁨Title a⁩ to position 3",
      ),
    );
  });

  it("a failed reorder announces nothing", async () => {
    const h = setup();
    h.onReorder.mockResolvedValue(false);
    mockRects();
    pointer(handle(0), "pointerdown", 50);
    pointer(handle(0), "pointermove", 251);
    pointer(handle(0), "pointerup", 251);
    await act(async () => {
      await Promise.resolve();
    });
    expect(h.onReorder).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("setlist-announce")).toBeEmptyDOMElement();
  });

  it("a drop after the editor became busy calls no onReorder and announces nothing", async () => {
    const drop = async (busyAtDrop: boolean) => {
      const h = setup();
      mockRects();
      pointer(handle(0), "pointerdown", 50);
      pointer(handle(0), "pointermove", 251);
      if (busyAtDrop) {
        h.rerenderBusy(true);
        mockRects();
      }
      pointer(handle(0), "pointerup", 251);
      await act(async () => {
        await Promise.resolve();
      });
      return h;
    };
    const idle = await drop(false);
    expect(idle.onReorder).toHaveBeenCalledTimes(1);
    cleanup();
    const busy = await drop(true);
    expect(busy.onReorder).not.toHaveBeenCalled();
    expect(screen.getByTestId("setlist-announce")).toBeEmptyDOMElement();
  });
});
