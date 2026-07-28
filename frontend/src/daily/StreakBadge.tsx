// Серия ежедневных сборок (V3 «Цели и стрики»). Показывается на /daily над бордом.
// Числа приходят из GET /daily/streak — они выводятся сервером из попыток, а не
// хранятся счётчиком, поэтому «починить» серию нечем и незачем.
//
// Без эмодзи-огонька: из интерфейса эмодзи выпилены (см. лендинг/бейдж кубков) —
// акцент даёт наклейка в цвете `live`, как у остальных daily-элементов.

import { useEffect, useState } from "react";
import { ApiError } from "../api/client";
import { getDailyStreak, type DailyStreakRead } from "../api/daily";

export function daysWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "день";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "дня";
  return "дней";
}

/** Текст статуса серии. Отдельно от рендера — тестируется без DOM. */
export function streakHeadline(data: DailyStreakRead): string {
  if (data.current_streak === 0) {
    return data.best_streak > 0
      ? "Серия прервалась. Пройди скрамбл дня — начнётся новая."
      : "Серии пока нет. Пройди скрамбл дня — начнётся.";
  }
  const n = data.current_streak;
  return data.completed_today
    ? `${n} ${daysWord(n)} подряд — сегодня уже засчитано.`
    : `${n} ${daysWord(n)} подряд. Сегодня ещё не пройден — серия оборвётся в полночь UTC.`;
}

export default function StreakBadge() {
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
      aria-label="Серия ежедневных сборок"
      className="flex flex-wrap items-center gap-4 rounded-lg border border-line bg-surface px-4.5 py-3.5"
    >
      <span
        aria-hidden
        className="inline-flex h-9 min-w-9 items-center justify-center rounded-sm border-2 border-ink px-2 font-sans text-body font-black text-ink"
        style={{ background: "var(--live)" }}
      >
        {data.current_streak}
      </span>
      <span className="font-sans text-body text-ink">{streakHeadline(data)}</span>
      {data.best_streak > 0 ? (
        <span className="font-sans text-small text-muted">
          Рекорд: {data.best_streak} {daysWord(data.best_streak)}
        </span>
      ) : null}
    </section>
  );
}
