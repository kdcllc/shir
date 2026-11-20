import { Packer } from "docx";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { docOf, entry, LABELS, META } from "./testSupport";

const { saveExportDocx } = vi.hoisted(() => ({ saveExportDocx: vi.fn() }));
vi.mock("../files", () => ({ saveExportDocx }));

import { buildDocx } from "./docx";
import { saveDocx } from "./saveDocx";

const doc = docOf("רשימת/שירים", [entry("he_niqqud")]);
const opts = { cover: false, labels: LABELS, meta: META, filterName: "Word" };

beforeEach(() => {
  saveExportDocx.mockReset();
});

describe("saveDocx", () => {
  it("returns cancelled when the dialog is dismissed", async () => {
    saveExportDocx.mockResolvedValue(null);
    await expect(saveDocx(doc, opts)).resolves.toEqual({ status: "cancelled" });
    expect(saveExportDocx).toHaveBeenCalledTimes(1);
  });

  it("returns the final saved path and passes name, filter and bytes", async () => {
    saveExportDocx.mockResolvedValue("/home/u/רשימת-שירים (2).docx");
    await expect(saveDocx(doc, opts)).resolves.toEqual({
      status: "saved",
      path: "/home/u/רשימת-שירים (2).docx",
    });
    const [name, filter, bytes] = saveExportDocx.mock.calls[0] as [
      string,
      string,
      Uint8Array,
    ];
    expect(name).toBe("רשימת-שירים.docx");
    expect(filter).toBe("Word");
    expect(bytes).toBeInstanceOf(Uint8Array);
    // A .docx is a zip: "PK".
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]);
  });

  it("propagates save errors", async () => {
    saveExportDocx.mockImplementation(() =>
      Promise.reject(new Error("disk full")),
    );
    let message = "";
    try {
      await saveDocx(doc, opts);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe("disk full");
  });
});

describe("buildDocx packer", () => {
  it("never uses Packer.toBuffer (Node Buffer fails in the webview)", async () => {
    const toBuffer = vi.spyOn(Packer, "toBuffer");
    const toBlob = vi.spyOn(Packer, "toBlob");
    await buildDocx(doc, { cover: false, labels: LABELS, meta: META });
    expect(toBuffer).not.toHaveBeenCalled();
    expect(toBlob).toHaveBeenCalledTimes(1);
  });
});
