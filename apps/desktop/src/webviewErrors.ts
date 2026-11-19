/** Forwards uncaught webview errors to the native log (see storage.logWebviewError). */

/** Message always included: JavaScriptCore's `stack` holds frames only. */
function errorText(error: Error): string {
  const name = String(error.name);
  const message = String(error.message);
  const head = message === "" ? name : `${name}: ${message}`;
  const stack = error.stack;
  if (typeof stack !== "string" || stack === "") return head;
  if (message !== "" && stack.includes(message)) return stack;
  return `${head}\n${stack}`;
}

function text(value: unknown): string {
  try {
    if (typeof value === "string") return value;
    if (value instanceof Error) return errorText(value);
    return String(value);
  } catch {
    return "[unprintable]";
  }
}

function reasonText(reason: unknown): string {
  try {
    if (typeof reason === "object" && reason !== null && "message" in reason) {
      const { message } = reason;
      if (typeof message === "string" && message !== "") return message;
    }
  } catch {
    // A hostile `message` getter: fall through to the generic text.
  }
  return text(reason);
}

/** Text of a window `error` event; a plain Event has no `message` / `filename`. */
function errorEventText(e: Event): string {
  if (!(e instanceof ErrorEvent)) return `error event: ${e.type}`;
  const base = e.message !== "" ? e.message : text(e.error);
  const where = e.filename !== "" ? ` ${e.filename}:${String(e.lineno)}` : "";
  return `${base}${where}`;
}

/**
 * Forwards window `error` and `unhandledrejection` events and `console.error`
 * calls to `log`. Never throws, swallows `log` failures and never re-forwards
 * while a forward is in flight on the same call stack. Returns an uninstall
 * function.
 */
export function installWebviewErrorForwarder(
  target: Window,
  log: (message: string) => Promise<void>,
  con: Console = console,
): () => void {
  let inFlight = false;

  const forward = (describe: () => string): void => {
    if (inFlight) return;
    inFlight = true;
    try {
      let message: string;
      try {
        message = describe();
      } catch {
        message = "[unprintable error]";
      }
      Promise.resolve(log(message)).catch(() => undefined);
    } catch {
      // Best effort: a throwing logger must not escape.
    } finally {
      inFlight = false;
    }
  };

  const onError = (e: Event): void => {
    try {
      forward(() => errorEventText(e));
    } catch {
      // Never throw from a listener.
    }
  };

  const onRejection = (e: Event): void => {
    try {
      forward(() => reasonText((e as PromiseRejectionEvent).reason));
    } catch {
      // Never throw from a listener.
    }
  };

  const original = con.error;
  const patched = (...args: unknown[]): void => {
    try {
      forward(() => args.map(text).join(" "));
    } catch {
      // Never throw from the console hook.
    }
    original.apply(con, args);
  };

  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  con.error = patched;

  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
    if (con.error === patched) con.error = original;
  };
}
