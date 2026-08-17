// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { canShareFiles, shareOrDownload } from "../../src/share/shareCard";

function makeFile(): File {
  return new File(["x"], "cubr-result-1.png", { type: "image/png" });
}

describe("canShareFiles", () => {
  afterEach(() => {
    // @ts-expect-error test cleanup of a jsdom-absent API
    delete navigator.canShare;
  });

  it("false when navigator.canShare is absent", () => {
    expect(canShareFiles(makeFile())).toBe(false);
  });

  it("mirrors navigator.canShare({files})", () => {
    Object.defineProperty(navigator, "canShare", {
      value: vi.fn(() => true),
      configurable: true,
    });
    expect(canShareFiles(makeFile())).toBe(true);
  });
});

describe("shareOrDownload", () => {
  const meta = { title: "t", text: "d" };

  beforeEach(() => {
    // @ts-expect-error test cleanup of a jsdom-absent API
    delete navigator.canShare;
    // @ts-expect-error test cleanup of a jsdom-absent API
    delete navigator.share;
  });

  it("returns 'shared' and calls navigator.share with a File when canShare is true", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
    Object.defineProperty(navigator, "share", { value: share, configurable: true });

    const outcome = await shareOrDownload(new Blob(["x"]), "cubr-result-1.png", meta);
    expect(outcome).toBe("shared");
    expect(share).toHaveBeenCalledTimes(1);
    const call = share.mock.calls[0][0];
    expect(call.files[0]).toBeInstanceOf(File);
  });

  it("resolves without throwing when the user cancels (AbortError)", async () => {
    const abort = Object.assign(new Error("cancelled"), { name: "AbortError" });
    Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
    Object.defineProperty(navigator, "share", {
      value: vi.fn().mockRejectedValue(abort),
      configurable: true,
    });

    await expect(shareOrDownload(new Blob(["x"]), "f.png", meta)).resolves.toBe("shared");
  });

  it("rethrows a non-AbortError from navigator.share", async () => {
    const other = new Error("boom");
    Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
    Object.defineProperty(navigator, "share", {
      value: vi.fn().mockRejectedValue(other),
      configurable: true,
    });

    await expect(shareOrDownload(new Blob(["x"]), "f.png", meta)).rejects.toThrow("boom");
  });

  it("downloads via an anchor click + revokes the object URL when canShare is unavailable", async () => {
    const createObjectURL = vi.fn(() => "blob:fake");
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.useFakeTimers();

    const outcome = await shareOrDownload(new Blob(["x"]), "cubr-result-2.png", meta);
    expect(outcome).toBe("downloaded");
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);

    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake");

    vi.useRealTimers();
    clickSpy.mockRestore();
  });
});
