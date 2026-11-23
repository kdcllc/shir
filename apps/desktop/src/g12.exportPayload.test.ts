// g12 cross-task: the base64 export payload built by the TS wrapper (files.ts) as the Rust
// decoder expects it (tests/g12_integration.rs holds the same literal; scripts/g12-contract.test.ts
// keeps them identical). The IPC bindings are mocked; nothing touches a dialog or the disk.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./bindings", () => ({
  commands: { saveExportDocx: vi.fn() },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

import { commands } from "./bindings";
import { FileWriteError, saveExportDocx } from "./files";

const BYTES_0_255_BASE64 =
  "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0+P0BBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWltcXV5fYGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6e3x9fn+AgYKDhIWGh4iJiouMjY6PkJGSk5SVlpeYmZqbnJ2en6ChoqOkpaanqKmqq6ytrq+wsbKztLW2t7i5uru8vb6/wMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX2Nna29zd3t/g4eLj5OXm5+jp6uvs7e7v8PHy8/T19vf4+fr7/P3+/w==";

const save = vi.mocked(commands.saveExportDocx);

beforeEach(() => {
  save.mockReset();
  save.mockResolvedValue({ status: "ok", data: "/tmp/x.docx" });
});

describe("saveExportDocx base64 payload", () => {
  it("sends the 256 byte values as standard padded base64 and resolves the saved path", async () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    const path = await saveExportDocx("name.docx", "Word", bytes);
    expect(path).toBe("/tmp/x.docx");
    expect(save).toHaveBeenCalledTimes(1);
    const args = save.mock.calls[0] as unknown[];
    expect(args[0]).toBe("name.docx");
    expect(args[1]).toBe("Word");
    expect(typeof args[2]).toBe("string");
    expect(args[2]).toBe(BYTES_0_255_BASE64);
    expect(args[2]).toBe(Buffer.from(bytes).toString("base64"));
  });

  it("encodes a payload larger than 5 MiB byte for byte without a RangeError", async () => {
    const n = 5 * 1_048_576 + 1;
    const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 0xff);
    await expect(saveExportDocx("big.docx", "Word", bytes)).resolves.toBe(
      "/tmp/x.docx",
    );
    const arg = (save.mock.calls[0] as unknown[])[2] as string;
    expect(arg.length).toBe(4 * Math.ceil(n / 3));
    expect(Buffer.from(arg, "base64").equals(Buffer.from(bytes))).toBe(true);
  });

  it("maps an Invalid backend error to a FileWriteError of kind Invalid", async () => {
    save.mockResolvedValue({
      status: "error",
      error: { kind: "Invalid", message: "m" },
    });
    const err = await saveExportDocx(
      "a.docx",
      "Word",
      new Uint8Array([1]),
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(FileWriteError);
    expect((err as FileWriteError).kind).toBe("Invalid");
    expect((err as FileWriteError).message).toBe("m");
  });
});
