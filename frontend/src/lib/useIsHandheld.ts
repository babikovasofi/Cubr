// Реактивная обёртка над lib/device: пересчитывает детекцию, когда меняется
// media-состояние (подключили мышь, десктопный режим в мобильном браузере).

import { useEffect, useState } from "react";
import { HANDHELD_QUERY, isHandheldDevice, probeDevice } from "./device";

export function useIsHandheld(): boolean {
  const [handheld, setHandheld] = useState(() => isHandheldDevice(probeDevice()));

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    let mql: MediaQueryList;
    try {
      mql = window.matchMedia(HANDHELD_QUERY);
    } catch {
      return;
    }
    if (typeof mql.addEventListener !== "function") return;
    const onChange = () => setHandheld(isHandheldDevice(probeDevice()));
    // Первый пересчёт сразу: между useState-инициализацией и подпиской окружение
    // могло смениться (StrictMode-перемонтирование, смена ориентации).
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return handheld;
}
