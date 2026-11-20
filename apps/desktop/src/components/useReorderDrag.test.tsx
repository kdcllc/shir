import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useReorderDrag } from "./useReorderDrag";

const IDS = ["a", "b", "c"] as const;
const ROW_HEIGHT = 100;

function Harness({
  onReorder,
}: {
  onReorder(ids: string[], movedId: string): void;
}) {
  const drag = useReorderDrag(IDS, onReorder);
  return (
    <ul>
      {IDS.map((id) => (
        <li
          key={id}
          data-testid={`row-${id}`}
          data-drop={drag.draggingId !== null ? drag.targetIndex : undefined}
          data-dragging={drag.draggingId === id ? "yes" : undefined}
          ref={(el) => {
            if (el) {
              const top = IDS.indexOf(id) * ROW_HEIGHT;
              el.getBoundingClientRect = () =>
                ({
                  top,
                  bottom: top + ROW_HEIGHT,
                  height: ROW_HEIGHT,
                }) as DOMRect;
            }
            drag.registerRow(id, el);
          }}
        >
          <button
            type="button"
            data-testid={`handle-${id}`}
            {...drag.handleProps(id)}
          >
            {id}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Dispatches a pointer event (jsdom has no PointerEvent constructor guarantee). */
function pointer(
  el: Element,
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  init: { clientY?: number; button?: number; pointerId?: number } = {},
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientY: init.clientY ?? 0,
    button: init.button ?? 0,
  });
  Object.defineProperty(event, "pointerId", { value: init.pointerId ?? 1 });
  fireEvent(el, event);
}

const handle = (id: string) => screen.getByTestId(`handle-${id}`);

function setup(dir?: "rtl" | "ltr") {
  const onReorder = vi.fn();
  render(
    <div dir={dir}>
      <Harness onReorder={onReorder} />
    </div>,
  );
  return { onReorder };
}

describe("useReorderDrag", () => {
  it("dropping the first row below the last row's midpoint moves it to the end", () => {
    const { onReorder } = setup();
    pointer(handle("a"), "pointerdown");
    pointer(handle("a"), "pointermove", { clientY: 251 });
    pointer(handle("a"), "pointerup", { clientY: 251 });
    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onReorder).toHaveBeenCalledWith(["b", "c", "a"], "a");
  });

  it("the midpoint itself does not pass the row (boundary 250 vs 251)", () => {
    const { onReorder } = setup();
    pointer(handle("a"), "pointerdown");
    pointer(handle("a"), "pointermove", { clientY: 250 });
    pointer(handle("a"), "pointerup");
    expect(onReorder).toHaveBeenCalledWith(["b", "a", "c"], "a");
  });

  it("moves the last row to the front when dragged above the first midpoint", () => {
    const { onReorder } = setup();
    pointer(handle("c"), "pointerdown");
    pointer(handle("c"), "pointermove", { clientY: 10 });
    pointer(handle("c"), "pointerup");
    expect(onReorder).toHaveBeenCalledWith(["c", "a", "b"], "c");
  });

  it("moves the middle row up by one", () => {
    const { onReorder } = setup();
    pointer(handle("b"), "pointerdown");
    pointer(handle("b"), "pointermove", { clientY: 40 });
    pointer(handle("b"), "pointerup");
    expect(onReorder).toHaveBeenCalledWith(["b", "a", "c"], "b");
  });

  it.each(["ltr", "rtl"] as const)(
    "reorders the same way in a dir=%s container",
    (dir) => {
      const { onReorder } = setup(dir);
      pointer(handle("a"), "pointerdown");
      pointer(handle("a"), "pointermove", { clientY: 251 });
      pointer(handle("a"), "pointerup");
      expect(onReorder).toHaveBeenCalledWith(["b", "c", "a"], "a");
    },
  );

  it("captures the pointer on pointerdown and releases it on pointerup", () => {
    setup();
    const el = handle("a");
    const set = vi.fn();
    const release = vi.fn();
    el.setPointerCapture = set;
    el.releasePointerCapture = release;
    pointer(el, "pointerdown", { pointerId: 7 });
    expect(set).toHaveBeenCalledWith(7);
    pointer(el, "pointerup", { pointerId: 7 });
    expect(release).toHaveBeenCalledWith(7);
  });

  it("shows the target index and dragging row while a drag runs", () => {
    setup();
    expect(screen.getByTestId("row-a")).not.toHaveAttribute("data-dragging");
    pointer(handle("a"), "pointerdown");
    expect(screen.getByTestId("row-a")).toHaveAttribute("data-dragging", "yes");
    expect(screen.getByTestId("row-a")).toHaveAttribute("data-drop", "0");
    pointer(handle("a"), "pointermove", { clientY: 251 });
    expect(screen.getByTestId("row-b")).toHaveAttribute("data-drop", "2");
    pointer(handle("a"), "pointerup");
    expect(screen.getByTestId("row-a")).not.toHaveAttribute("data-dragging");
    expect(screen.getByTestId("row-b")).not.toHaveAttribute("data-drop");
  });

  it("Escape aborts: no reorder, and the later pointerup is ignored", () => {
    const { onReorder } = setup();
    pointer(handle("a"), "pointerdown");
    pointer(handle("a"), "pointermove", { clientY: 251 });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByTestId("row-a")).not.toHaveAttribute("data-dragging");
    pointer(handle("a"), "pointerup");
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("pointercancel aborts without a reorder", () => {
    const { onReorder } = setup();
    pointer(handle("a"), "pointerdown");
    pointer(handle("a"), "pointermove", { clientY: 251 });
    pointer(handle("a"), "pointercancel");
    expect(screen.getByTestId("row-a")).not.toHaveAttribute("data-dragging");
    pointer(handle("a"), "pointerup");
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("makes no call when the order is unchanged", () => {
    const { onReorder } = setup();
    pointer(handle("b"), "pointerdown");
    pointer(handle("b"), "pointermove", { clientY: 150 });
    pointer(handle("b"), "pointerup");
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("makes no call for a press without movement", () => {
    const { onReorder } = setup();
    pointer(handle("a"), "pointerdown");
    pointer(handle("a"), "pointerup");
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("makes no call after dragging away and back to the start", () => {
    const { onReorder } = setup();
    pointer(handle("a"), "pointerdown");
    pointer(handle("a"), "pointermove", { clientY: 251 });
    pointer(handle("a"), "pointermove", { clientY: 10 });
    pointer(handle("a"), "pointerup");
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("ignores a non-primary button", () => {
    const { onReorder } = setup();
    pointer(handle("a"), "pointerdown", { button: 2 });
    expect(screen.getByTestId("row-a")).not.toHaveAttribute("data-dragging");
    pointer(handle("a"), "pointermove", { clientY: 251 });
    pointer(handle("a"), "pointerup");
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("a second drag works after an aborted one", () => {
    const { onReorder } = setup();
    pointer(handle("a"), "pointerdown");
    fireEvent.keyDown(window, { key: "Escape" });
    pointer(handle("c"), "pointerdown");
    pointer(handle("c"), "pointermove", { clientY: 10 });
    pointer(handle("c"), "pointerup");
    expect(onReorder).toHaveBeenCalledWith(["c", "a", "b"], "c");
  });
});
