import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ViewControls, type ViewControlsProps } from "./ViewControls";

const OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

function setup(over: Partial<ViewControlsProps> = {}) {
  const props: ViewControlsProps = {
    transpose: 0,
    capo: 0,
    capoOptions: OPTIONS,
    onTranspose: vi.fn(),
    onCapo: vi.fn(),
    onReset: vi.fn(),
    ...over,
  };
  const utils = render(<ViewControls {...props} />);
  return { props, ...utils };
}

describe("ViewControls", () => {
  it("renders the Transpose label and aria-labelled buttons", () => {
    setup();
    expect(screen.getByText("Transpose")).toBeInTheDocument();
    expect(screen.getByLabelText("Transpose down")).toBe(
      screen.getByTestId("transpose-down"),
    );
    expect(screen.getByLabelText("Transpose up")).toBe(
      screen.getByTestId("transpose-up"),
    );
  });

  it.each([
    [0, "0"],
    [2, "+2"],
    [-3, "-3"],
  ])("formats transpose %i as %s inside bdi ltr", (n, text) => {
    setup({ transpose: n });
    const value = screen.getByTestId("transpose-value");
    expect(value.textContent).toBe(text);
    expect(value.tagName).toBe("BDI");
    expect(value).toHaveAttribute("dir", "ltr");
  });

  it("calls onTranspose with transpose -/+ 1", () => {
    const { props } = setup({ transpose: 3 });
    fireEvent.click(screen.getByTestId("transpose-down"));
    expect(props.onTranspose).toHaveBeenLastCalledWith(2);
    fireEvent.click(screen.getByTestId("transpose-up"));
    expect(props.onTranspose).toHaveBeenLastCalledWith(4);
  });

  it("disables down at -11 and never calls beyond the limit", () => {
    const { props } = setup({ transpose: -11 });
    const down = screen.getByTestId("transpose-down");
    expect(down).toBeDisabled();
    expect(screen.getByTestId("transpose-up")).toBeEnabled();
    fireEvent.click(down);
    expect(props.onTranspose).not.toHaveBeenCalled();
  });

  it("disables up at +11 and never calls beyond the limit", () => {
    const { props } = setup({ transpose: 11 });
    const up = screen.getByTestId("transpose-up");
    expect(up).toBeDisabled();
    expect(screen.getByTestId("transpose-down")).toBeEnabled();
    fireEvent.click(up);
    expect(props.onTranspose).not.toHaveBeenCalled();
  });

  it("allows the last step to the limits", () => {
    const { props, rerender } = setup({ transpose: 10 });
    fireEvent.click(screen.getByTestId("transpose-up"));
    expect(props.onTranspose).toHaveBeenLastCalledWith(11);
    rerender(<ViewControls {...props} transpose={-10} />);
    fireEvent.click(screen.getByTestId("transpose-down"));
    expect(props.onTranspose).toHaveBeenLastCalledWith(-11);
  });

  it("clamps the callback argument when transpose is out of range", () => {
    const { props, rerender } = setup({ transpose: 15 });
    expect(screen.getByTestId("transpose-down")).toBeEnabled();
    fireEvent.click(screen.getByTestId("transpose-down"));
    expect(props.onTranspose).toHaveBeenLastCalledWith(11);
    rerender(<ViewControls {...props} transpose={-15} />);
    expect(screen.getByTestId("transpose-up")).toBeEnabled();
    fireEvent.click(screen.getByTestId("transpose-up"));
    expect(props.onTranspose).toHaveBeenLastCalledWith(-11);
  });

  it("renders a labelled capo select from capoOptions with the capo value", () => {
    setup({ capo: 14, capoOptions: [...OPTIONS, 14] });
    const select = screen.getByLabelText("Capo") as HTMLSelectElement;
    expect(select).toBe(screen.getByTestId("capo-select"));
    expect(select.tagName).toBe("SELECT");
    expect(select.value).toBe("14");
    expect(Array.from(select.options).map((o) => o.value)).toEqual(
      [...OPTIONS, 14].map(String),
    );
  });

  it("calls onCapo with a number on change", () => {
    const { props } = setup();
    fireEvent.change(screen.getByTestId("capo-select"), {
      target: { value: "5" },
    });
    expect(props.onCapo).toHaveBeenCalledWith(5);
  });

  it("shows shapes with a ltr bdi only when shapeKey is defined", () => {
    const { unmount } = setup({ shapeKey: "G" });
    expect(screen.getByText("Shapes")).toBeInTheDocument();
    const shape = screen.getByTestId("shape-key");
    expect(shape.tagName).toBe("BDI");
    expect(shape).toHaveAttribute("dir", "ltr");
    expect(shape.textContent).toBe("G");
    unmount();
    setup();
    expect(screen.queryByTestId("shape-key")).toBeNull();
    expect(screen.queryByText("Shapes")).toBeNull();
  });

  it("never renders sounding-key", () => {
    setup({ shapeKey: "G" });
    expect(screen.queryByTestId("sounding-key")).toBeNull();
  });

  it("calls onReset from the Reset button", () => {
    const { props } = setup();
    const reset = screen.getByTestId("reset-view");
    expect(reset.textContent).toBe("Reset");
    fireEvent.click(reset);
    expect(props.onReset).toHaveBeenCalledTimes(1);
  });

  it("is print-hidden chrome without inline styles", () => {
    const { container } = setup({ shapeKey: "G" });
    expect(container.querySelector("[data-ui-chrome]")).not.toBeNull();
    expect(container.innerHTML).not.toContain("style=");
  });
});
