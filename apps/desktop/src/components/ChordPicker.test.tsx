import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { STRINGS } from "../strings";
import { ChordPicker } from "./ChordPicker";
import type { ChordPickerProps } from "./ChordPicker";

const here = (file: string): string =>
  readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");

/** The declarations of the rule with exactly this selector, comments removed. */
function ruleBody(css: string, selector: string): string {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = Array.from(plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)).filter(
    (m) => m[1]?.trim() === selector,
  );
  if (rules.length !== 1) throw new Error(`${rules.length} rules ${selector}`);
  return rules[0]?.[2] ?? "";
}

const CHORDS = ["Am", "Am7", "A", "C", "G"];
const KNOWN = [...CHORDS, "D"];

function setup(props: Partial<ChordPickerProps> = {}) {
  const suggestions = vi.fn((prefix: string) =>
    CHORDS.filter((c) => c.startsWith(prefix)),
  );
  const isValid = vi.fn((chord: string) => /^[A-GX]\S*$/.test(chord));
  const isKnown = vi.fn((chord: string) => KNOWN.includes(chord));
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <ChordPicker
      suggestions={suggestions}
      isValid={isValid}
      isKnown={isKnown}
      onSubmit={onSubmit}
      onClose={onClose}
      {...props}
    />,
  );
  return { suggestions, isValid, isKnown, onSubmit, onClose, ...view };
}

const input = () => screen.getByTestId<HTMLInputElement>("chord-input");
const options = () => screen.queryAllByTestId("chord-option");
const type = (value: string) =>
  fireEvent.change(input(), { target: { value } });
const press = (key: string) => fireEvent.keyDown(input(), { key });
const optionTexts = () => options().map((o) => o.textContent);

