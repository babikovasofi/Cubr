// Чеклист состояний userflow §10: «камера — доступ запрещён / нет камеры /
// занята другим приложением». Тексты живут в одном месте и должны различаться:
// пользователь по ним понимает, что чинить.

import { describe, it, expect } from "vitest";
import { cameraErrorRu } from "../../src/vision/cameraErrors";

describe("cameraErrorRu", () => {
  it.each([
    ["denied", /разреш/i],
    ["not-found", /не найдена/i],
    ["in-use", /занята другим приложением/i],
    ["insecure", /https/i],
    ["unsupported", /браузер/i],
  ] as const)("%s объясняет причину", (kind, pattern) => {
    expect(cameraErrorRu(kind)).toMatch(pattern);
  });

  it("каждая причина — свой текст, а не общий «что-то пошло не так»", () => {
    const kinds = ["denied", "not-found", "in-use", "insecure", "unsupported"] as const;
    const texts = kinds.map((k) => cameraErrorRu(k));
    expect(new Set(texts).size).toBe(kinds.length);
  });
});
