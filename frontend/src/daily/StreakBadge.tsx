// Серия ежедневных сборок (V3 «Цели и стрики»). Показывается на /daily над бордом.
// Числа приходят из GET /daily/streak — они выводятся сервером из попыток, а не
// хранятся счётчиком, поэтому «починить» серию нечем и незачем.
//
// Без эмодзи-огонька: из интерфейса эмодзи выпилены (см. лендинг/бейдж кубков) —
// акцент даёт наклейка в цвете `live`, как у остальных daily-элементов.

import { useEffect, useState } from "react";
import { ApiError } from "../api/client";
import { getDailyStreak, type DailyStreakRead } from "../api/daily";
import { useT, translate, type T } from "../i18n/t";
import { pluralRu } from "../i18n/plural";

const ruT: T = (key, params) => translate("ru", key, params);

const DONE_TODAY = [
  "{n} день подряд — сегодня уже засчитано.",
  "{n} дня подряд — сегодня уже засчитано.",
  "{n} дней подряд — сегодня уже засчитано.",
] as const;

const PENDING_TODAY = [
  "{n} день подряд. Сегодня ещё не пройден — серия оборвётся в полночь UTC.",
  "{n} дня подряд. Сегодня ещё не пройден — серия оборвётся в полночь UTC.",
  "{n} дней подряд. Сегодня ещё не пройден — серия оборвётся в полночь UTC.",
] as const;

const RECORD = ["Рекорд: {n} день", "Рекорд: {n} дня", "Рекорд: {n} дней"] as const;

/**
 * Текст статуса серии. Отдельно от рендера — тестируется без DOM.
 * Переводчик приходит параметром: по умолчанию русский, поэтому вызов с одним
 * аргументом (и старые тесты) видят ту же строку, что и раньше.
 */
export function streakHeadline(data: DailyStreakRead, t: T = ruT): string {
  if (data.current_streak === 0) {
    return data.best_streak > 0
      ? t("Серия прервалась. Пройди скрамбл дня — начнётся новая.")
      : t("Серии пока нет. Пройди скрамбл дня — начнётся.");
  }
  const n = data.current_streak;
  return t(pluralRu(n, data.completed_today ? DONE_TODAY : PENDING_TODAY), { n });
}

export default function StreakBadge() {
  const t = useT();
  const [data, setData] = useState<DailyStreakRead | null>(null);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    getDailyStreak(controller.signal)
      .then((result) => {
        if (alive) setData(result);
      })
      .catch((e) => {
        // Серия — украшение поверх ритуала: её недоступность не должна ничего
        // ломать и не заслуживает экрана ошибки. 401 отработает ProtectedRoute.
        if (!(e instanceof ApiError) && !(e instanceof Error)) throw e;
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, []);

  if (!data) return null;

  return (
    <section
      aria-label={t("Серия ежедневных сборок")}
      className="flex flex-wrap items-center gap-4 rounded-lg border border-line bg-surface px-4.5 py-3.5"
    >
      <span
        aria-hidden
        className="inline-flex h-9 min-w-9 items-center justify-center rounded-sm border-2 border-ink px-2 font-sans text-body font-black text-ink"
        style={{ background: "var(--live)" }}
      >
        {data.current_streak}
      </span>
      <span className="font-sans text-body text-ink">{streakHeadline(data, t)}</span>
      {data.best_streak > 0 ? (
        <span className="font-sans text-small text-muted">
          {t(pluralRu(data.best_streak, RECORD), { n: data.best_streak })}
        </span>
      ) : null}
    </section>
  );
}
