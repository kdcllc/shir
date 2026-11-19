import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LocaleToggle } from "./LocaleToggle";
import { i18n } from "../i18n";
import { HE } from "../i18n/he";
import { STRINGS } from "../strings";

describe("LocaleToggle", () => {
  it("is a named print-hidden group with two labelled buttons", () => {
    render(<LocaleToggle />);
    const group = screen.getByTestId("locale-toggle");
    expect(group).toHaveAttribute("role", "group");
    expect(group).toHaveAttribute("aria-label", STRINGS.uiLanguage);
    expect(group).toHaveAttribute("data-ui-chrome");
    const he = screen.getByTestId("locale-he");
    const en = screen.getByTestId("locale-en");
    expect(he).toHaveTextContent(STRINGS.localeHebrewShort);
    expect(he).toHaveAttribute("lang", "he");
    expect(he).toHaveAttribute("aria-label", STRINGS.localeHebrew);
    expect(en).toHaveTextContent(STRINGS.localeEnglishShort);
    expect(en).toHaveAttribute("lang", "en");
    expect(en).toHaveAttribute("aria-label", STRINGS.localeEnglish);
  });

  it("marks the current locale pressed", () => {
    render(<LocaleToggle />);
    expect(screen.getByTestId("locale-en")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("locale-he")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("switches to Hebrew and back, updating pressed state and the group name", () => {
    render(<LocaleToggle />);
    fireEvent.click(screen.getByTestId("locale-he"));
    expect(i18n.language).toBe("he");
    expect(screen.getByTestId("locale-he")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("locale-en")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByTestId("locale-toggle")).toHaveAttribute(
      "aria-label",
      HE.uiLanguage,
    );
    fireEvent.click(screen.getByTestId("locale-en"));
    expect(i18n.language).toBe("en");
    expect(document.documentElement.dir).toBe("ltr");
  });

  it("does nothing when the current locale is clicked", () => {
    render(<LocaleToggle />);
    fireEvent.click(screen.getByTestId("locale-en"));
    expect(window.localStorage.getItem("shir.locale")).toBeNull();
    expect(screen.getByTestId("locale-en")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
