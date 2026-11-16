/** Forwards uncaught webview errors to the native log (see storage.logWebviewError). */

/** Message always included: JavaScriptCore's `stack` holds frames only. */
function errorText(error: Error): string {
  const head = `${error.name}: ${error.message}`;
  const stack = error.stack;
  if (stack === undefined || stack === "") return head;
  if (stack.includes(error.message)) return stack;
  return `${head}\n${stack}`;
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return errorText(value);
  try {
    return String(value);
  } catch {
    return "[unprintable]";
  }
}

function reasonText(reason: unknown): string {
  if (typeof reason === "object" && reason !== null && "message" in reason) {
    const { message } = reason;
    if (typeof message === "string" && message !== "") return message;
  }
  return text(reason);
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

  const forward = (message: string): void => {
    if (inFlight) return;
    inFlight = true;
    try {
      Promise.resolve(log(message)).catch(() => undefined);
    } catch {
      // Best effort: a throwing logger must not escape.
    } finally {
      inFlight = false;
    }
  };

  const onError = (e: ErrorEvent): void => {
    try {
      const base = e.message !== "" ? e.message : text(e.error);
      const where =
        e.filename !== "" ? ` ${e.filename}:${String(e.lineno)}` : "";
      forward(`${base}${where}`);
    } catch {
      // Never throw from a listener.
    }
  };

  const onRejection = (e: PromiseRejectionEvent): void => {
    try {
      forward(reasonText(e.reason));
    } catch {
      // Never throw from a listener.
    }
  };

  const original = con.error;
  const patched = (...args: unknown[]): void => {
    try {
      forward(args.map(text).join(" "));
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
