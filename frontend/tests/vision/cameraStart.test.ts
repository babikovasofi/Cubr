// @vitest-environment jsdom
//
// Живой багрепорт: камера работает, а поверх видео висит «Нет доступа к камере».
// Причина — два параллельных запуска: второй сносил живой поток первого и
// заново просил getUserMedia, а Safari такой повторный запрос отклонял.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Camera } from "../../src/vision/hooks/useCamera";

function fakeTrack() {
  return {
    readyState: "live",
    stop: vi.fn(),
    addEventListener: vi.fn(),
    applyConstraints: vi.fn().mockResolvedValue(undefined),
    getCapabilities: () => ({}),
  };
}

function fakeStream() {
  const track = fakeTrack();
  return { getVideoTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream;
}

function fakeVideo(): HTMLVideoElement {
  return {
    srcObject: null,
    playsInline: false,
    muted: false,
    readyState: 4,
    videoWidth: 1280,
    videoHeight: 720,
    play: vi.fn().mockResolvedValue(undefined),
  } as unknown as HTMLVideoElement;
}

let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  getUserMedia = vi
    .fn()
    .mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(fakeStream()), 5)));
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => vi.unstubAllGlobals());

describe("Camera.start", () => {
  it("два параллельных запуска берут устройство ОДИН раз", async () => {
    const cam = new Camera(fakeVideo());
    await Promise.all([cam.start(() => {}), cam.start(() => {})]);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(cam.isLive()).toBe(true);
  });

  it("повторный запуск на живой камере ничего не переоткрывает", async () => {
    const cam = new Camera(fakeVideo());
    await cam.start(() => {});
    await cam.start(() => {});
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("после остановки камеру можно поднять заново", async () => {
    const cam = new Camera(fakeVideo());
    await cam.start(() => {});
    cam.stop();
    expect(cam.isLive()).toBe(false);
    await cam.start(() => {});
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it("отказ в доступе доходит до вызывающего как CameraError", async () => {
    getUserMedia.mockRejectedValueOnce(
      Object.assign(new Error("denied"), { name: "NotAllowedError" }),
    );
    const cam = new Camera(fakeVideo());
    await expect(cam.start(() => {})).rejects.toMatchObject({ kind: "denied" });
    // Неудача не оставляет «идущий запуск» — следующая попытка реально пробует.
    await cam.start(() => {});
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });
});
