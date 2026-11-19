import { afterEach, describe, expect, it, vi } from "vitest";
import { installWebviewErrorForwarder } from "./webviewErrors";

type Log = (m: string) => Promise<void>;

function fakeConsole() {
  const error = vi.fn();
  const con: Console = { ...console, error };
  return { con, error };
}

function rejection(reason: unknown): Event {
  return Object.assign(new Event("unhandledrejection"), { reason });
}

const uninstalls: (() => void)[] = [];

function install(
  log: (m: string) => Promise<void>,
  con: Console = fakeConsole().con,
) {
  const off = installWebviewErrorForwarder(window, log, con);
  uninstalls.push(off);
  return off;
}

afterEach(() => {
  while (uninstalls.length > 0) uninstalls.pop()?.();
});

describe("installWebviewErrorForwarder", () => {
  it("forwards error events with filename:lineno", () => {
    const log = vi.fn<Log>(() => Promise.resolve());
    install(log);
    window.dispatchEvent(
      new ErrorEvent("error", {
        message: "boom",
        filename: "app.js",
        lineno: 12,
      }),
    );
    expect(log).toHaveBeenCalledExactlyOnceWith("boom app.js:12");
  });

  it("forwards error events without a filename as the bare message", () => {
    const log = vi.fn<Log>(() => Promise.resolve());
    install(log);
    window.dispatchEvent(new ErrorEvent("error", { message: "plain" }));
    expect(log).toHaveBeenCalledExactlyOnceWith("plain");
  });

  it("forwards unhandled rejections: Error message and String(reason)", () => {
    const log = vi.fn<Log>(() => Promise.resolve());
    install(log);
    window.dispatchEvent(rejection(new Error("nope")));
    window.dispatchEvent(rejection("just text"));
    window.dispatchEvent(rejection(42));
    expect(log.mock.calls.map((c) => c[0])).toEqual([
      "nope",
      "just text",
      "42",
    ]);
  });

  it("forwards console.error args joined by spaces and still calls the original", () => {
    const log = vi.fn<Log>(() => Promise.resolve());
    const { con, error } = fakeConsole();
    install(log, con);
    con.error("failed", 7, "x");
    expect(log).toHaveBeenCalledExactlyOnceWith("failed 7 x");
    expect(error).toHaveBeenCalledExactlyOnceWith("failed", 7, "x");
  });

  describe("console.error with an Error argument", () => {
    function forwardedFor(stack: string | undefined): string {
      const log = vi.fn<Log>(() => Promise.resolve());
      const { con } = fakeConsole();
      install(log, con);
      const err = new Error("boom");
      Object.defineProperty(err, "stack", { value: stack });
      con.error(err);
      return log.mock.calls[0]![0];
    }

    it("includes the message for a JavaScriptCore stack of frames only", () => {
      const out = forwardedFor("f@file:1:2");
      expect(out).toContain("boom");
      expect(out).toContain("f@file:1:2");
    });

    it("includes the message exactly once for a V8-style stack", () => {
      const out = forwardedFor("Error: boom\n    at f (file:1:2)");
      expect(out).toContain("at f");
      expect(out.split("boom")).toHaveLength(2);
    });

    it("includes the message when stack is undefined", () => {
      expect(forwardedFor(undefined)).toBe("Error: boom");
    });
  });

  it("forwards a plain error event without undefined parts", () => {
    const log = vi.fn<Log>(() => Promise.resolve());
    install(log);
    window.dispatchEvent(new Event("error"));
    expect(log).toHaveBeenCalledExactlyOnceWith("error event: error");
    expect(log.mock.calls[0]![0]).not.toContain("undefined");
  });

  describe("hostile and empty errors", () => {
    function forwardedFor(err: Error): string {
      const log = vi.fn<Log>(() => Promise.resolve());
      const { con } = fakeConsole();
      install(log, con);
      expect(() => con.error(err)).not.toThrow();
      expect(log).toHaveBeenCalledTimes(1);
      return log.mock.calls[0]![0];
    }

    it("forwards a fallback line for an Error whose stack getter throws", () => {
      const err = new Error("boom");
      Object.defineProperty(err, "stack", {
        get() {
          throw new Error("hostile");
        },
      });
      expect(forwardedFor(err)).toBe("[unprintable]");
    });

    it("forwards a fallback line for an Error whose message and name getters throw", () => {
      const err = new Error("x");
      for (const key of ["message", "name"])
        Object.defineProperty(err, key, {
          get() {
            throw new Error("hostile");
          },
        });
      expect(forwardedFor(err)).toBe("[unprintable]");
    });

    it("forwards the message for an Error whose stack is not a string", () => {
      const err = new Error("boom");
      Object.defineProperty(err, "stack", { value: 42 });
      expect(forwardedFor(err)).toBe("Error: boom");
    });

    it("does not throw from the window listeners for a hostile rejection reason", () => {
      const log = vi.fn<Log>(() => Promise.resolve());
      install(log);
      const reason = {
        get message(): string {
          throw new Error("hostile");
        },
      };
      expect(() => window.dispatchEvent(rejection(reason))).not.toThrow();
      expect(log).toHaveBeenCalledTimes(1);
    });

    it("includes the name for an Error with an empty message", () => {
      const err = new TypeError("");
      Object.defineProperty(err, "stack", { value: "f@file:1:2" });
      const out = forwardedFor(err);
      expect(out).toContain("TypeError");
      expect(out).toContain("f@file:1:2");
    });

    it("includes the name for an empty-message Error without a stack", () => {
      const err = new RangeError("");
      Object.defineProperty(err, "stack", { value: undefined });
      expect(forwardedFor(err)).toBe("RangeError");
    });
  });

  it("swallows a rejecting log and a throwing log", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    let forwarded = 0;
    const rejecting: Log = () => {
      forwarded += 1;
      return Promise.reject(new Error("down"));
    };
    const { con, error } = fakeConsole();
    install(rejecting, con);
    try {
      expect(() => con.error("a")).not.toThrow();
      window.dispatchEvent(new ErrorEvent("error", { message: "b" }));
      await new Promise((r) => setTimeout(r, 10));
      expect(forwarded).toBe(2);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(error).toHaveBeenCalledTimes(1);

    const throwing = vi.fn<Log>(() => {
      throw new Error("sync");
    });
    const second = fakeConsole();
    install(throwing, second.con);
    expect(() => second.con.error("c")).not.toThrow();
    expect(second.error).toHaveBeenCalledTimes(1);
  });

  it("does not re-forward while a forward is in flight on the same stack", () => {
    const { con, error } = fakeConsole();
    const log = vi.fn<Log>(() => {
      if (log.mock.calls.length < 5) con.error("from inside log");
      return Promise.resolve();
    });
    install(log, con);
    con.error("outer");
    expect(log).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(2);
    con.error("later");
    expect(log).toHaveBeenCalledTimes(2);
  });

  it("uninstall removes listeners and restores console.error", () => {
    const log = vi.fn<Log>(() => Promise.resolve());
    const { con, error } = fakeConsole();
    const off = install(log, con);
    expect(con.error).not.toBe(error);
    off();
    expect(con.error).toBe(error);
    con.error("quiet");
    window.dispatchEvent(new ErrorEvent("error", { message: "quiet" }));
    window.dispatchEvent(rejection("quiet"));
    expect(log).not.toHaveBeenCalled();
  });
});
