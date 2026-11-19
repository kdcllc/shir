import path from "node:path";

export interface Profile {
  /** The temporary root that holds the three XDG directories. */
  root: string;
  dataHome: string;
  configHome: string;
  cacheHome: string;
}

export function profileAt(root: string): Profile {
  return {
    root,
    dataHome: path.join(root, "data"),
    configHome: path.join(root, "config"),
    cacheHome: path.join(root, "cache"),
  };
}

/** `LANG`-style names for the two languages the specs launch with. */
export const LANGS = { en: "en_US.UTF-8", he: "he_IL.UTF-8" } as const;

/** The per-launch environment: isolated XDG directories plus the locale. */
export function buildLaunchEnv(
  profile: Profile,
  lang: string,
): Record<string, string> {
  const language = lang.split(".")[0] ?? lang;
  return {
    XDG_DATA_HOME: profile.dataHome,
    XDG_CONFIG_HOME: profile.configHome,
    XDG_CACHE_HOME: profile.cacheHome,
    LANG: lang,
    LC_ALL: lang,
    LANGUAGE: language,
  };
}

/** Quotes a value for POSIX `sh` (single quotes, embedded quotes escaped). */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * The wrapper script `tauri:options.application` points at. tauri-driver and
 * WebKitWebDriver cannot set the app's environment, so the wrapper exports it and
 * then replaces itself with the real binary.
 */
export function renderWrapper(
  binary: string,
  env: Record<string, string>,
): string {
  const exports = Object.entries(env).map(
    ([key, value]) => `export ${key}=${shellQuote(value)}`,
  );
  return ["#!/bin/sh", ...exports, `exec ${shellQuote(binary)} "$@"`, ""].join(
    "\n",
  );
}

/** Whether `child` is `parent` or lies inside it (no `..` escapes). */
export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
