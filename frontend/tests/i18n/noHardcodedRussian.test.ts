// Русский текст, вписанный в разметку мимо переводчика.
//
// Такую строку не видит ни один существующий тест: она рендерится, выглядит
// правильно по-русски и молча остаётся русской при английском интерфейсе.
// Поймано живьём 2026-08-20 — на экране соло висел абзац «Cubr уже знает цвета
// „Moyu“…» посреди английского UI.
//
// Проверяем два места, где перевод забывают: текстовые узлы JSX и атрибуты,
// которые видит пользователь (подписи для скринридера, подсказки полей).

import { describe, it, expect } from "vitest";

const SOURCES = import.meta.glob("../../src/**/*.tsx", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

// Что исключено и почему:
//   accuracy/  — dev-харнесс замера точности, собирается только в DEV и живёт
//                для нас двоих; переводить его незачем.
//   dev/       — та же логика: dev-only лаборатория тюнинга таймера
//                (TimingLabPage), собирается только в DEV.
//   *Ru.tsx    — русские версии правил и приватности. У них есть пары *En.tsx,
//                выбор страницы делает роутер по языку, так что русский текст
//                внутри — это и есть содержимое, а не пропущенный перевод.
const EXCLUDED = /\/(accuracy|dev)\/|\/legal\/\w+Ru\.tsx$/;

const CYRILLIC = /[А-Яа-яЁё]/;

/** Комментарии — не интерфейс: в них русский уместен и обязателен. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function scan(src: string): string[] {
  const code = stripComments(src);
  const found: string[] = [];

  // Текстовый узел JSX: между > и < нет ни тегов, ни фигурных скобок.
  for (const m of code.matchAll(/>\s*([^<>{}]*)\s*</g)) {
    const text = m[1].trim();
    if (text.length >= 4 && CYRILLIC.test(text)) found.push(text.slice(0, 60));
  }

  // Атрибуты, которые читает человек (или его скринридер).
  const attrs = /\b(aria-label|placeholder|title|alt)="([^"]*)"/g;
  for (const m of code.matchAll(attrs)) {
    if (CYRILLIC.test(m[2])) found.push(`${m[1]}="${m[2].slice(0, 50)}"`);
  }

  return found;
}

describe("русский текст в разметке идёт через переводчик", () => {
  it("ни одного вписанного напрямую", () => {
    const offenders: string[] = [];
    for (const [file, src] of Object.entries(SOURCES)) {
      if (EXCLUDED.test(file)) continue;
      for (const text of scan(src)) offenders.push(`${file}: ${text}`);
    }
    expect(offenders).toEqual([]);
  });

  // Сторож самого сторожа: если регулярки перестанут что-либо находить (скажем,
  // после смены синтаксиса или сборщика), тест начнёт молча проходить на любом
  // коде. Проверяем, что он ловит образец.
  it("ловит подсунутый образец", () => {
    expect(scan("<p>Показать ответ</p>")).toHaveLength(1);
    expect(scan('<button aria-label="Закрыть" />')).toHaveLength(1);
    expect(scan('<p>{t("Показать ответ")}</p>')).toHaveLength(0);
    expect(scan("// Показать ответ — комментарий\n<p>ok</p>")).toHaveLength(0);
  });
});
