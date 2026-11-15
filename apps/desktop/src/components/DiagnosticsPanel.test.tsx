import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Diagnostic } from "chord-core";
import { STRINGS, diagnosticsCount } from "../strings";
import { DiagnosticsPanel } from "./DiagnosticsPanel";

const d = (line: number, column: number, message: string): Diagnostic => ({
  line,
  column,
  code: "syntax",
  message,
});

describe("DiagnosticsPanel", () => {
  it("renders nothing for an empty array", () => {
    const { container } = render(<DiagnosticsPanel diagnostics={[]} />);
    expect(container.innerHTML).toBe("");
    expect(screen.queryByTestId("diagnostics")).toBeNull();
  });

  it("renders the heading with singular count", () => {
    render(<DiagnosticsPanel diagnostics={[d(1, 2, "bad")]} />);
    const panel = screen.getByTestId("diagnostics");
    expect(panel.tagName).toBe("SECTION");
    expect(panel).toHaveAttribute("data-ui-chrome");
    expect(screen.getByRole("heading").textContent).toContain("Diagnostics");
    expect(screen.getByRole("heading").textContent).toContain("1 problem");
    expect(screen.getByRole("heading").textContent).not.toContain("problems");
  });

  it.each([1, 2])(
    "renders the heading with the STRINGS separator for n=%i",
    (n) => {
      render(
        <DiagnosticsPanel
          diagnostics={Array.from({ length: n }, (_, i) => d(i + 1, 1, "x"))}
        />,
      );
      expect(screen.getByRole("heading").textContent).toBe(
        `${STRINGS.diagnostics} ${STRINGS.separator} ${diagnosticsCount(n)}`,
      );
    },
  );

  it("renders plural count and items in input order", () => {
    render(
      <DiagnosticsPanel
        diagnostics={[d(7, 3, "second-line"), d(2, 9, "first-line")]}
      />,
    );
    expect(screen.getByRole("heading").textContent).toContain("2 problems");
    const items = screen.getAllByTestId("diagnostic-item");
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toBe("7:3 second-line");
    expect(items[1]!.textContent).toBe("2:9 first-line");
  });

  it("puts coordinates in bdi ltr and the message in dir=auto", () => {
    render(<DiagnosticsPanel diagnostics={[d(4, 5, "שגיאה")]} />);
    const item = screen.getByTestId("diagnostic-item");
    const bdi = item.querySelector("bdi");
    expect(bdi).toHaveAttribute("dir", "ltr");
    expect(bdi!.textContent).toBe("4:5");
    const msg = screen.getByText("שגיאה");
    expect(msg.tagName).toBe("SPAN");
    expect(msg).toHaveAttribute("dir", "auto");
  });

  it("contains no inline style attributes", () => {
    const { container } = render(
      <DiagnosticsPanel diagnostics={[d(1, 1, "x")]} />,
    );
    expect(container.innerHTML).not.toContain("style=");
  });
});
