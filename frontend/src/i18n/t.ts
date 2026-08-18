// Локализация RU/EN. Ключ перевода — САМА РУССКАЯ СТРОКА, а не `footer.rules`.
//
// Почему так:
//  • при `ru` возвращается ключ, поэтому существующие тесты, ищущие русский
//    текст, продолжают проходить без единой правки;
//  • при `en` непереведённое место остаётся русским, а не показывает
//    `footer.rules` живому человеку — частичное покрытие деградирует мягко;
//  • не надо выдумывать и синхронизировать реестр ключей.
//
// Цена: переформулировал русскую строку — потерял перевод. Для двух языков это
// дешевле реестра.
//
// Словарь EN — 60 кБ исходника и растёт с каждой фичей. Русский — исходный
// язык и дефолт настройки (см. langStore), поэтому статический импорт en.ts
// грузил бы этот вес всем, включая тех, кто его никогда не откроет. Вместо
// этого словарь тянется динамическим `import()` — отдельным чанком — и только
// когда язык реально `en`. Кто грузит его до первого рендера при сохранённом
// `en`, чтобы не мигать русским, см. main.tsx.

import { useEffect } from "react";
import { useSyncExternalStore } from "react";
import { useLangStore, type Lang } from "../store/langStore";

export type Dict = Record<string, string>;

/** Сигнатура переводчика — для модулей, которым его передают параметром. */
export type T = (key: string, params?: Record<string, string | number>) => string;

// `ru` не хранит словарь — исходный текст И ЕСТЬ перевод. `en` заполняется
// один раз, лениво, через loadEnDict().
const DICTS: Partial<Record<Lang, Dict>> = {};

let enPromise: Promise<Dict> | null = null;
const readyListeners = new Set<() => void>();

function notifyReady(): void {
  for (const listener of readyListeners) listener();
}

/** Есть ли словарь `en` уже в памяти — синхронная проверка для рендера. */
export function isEnDictReady(): boolean {
  return DICTS.en !== undefined;
}

/** Подписка на «словарь en догрузился» — для useSyncExternalStore в useT(). */
export function subscribeEnDictReady(listener: () => void): () => void {
  readyListeners.add(listener);
  return () => readyListeners.delete(listener);
}

/**
 * Догружает словарь `en` отдельным чанком. Идемпотентна и безопасна для
 * параллельных вызовов — второй вызов во время загрузки отдаёт тот же промис.
 *
 * Ошибка чанка (оборвалась сеть, выкатили новую версию) не пробрасывается
 * дальше вызывающего: словарь остаётся пустым, `translate("en", …)` продолжает
 * отдавать русский ключ — та же деградация, что и у RouteErrorBoundary для
 * упавших роутов, см. её комментарий.
 */
export function loadEnDict(): Promise<Dict> {
  if (DICTS.en) return Promise.resolve(DICTS.en);
  if (!enPromise) {
    enPromise = import("./en")
      .then((mod) => {
        DICTS.en = mod.EN;
        notifyReady();
        return mod.EN;
      })
      .catch((err: unknown) => {
        console.error("failed to load the English dictionary chunk", err);
        enPromise = null; // разрешить повторную попытку при следующем переключении
        throw err;
      });
  }
  return enPromise;
}

/** Подстановки вида `{name}`. Отсутствующий параметр оставляет плейсхолдер. */
function interpolate(text: string, params?: Record<string, string | number>): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match,
  );
}

/**
 * Перевод без React — для модулей вне компонентов.
 *
 * На `en` до того, как словарь догрузился, отдаёт русский ключ — не белый
 * экран и не идентификатор, см. заголовок файла. Компоненты сами подгружают
 * словарь через useT(); этой функции для загрузки достаточно вызвать
 * loadEnDict() самостоятельно (так делает main.tsx до первого рендера).
 */
export function translate(
  lang: Lang,
  key: string,
  params?: Record<string, string | number>,
): string {
  const dict = DICTS[lang];
  return interpolate(dict?.[key] ?? key, params);
}

/** Хук перевода: перерисовывает компонент при смене языка и когда словарь `en`
 *  догружается. */
export function useT(): T {
  const lang = useLangStore((s) => s.lang);
  // Подписка нужна ровно чтобы перерисовать компонент, когда loadEnDict()
  // резолвится позже, чем этот рендер — сам возвращаемый флаг не читается.
  useSyncExternalStore(subscribeEnDictReady, isEnDictReady, isEnDictReady);

  // Внешняя синхронизация: догрузка чанка словаря — не вывод состояния из
  // пропсов, а побочный эффект (сеть), поэтому в useEffect, а не в теле рендера.
  useEffect(() => {
    if (lang === "en" && !isEnDictReady()) {
      // Ошибка уже залогирована и обработана внутри loadEnDict() — здесь
      // достаточно не оставить непойманный reject: это fire-and-forget.
      loadEnDict().catch(() => undefined);
    }
  }, [lang]);

  return (key, params) => translate(lang, key, params);
}
