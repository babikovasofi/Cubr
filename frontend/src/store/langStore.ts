// Язык интерфейса. Русский — исходный язык продукта и дефолт; английский
// подхватывается автоматически, если браузер просит английский и выбор ещё не
// сделан руками.
//
// `<html lang>` меняется вместе с языком: его читают скринридеры и
// автопереводчики, и без этого страница врёт о себе.

import { create } from "zustand";

export type Lang = "ru" | "en";

const STORAGE_KEY = "cubr_lang";

export function isLang(value: unknown): value is Lang {
  return value === "ru" || value === "en";
}

/** Рабочее хранилище браузера или `undefined`.
 *
 *  Проверяем именно РАБОТОСПОСОБНОСТЬ, а не наличие: в jsdom и под Node на месте
 *  `localStorage` бывает заглушка, обращение к которой падает или молча ничего
 *  не хранит. Отсюда же берётся признак «мы в настоящем браузере» ниже. */
function storage(): Storage | undefined {
  try {
    const candidate = (globalThis as { localStorage?: Storage }).localStorage;
    candidate?.getItem(STORAGE_KEY);
    return candidate ?? undefined;
  } catch {
    return undefined;
  }
}

function readStored(): Lang | null {
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    return isLang(raw) ? raw : null;
  } catch {
    return null;
  }
}

function browserLang(): Lang {
  if (typeof navigator === "undefined") return "ru";
  const tags = navigator.languages?.length ? navigator.languages : [navigator.language ?? ""];
  return tags.some((tag) => tag.toLowerCase().startsWith("en")) ? "en" : "ru";
}

export function initialLang(): Lang {
  const stored = readStored();
  if (stored) return stored;
  // Автоподбор языка — только там, где есть настоящее хранилище: иначе выбор
  // некуда записать, и каждый заход угадывал бы заново. Русский — исходный язык
  // продукта, поэтому он же и дефолт.
  return storage() ? browserLang() : "ru";
}

function applyHtmlLang(lang: Lang): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("lang", lang);
}

interface LangState {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

const startLang = initialLang();
applyHtmlLang(startLang);

export const useLangStore = create<LangState>((set) => ({
  lang: startLang,
  setLang: (lang) => {
    try {
      storage()?.setItem(STORAGE_KEY, lang);
    } catch {
      /* приватный режим — выбор не переживёт перезагрузку, но работает сейчас */
    }
    applyHtmlLang(lang);
    set({ lang });
  },
}));
