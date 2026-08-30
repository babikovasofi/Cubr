import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { PASSWORD_HINT, PASSWORD_MIN_LENGTH } from "../../src/lib/password";

// Расхождение фронта и бэка по минимальной длине делало регистрацию
// непроходимой: форма обещала 8 символов, сервер требовал 10, и человек
// получал «минимум 8» на пароль из 9 символов. Тест держит числа вместе.
describe("минимальная длина пароля", () => {
  it("совпадает с MIN_LENGTH бэкенда", () => {
    const policy = readFileSync(
      fileURLToPath(new URL("../../../backend/app/services/password_policy.py", import.meta.url)),
      "utf8",
    );
    const match = policy.match(/^MIN_LENGTH = (\d+)$/m);
    expect(match, "MIN_LENGTH не найден в password_policy.py").not.toBeNull();
    expect(PASSWORD_MIN_LENGTH).toBe(Number(match![1]));
  });

  it("названа в подсказке под полем", () => {
    expect(PASSWORD_HINT).toContain(String(PASSWORD_MIN_LENGTH));
  });
});
