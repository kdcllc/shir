import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("renders the Shir heading", () => {
    render(<App />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(
      "Shir",
    );
  });

  it("renders the demo chord left-to-right via chord-render", () => {
    render(<App />);
    const chord = within(screen.getByTestId("chord-demo")).getByText(
      "F#m7(b5)",
    );
    expect(chord.classList.contains("chord")).toBe(true);
    expect(chord.textContent).toBe("F#m7(b5)");
    expect(chord).toHaveAttribute("dir", "ltr");
  });
});
