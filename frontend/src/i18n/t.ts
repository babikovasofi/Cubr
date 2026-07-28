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

import { EN } from "./en";
import { useLangStore, type Lang } from "../store/langStore";

export type Dict = Record<string, string>;

const DICTS: Record<Lang, Dict | null> = {
  ru: null, // русский — исходный текст, словарь не нужен
  en: EN,
};

/** Подстановки вида `{name}`. Отсутствующий параметр оставляет плейсхолдер. */
function interpolate(text: string, params?: Record<string, string | number>): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match,
  );
}

/** Перевод без React — для модулей вне компонентов. */
export function translate(
  lang: Lang,
  key: string,
  params?: Record<string, string | number>,
): string {
  const dict = DICTS[lang];
  return interpolate(dict?.[key] ?? key, params);
}

/** Хук перевода: перерисовывает компонент при смене языка. */
export function useT(): (key: string, params?: Record<string, string | number>) => string {
  const lang = useLangStore((s) => s.lang);
  return (key, params) => translate(lang, key, params);
}
