import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HE } from "./he";
import { EN } from "./en";
import {
  I18nProvider,
  i18n,
  initI18n,
  setLocale,
  useLocale,
  useT,
} from "./index";
import { detectLocale, readStoredLocale } from "./locale";

function Probe() {
  const t = useT();
  const { locale } = useLocale();
  // @ts-expect-error unknown keys are a type error
  const missing = t("noSuchKey");
  return (
    <p data-testid="probe">
      {t("save")}|{locale}|{String(missing)}
    </p>
  );
}

/** Uses only `useT()`, so it re-renders only if the hook itself is reactive. */
function TOnlyProbe() {
  const t = useT();
  return <p data-testid="t-only">{t("save")}</p>;
}

describe("i18n module", () => {
  it("is a dedicated, initialised instance and init is idempotent", () => {
    expect(i18n.isInitialized).toBe(true);
    initI18n("en");
    initI18n("en");
    expect(i18n.language).toBe("en");
    expect(i18n.t("save")).toBe(EN.save);
    expect(i18n.getResourceBundle("en", "translation")).toEqual(EN);
    expect(i18n.getResourceBundle("he", "translation")).toEqual(HE);
  });

  it("detection alone never stores", () => {
    const locale = detectLocale(readStoredLocale(window.localStorage), ["he"]);
    expect(locale).toBe("he");
    initI18n(locale);
    expect(window.localStorage.getItem("shir.locale")).toBeNull();
  });

  it("setLocale stores, applies lang/dir and re-renders hook consumers", () => {
    i18n.addResource("he", "translation", "save", "שמור");
    render(
      <I18nProvider>
        <Probe />
        <TOnlyProbe />
      </I18nProvider>,
    );
    expect(screen.getByTestId("probe").textContent).toBe(
      `${EN.save}|en|noSuchKey`,
    );
    expect(screen.getByTestId("t-only").textContent).toBe(EN.save);
    act(() => setLocale("he"));
    expect(window.localStorage.getItem("shir.locale")).toBe("he");
    expect(document.documentElement.lang).toBe("he");
    expect(document.documentElement.dir).toBe("rtl");
    expect(screen.getByTestId("probe").textContent).toBe("שמור|he|noSuchKey");
    expect(screen.getByTestId("t-only").textContent).toBe("שמור");
    i18n.addResource("he", "translation", "save", HE.save);
  });

  it("falls back to English for a key missing in Hebrew", () => {
    i18n.addResource("en", "translation", "onlyEnglish", "fallback");
    act(() => setLocale("he"));
    expect(i18n.t("onlyEnglish" as never)).toBe("fallback");
    i18n.removeResourceBundle("en", "translation");
    i18n.addResourceBundle("en", "translation", EN);
  });
});
