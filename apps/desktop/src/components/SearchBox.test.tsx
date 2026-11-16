import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SearchBox } from "./SearchBox";

describe("SearchBox", () => {
  it("renders a labelled search input with auto direction", () => {
    render(<SearchBox value="" onChange={vi.fn()} />);
    const input = screen.getByTestId("search-input");
    expect(input).toHaveAttribute("type", "search");
    expect(input).toHaveAttribute("dir", "auto");
    expect(input).toHaveAttribute("aria-label", "Search songs");
    expect(input).toHaveAttribute(
      "placeholder",
      "Search title, artist or lyrics",
    );
    expect(input).toBeEnabled();
  });

  it("is print-hidden chrome", () => {
    render(<SearchBox value="" onChange={vi.fn()} />);
    expect(screen.getByTestId("search-input")).toHaveAttribute(
      "data-ui-chrome",
    );
  });

  it("reports typed text", () => {
    const onChange = vi.fn();
    render(<SearchBox value="" onChange={onChange} />);
    fireEvent.change(screen.getByTestId("search-input"), {
      target: { value: "שלום" },
    });
    expect(onChange).toHaveBeenCalledWith("שלום");
  });

  it("clears with Escape and ignores other keys", () => {
    const onChange = vi.fn();
    render(<SearchBox value="abc" onChange={onChange} />);
    const input = screen.getByTestId("search-input");
    fireEvent.keyDown(input, { key: "a" });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onChange).toHaveBeenCalledExactlyOnceWith("");
  });

  it("can be disabled", () => {
    render(<SearchBox value="" disabled onChange={vi.fn()} />);
    expect(screen.getByTestId("search-input")).toBeDisabled();
  });
});