describe("ChordPicker", () => {
  it("is a labelled non-modal dialog that is print-hidden chrome", () => {
    setup();
    const dialog = screen.getByTestId("chord-picker");
    expect(dialog).toHaveAttribute("role", "dialog");
    expect(dialog).toHaveAccessibleName(STRINGS.chordPicker);
    expect(dialog).not.toHaveAttribute("aria-modal");
    expect(dialog).toHaveAttribute("data-ui-chrome");
  });

  it("renders an LTR combobox wired to the suggestions listbox", () => {
    setup();
    const listbox = screen.getByRole("listbox");
    expect(listbox).toHaveAccessibleName(STRINGS.chordSuggestions);
    expect(input()).toHaveAttribute("role", "combobox");
    expect(input()).toHaveAttribute("dir", "ltr");
    expect(input()).toHaveAttribute("aria-label", STRINGS.chordInput);
    expect(input()).toHaveAttribute("spellcheck", "false");
    expect(input()).toHaveAttribute("autocapitalize", "off");
    expect(input()).toHaveAttribute("aria-controls", listbox.id);
    expect(listbox.id).not.toBe("");
    expect(input()).toHaveAttribute("aria-expanded", "true");
    expect(input()).not.toHaveAttribute("aria-activedescendant");
  });

  it("focuses the input and selects all of its text on mount", () => {
    setup({ initial: "Am7" });
    expect(input()).toHaveFocus();
    expect(input()).toHaveValue("Am7");
    expect(input().selectionStart).toBe(0);
    expect(input().selectionEnd).toBe(3);
  });

  it("starts empty when adding a chord", () => {
    setup();
    expect(input()).toHaveValue("");
    expect(optionTexts()).toEqual(CHORDS);
  });

  it("re-queries the suggestions on every change", () => {
    const { suggestions } = setup();
    type("A");
    expect(suggestions).toHaveBeenLastCalledWith("A");
    expect(optionTexts()).toEqual(["Am", "Am7", "A"]);
    type("Am7");
    expect(suggestions).toHaveBeenLastCalledWith("Am7");
    expect(optionTexts()).toEqual(["Am7"]);
    type("Z");
    expect(optionTexts()).toEqual([]);
    expect(input()).toHaveAttribute("aria-expanded", "false");
  });

  it("renders each option as an LTR-isolated listbox option", () => {
    setup();
    const first = options()[0]!;
    expect(first).toHaveAttribute("role", "option");
    expect(first.tagName).toBe("LI");
    expect(first.parentElement).toBe(screen.getByRole("listbox"));
    const bdi = first.querySelector("bdi");
    expect(bdi).toHaveAttribute("dir", "ltr");
    expect(bdi).toHaveTextContent("Am");
  });

  it("ArrowDown and ArrowUp move the highlight and wrap", () => {
    setup();
    type("A");
    const selected = () =>
      options().map((o) => o.getAttribute("aria-selected"));
    expect(selected()).toEqual(["false", "false", "false"]);
    press("ArrowDown");
    expect(selected()).toEqual(["true", "false", "false"]);
    expect(input()).toHaveAttribute("aria-activedescendant", options()[0]!.id);
    press("ArrowDown");
    press("ArrowDown");
    expect(selected()).toEqual(["false", "false", "true"]);
    press("ArrowDown");
    expect(selected()).toEqual(["true", "false", "false"]);
    press("ArrowUp");
    expect(selected()).toEqual(["false", "false", "true"]);
    expect(input()).toHaveAttribute("aria-activedescendant", options()[2]!.id);
    press("ArrowUp");
    expect(selected()).toEqual(["false", "true", "false"]);
  });

  it("ArrowUp from no highlight goes to the last option", () => {
    setup();
    type("A");
    press("ArrowUp");
    expect(options()[2]).toHaveAttribute("aria-selected", "true");
  });

  it("arrow keys do nothing without options and typing clears the highlight", () => {
    setup();
    type("Z");
    press("ArrowDown");
    expect(input()).not.toHaveAttribute("aria-activedescendant");
    type("A");
    press("ArrowDown");
    expect(input()).toHaveAttribute("aria-activedescendant");
    type("Am");
    expect(input()).not.toHaveAttribute("aria-activedescendant");
    expect(
      options().every((o) => o.getAttribute("aria-selected") === "false"),
    ).toBe(true);
  });

  it("Enter submits the highlighted option", () => {
    const { onSubmit, onClose } = setup();
    type("A");
    press("ArrowDown");
    press("ArrowDown");
    press("Enter");
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith("Am7");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Enter submits the typed text when nothing is highlighted", () => {
    const { onSubmit } = setup();
    type("D");
    press("Enter");
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith("D");
  });

  it("Enter does nothing when the typed text is invalid", () => {
    const { onSubmit, isValid } = setup();
    type("zzz");
    expect(isValid).toHaveBeenLastCalledWith("zzz");
    press("Enter");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("Escape calls onClose only", () => {
    const { onSubmit, onClose } = setup({ initial: "Am" });
    press("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("clicking an option submits it and keeps the picker open", () => {
    const { onSubmit, onClose } = setup();
    fireEvent.click(options()[3]!);
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith("C");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("chord-picker")).toBeInTheDocument();
  });

  it("pressing the mouse on an option does not take focus from the input", () => {
    setup();
    const allowed = fireEvent.mouseDown(options()[0]!);
    expect(allowed).toBe(false);
  });

  it("Apply is disabled while the text is invalid and submits when valid", () => {
    const { onSubmit } = setup();
    const apply = screen.getByTestId("chord-apply");
    expect(apply).toHaveTextContent(STRINGS.chordApply);
    expect(apply).toBeDisabled();
    type("zzz");
    expect(apply).toBeDisabled();
    type("G");
    expect(apply).toBeEnabled();
    fireEvent.click(apply);
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith("G");
  });

  it("submits the trimmed text", () => {
    const { onSubmit, isValid } = setup();
    type("  Am7 ");
    expect(isValid).toHaveBeenLastCalledWith("Am7");
    expect(screen.getByTestId("chord-apply")).toBeEnabled();
    press("Enter");
    fireEvent.click(screen.getByTestId("chord-apply"));
    expect(onSubmit.mock.calls).toEqual([["Am7"], ["Am7"]]);
    expect(input()).toHaveValue("  Am7 ");
  });

  it("warns about a valid but unrecognized chord", () => {
    setup();
    const warning = screen.getByTestId("chord-warning");
    expect(warning).toHaveAttribute("role", "status");
    expect(warning).toBeEmptyDOMElement();
    type("Xyz");
    expect(warning).toHaveTextContent(STRINGS.chordUnknown);
    expect(screen.getByTestId("chord-apply")).toBeEnabled();
    type("Am");
    expect(warning).toBeEmptyDOMElement();
  });

  it("does not warn about invalid text", () => {
    const { isKnown } = setup();
    type("zzz");
    expect(isKnown("zzz")).toBe(false);
    expect(screen.getByTestId("chord-warning")).toBeEmptyDOMElement();
  });

  it("the warning status region stays in the accessibility tree while empty", () => {
    setup();
    const warning = screen.getByTestId("chord-warning");
    expect(warning).toBeEmptyDOMElement();
    expect(screen.getByRole("status")).toBe(warning);
    expect(warning).not.toHaveAttribute("hidden");
    expect(warning).not.toHaveAttribute("aria-hidden");
    expect(warning).not.toHaveAttribute("style");

    const css = here("./ChordPicker.module.css");
    // Nothing removes the region from the accessibility tree, empty or not.
    for (const selector of [".warning", ".warning:empty"]) {
      const body = ruleBody(css, selector);
      expect(body).not.toMatch(/display\s*:\s*none/);
      expect(body).not.toMatch(/visibility\s*:/);
      expect(body).not.toMatch(/content-visibility\s*:/);
    }
    // Empty, it is out of flow (no grid gap) and clipped to nothing.
    const empty = ruleBody(css, ".warning:empty");
    expect(empty).toMatch(/position\s*:\s*absolute\s*;/);
    expect(empty).toMatch(/overflow\s*:\s*hidden\s*;/);
    expect(empty).toMatch(/clip-path\s*:\s*inset\(50%\)\s*;/);
    expect(empty).toMatch(/inline-size\s*:\s*1px\s*;/);
    expect(empty).toMatch(/block-size\s*:\s*1px\s*;/);
    // Logical properties only.
    expect(empty).not.toMatch(
      /(^|[\s;])(width|height|top|left|right|bottom)\s*:/,
    );
    // The picker is still the grid whose gap the rule works around.
    expect(ruleBody(css, ".picker")).toMatch(/display\s*:\s*grid\s*;/);
  });

  it("shows no remove or move buttons when adding a chord", () => {
    setup();
    expect(screen.queryByTestId("chord-remove")).toBeNull();
    expect(screen.queryByTestId("chord-move-left")).toBeNull();
    expect(screen.queryByTestId("chord-move-right")).toBeNull();
    expect(screen.getByTestId("chord-close")).toBeInTheDocument();
  });

  it("the remove button appears with onRemove and calls it", () => {
    const onRemove = vi.fn();
    const { onSubmit, onClose } = setup({ initial: "Am", onRemove });
    const remove = screen.getByTestId("chord-remove");
    expect(remove).toHaveTextContent(STRINGS.chordRemove);
    expect(screen.queryByTestId("chord-move-left")).toBeNull();
    fireEvent.click(remove);
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("the move buttons appear with onMove, report their side and keep the picker open", () => {
    const onMove = vi.fn();
    const { onClose, onSubmit } = setup({ initial: "Am", onMove });
    const left = screen.getByTestId("chord-move-left");
    const right = screen.getByTestId("chord-move-right");
    expect(screen.queryByTestId("chord-remove")).toBeNull();
    expect(left).toHaveTextContent(STRINGS.leftGlyph);
    expect(left).toHaveAttribute("aria-label", STRINGS.chordMoveLeft);
    expect(right).toHaveTextContent(STRINGS.rightGlyph);
    expect(right).toHaveAttribute("aria-label", STRINGS.chordMoveRight);
    fireEvent.click(left);
    expect(onMove).toHaveBeenLastCalledWith("left");
    fireEvent.click(right);
    expect(onMove).toHaveBeenLastCalledWith("right");
    expect(onMove).toHaveBeenCalledTimes(2);
    expect(onClose).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId("chord-picker")).toBeInTheDocument();
    expect(input()).toHaveValue("Am");
  });

  it("keeps the move pair in visual order: left first inside an LTR group", () => {
    setup({ onMove: vi.fn() });
    const left = screen.getByTestId("chord-move-left");
    expect(left.parentElement).toHaveAttribute("dir", "ltr");
    expect(left.nextElementSibling).toBe(
      screen.getByTestId("chord-move-right"),
    );
  });

  it("the close button calls onClose", () => {
    const { onClose } = setup();
    const close = screen.getByTestId("chord-close");
    expect(close).toHaveTextContent(STRINGS.chordClose);
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not trap focus: Tab is left to the browser", () => {
    setup();
    const allowed = fireEvent.keyDown(input(), { key: "Tab" });
    expect(allowed).toBe(true);
  });

  it("does not close itself on submit", () => {
    const { onSubmit, onClose } = setup({ initial: "G" });
    press("Enter");
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith("G");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("chord-picker")).toBeInTheDocument();
  });
});
