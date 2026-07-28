// Этап 6 (R8): MVP официально десктопный — камера + кубик + обе руки на столе
// со смартфона не работают. Здесь только ЧИСТАЯ детекция «основной ввод — палец»;
// что с этим делать, решает components/DesktopOnlyGate.
//
// Сознательно БЕЗ ширины экрана: узкое окно на десктопе — не телефон, а resize или
// поворот не должны выбрасывать человека из активной сборки. Ноутбук с тачскрином
// репортит `hover: hover` (мышь есть) и гейт не ловит. Планшет репортит `hover: none`
// и ловится — ритуал на нём так же неудобен.

export const HANDHELD_QUERY = "(hover: none) and (pointer: coarse)";

/** UA-фолбэк на случай, если `matchMedia` недоступен (старый/экзотический браузер). */
const MOBILE_UA = /Android|iPhone|iPad|iPod|IEMobile|Opera Mini|Mobile|Silk/i;

export interface DeviceProbe {
  /** `window.matchMedia(q).matches`; undefined — если matchMedia нет вовсе. */
  matchesMedia?: (query: string) => boolean;
  maxTouchPoints?: number;
  userAgent?: string;
}

export function isHandheldDevice(probe: DeviceProbe): boolean {
  if (probe.matchesMedia) {
    try {
      return probe.matchesMedia(HANDHELD_QUERY);
    } catch {
      // Сломанный matchMedia — падаем в UA-фолбэк ниже, а не гейтим вслепую.
    }
  }
  const touch = (probe.maxTouchPoints ?? 0) > 0;
  return touch && MOBILE_UA.test(probe.userAgent ?? "");
}

/** Снимок текущего окружения. Guarded для non-DOM (node-тесты/SSR). */
export function probeDevice(): DeviceProbe {
  if (typeof window === "undefined") return {};
  const mm = typeof window.matchMedia === "function" ? window.matchMedia.bind(window) : undefined;
  return {
    matchesMedia: mm ? (q) => mm(q).matches : undefined,
    maxTouchPoints: typeof navigator !== "undefined" ? navigator.maxTouchPoints : 0,
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
  };
}
