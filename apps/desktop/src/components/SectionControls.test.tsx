import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { STRINGS } from "../strings";
import { SectionControls } from "./SectionControls";
import type { SectionControlsProps } from "./SectionControls";

function setup(props: Partial<SectionControlsProps> = {}) {
  const onRename = vi.fn();
  const onMove = vi.fn();
  const onRemove = vi.fn();
  const base: SectionControlsProps = {
    section: "verse",
    literal: false,
    canMoveUp: true,
    canMoveDown: true,
    onRename,
    onMove,
    onRemove,
    ...props,
  };
  const view = render(<SectionControls {...base} />);
  const update = (next: Partial<SectionControlsProps>) =>
    view.rerender(<SectionControls {...base} {...next} />);
  return { onRename, onMove, onRemove, update, ...view };
}

const kind = () => screen.getByTestId<HTMLSelectElement>("section-kind");
const label = () => screen.getByTestId<HTMLInputElement>("section-label");
const kindOptions = () =>
  Array.from(kind().querySelectorAll("option")).map((o) => [
    o.value,
    o.textContent,
  ]);
const typeLabel = (value: string) =>
  fireEvent.change(label(), { target: { value } });

describe("SectionControls", () => {
  it("is a print-hidden chrome group", () => {
    setup();
    const group = screen.getByRole("group");
    expect(group).toHaveAttribute("data-ui-chrome");
    expect(group).toContainElement(kind());
    expect(group).toContainElement(screen.getByTestId("section-remove"));
  });

  it.each([
    ["verse", undefined, STRINGS.sectionVerse],
    ["chorus", undefined, STRINGS.sectionChorus],
    ["bridge", "", STRINGS.sectionBridge],
    ["bridge", "   ", STRINGS.sectionBridge],
    ["verse", "Verse 2", `${STRINGS.sectionVerse} Verse 2`],
    ["chorus", " פִּזְמוֹן ", `${STRINGS.sectionChorus} פִּזְמוֹן`],
    ["intro", undefined, STRINGS.sectionOther],
    ["tab", "Riff", `${STRINGS.sectionOther} Riff`],
  ])(
    "the group is named after the section: %j with label %j",
    (section, label, name) => {
      setup({ section, label });
      expect(screen.getByRole("group")).toHaveAccessibleName(name);
    },
  );

  it("the group name follows the section, not the label draft", () => {
    const { update } = setup({ section: "verse", label: "One" });
    typeLabel("Half typed");
    expect(screen.getByRole("group")).toHaveAccessibleName(
      `${STRINGS.sectionVerse} One`,
    );
    update({ section: "chorus", label: "Two" });
    expect(screen.getByRole("group")).toHaveAccessibleName(
      `${STRINGS.sectionChorus} Two`,
    );
  });

  it("offers verse, chorus and bridge with the current kind selected", () => {
    setup({ section: "chorus" });
    expect(kind()).toHaveAttribute("aria-label", STRINGS.sectionKind);
    expect(kindOptions()).toEqual([
      ["verse", STRINGS.sectionVerse],
      ["chorus", STRINGS.sectionChorus],
      ["bridge", STRINGS.sectionBridge],
    ]);
    expect(kind()).toHaveValue("chorus");
    expect(kind()).toBeEnabled();
  });

  it("the label input is auto-directed, labelled and shows the label", () => {
    setup({ label: "Verse 2" });
    expect(label()).toHaveAttribute("dir", "auto");
    expect(label()).toHaveAttribute("aria-label", STRINGS.sectionLabel);
    expect(label()).toHaveAttribute("placeholder", STRINGS.noLabel);
    expect(label()).toHaveValue("Verse 2");
    expect(label()).toBeEnabled();
  });

  it("shows an empty label input when the section has no label", () => {
    setup();
    expect(label()).toHaveValue("");
  });

  it("choosing a kind renames with the current label", () => {
    const { onRename } = setup({ section: "verse", label: "Intro" });
    fireEvent.change(kind(), { target: { value: "bridge" } });
    expect(onRename).toHaveBeenCalledExactlyOnceWith("bridge", "Intro");
  });

  it("choosing a kind sends the trimmed label draft", () => {
    const { onRename } = setup({ section: "verse", label: "Old" });
    typeLabel("  Typed  ");
    expect(onRename).not.toHaveBeenCalled();
    fireEvent.change(kind(), { target: { value: "chorus" } });
    expect(onRename).toHaveBeenCalledExactlyOnceWith("chorus", "Typed");
  });

  it("choosing a kind without a label sends the empty string", () => {
    const { onRename } = setup({ section: "chorus" });
    fireEvent.change(kind(), { target: { value: "verse" } });
    expect(onRename).toHaveBeenCalledExactlyOnceWith("verse", "");
  });

  it("typing the label keeps a draft; blur commits it trimmed once", () => {
    const { onRename } = setup({ section: "chorus", label: "Old" });
    typeLabel(" Refrain ");
    expect(label()).toHaveValue(" Refrain ");
    expect(onRename).not.toHaveBeenCalled();
    fireEvent.blur(label());
    expect(onRename).toHaveBeenCalledExactlyOnceWith("chorus", "Refrain");
  });

  it("Enter commits the label once, and a following blur adds nothing", () => {
    const { onRename } = setup({ section: "bridge" });
    typeLabel("Solo");
    fireEvent.keyDown(label(), { key: "Enter" });
    fireEvent.blur(label());
    expect(onRename).toHaveBeenCalledExactlyOnceWith("bridge", "Solo");
  });

  it("does not rename when the trimmed label is unchanged", () => {
    const { onRename } = setup({ label: "Same" });
    fireEvent.blur(label());
    typeLabel(" Same ");
    fireEvent.blur(label());
    fireEvent.keyDown(label(), { key: "Enter" });
    expect(onRename).not.toHaveBeenCalled();
  });

  it("clearing the label commits the empty string", () => {
    const { onRename } = setup({ label: "Gone" });
    typeLabel("");
    fireEvent.blur(label());
    expect(onRename).toHaveBeenCalledExactlyOnceWith("verse", "");
  });

  it("Escape restores the label draft without renaming", () => {
    const { onRename } = setup({ label: "Kept" });
    typeLabel("Thrown away");
    fireEvent.keyDown(label(), { key: "Escape" });
    expect(label()).toHaveValue("Kept");
    fireEvent.blur(label());
    expect(onRename).not.toHaveBeenCalled();
  });

  it("the label draft follows a label changed from outside", () => {
    const { onRename, update } = setup({ label: "First" });
    typeLabel("Half typed");
    update({ label: "Undone" });
    expect(label()).toHaveValue("Undone");
    update({ label: undefined });
    expect(label()).toHaveValue("");
    fireEvent.blur(label());
    expect(onRename).not.toHaveBeenCalled();
  });

  it("commits a Hebrew label unchanged", () => {
    const { onRename } = setup({ section: "chorus" });
    const hebrew = "פִּזְמוֹן 2";
    typeLabel(hebrew);
    fireEvent.blur(label());
    expect(onRename).toHaveBeenCalledExactlyOnceWith("chorus", hebrew);
    expect(label()).toHaveAttribute("dir", "auto");
  });

  it("a literal section cannot be renamed", () => {
    setup({ section: "tab", literal: true, label: "Riff" });
    expect(kind()).toBeDisabled();
    expect(label()).toBeDisabled();
    expect(label()).toHaveValue("Riff");
    expect(kind()).toHaveValue("");
    expect(screen.getByTestId("section-up")).toBeEnabled();
    expect(screen.getByTestId("section-remove")).toBeEnabled();
  });

  it("a literal flag disables renaming even for a standard kind", () => {
    setup({ section: "verse", literal: true });
    expect(kind()).toBeDisabled();
    expect(label()).toBeDisabled();
  });

  it("a non-standard kind shows Other first and disables only the label", () => {
    setup({ section: "intro", label: "Opening" });
    expect(kindOptions()).toEqual([
      ["", STRINGS.sectionOther],
      ["verse", STRINGS.sectionVerse],
      ["chorus", STRINGS.sectionChorus],
      ["bridge", STRINGS.sectionBridge],
    ]);
    expect(kind()).toHaveValue("");
    expect(kind()).toBeEnabled();
    expect(label()).toBeDisabled();
  });

  it("a non-standard kind can be renamed to a standard one, keeping its label", () => {
    const { onRename } = setup({ section: "intro", label: "Opening" });
    fireEvent.change(kind(), { target: { value: "verse" } });
    expect(onRename).toHaveBeenCalledExactlyOnceWith("verse", "Opening");
  });

  it("the Other option never renames", () => {
    const { onRename } = setup({ section: "intro" });
    fireEvent.change(kind(), { target: { value: "" } });
    expect(onRename).not.toHaveBeenCalled();
  });

  it("the move buttons report their direction", () => {
    const { onMove, onRemove } = setup();
    const up = screen.getByTestId("section-up");
    const down = screen.getByTestId("section-down");
    expect(up).toHaveTextContent(STRINGS.upGlyph);
    expect(up).toHaveAttribute("aria-label", STRINGS.sectionUp);
    expect(down).toHaveTextContent(STRINGS.downGlyph);
    expect(down).toHaveAttribute("aria-label", STRINGS.sectionDown);
    fireEvent.click(up);
    expect(onMove).toHaveBeenLastCalledWith("up");
    fireEvent.click(down);
    expect(onMove).toHaveBeenLastCalledWith("down");
    expect(onMove).toHaveBeenCalledTimes(2);
    expect(onRemove).not.toHaveBeenCalled();
  });

  it("the move buttons are disabled per canMoveUp and canMoveDown", () => {
    const { update } = setup({ canMoveUp: false, canMoveDown: true });
    expect(screen.getByTestId("section-up")).toBeDisabled();
    expect(screen.getByTestId("section-down")).toBeEnabled();
    update({ canMoveUp: true, canMoveDown: false });
    expect(screen.getByTestId("section-up")).toBeEnabled();
    expect(screen.getByTestId("section-down")).toBeDisabled();
  });

  it("the remove button calls onRemove only", () => {
    const { onRemove, onMove, onRename } = setup();
    const remove = screen.getByTestId("section-remove");
    expect(remove).toHaveTextContent(STRINGS.removeGlyph);
    expect(remove).toHaveAttribute("aria-label", STRINGS.sectionRemove);
    fireEvent.click(remove);
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onMove).not.toHaveBeenCalled();
    expect(onRename).not.toHaveBeenCalled();
  });
});
