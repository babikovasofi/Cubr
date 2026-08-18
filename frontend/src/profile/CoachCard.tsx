// Карточка личной аналитики в профиле (V3 «коуч»). Считается из уже загруженной
// истории — второго запроса нет. Логика в `coach.ts`, здесь только показ.
//
// Честная рамка: никаких фаз сборки (крест/F2L/OLL/PLL) — их нет и не может быть
// без зрения по видео (R1). Только то, что реально следует из времени и статуса
// уже сохранённых сборок, и только когда данных достаточно (`MIN_SAMPLE`).

import type { SolveRead } from "../api/solves";
import { formatSolveMs } from "../lib/formatTime";
import { useSettingsStore } from "../store/settingsStore";
import { buildCoachSummary, MIN_SAMPLE } from "./coach";
import { useT } from "../i18n/t";

function Shell({ children }: { children: React.ReactNode }) {
  const t = useT();
  return (
    <section
      aria-label={t("Коуч")}
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4.5"
    >
      {children}
    </section>
  );
}

function fmtPct1(n: number): string {
  return Math.abs(n).toFixed(1);
}

export default function CoachCard({ solves }: { solves: SolveRead[] }) {
  const t = useT();
  const timeFormat = useSettingsStore((s) => s.timeFormat);
  const summary = buildCoachSummary(solves);
  const {
    validCount,
    attemptCount,
    medianMs,
    p25Ms,
    p75Ms,
    bestMs,
    worstMs,
    likelyLucky,
    trendRecentMedianMs,
    trendPriorMedianMs,
    trendDeltaPct,
    dnfRate,
    dnfTrendRecentRate,
    dnfTrendPriorRate,
    dnfTrendDeltaPts,
  } = summary;

  const ms = (v: number) => formatSolveMs(v, timeFormat);

  return (
    <Shell>
      <h3 className="font-sans text-h3 text-ink">{t("Коуч")}</h3>

      {medianMs === null || p25Ms === null || p75Ms === null ? (
        <p className="font-sans text-body text-muted">
          {t("Нужно ещё {n} сборок, чтобы делать честные выводы (сейчас {count} из {min}).", {
            n: Math.max(0, MIN_SAMPLE - validCount),
            count: validCount,
            min: MIN_SAMPLE,
          })}
        </p>
      ) : (
        <>
          <p className="font-sans text-body text-ink">
            {t("Обычно собираешь между {p25} и {p75}.", { p25: ms(p25Ms), p75: ms(p75Ms) })}
          </p>

          {bestMs !== null && worstMs !== null ? (
            <p className="font-sans text-body text-ink">
              {t("Лучшая {best} · типичная {median} · худшая {worst}.", {
                best: ms(bestMs),
                median: ms(medianMs),
                worst: ms(worstMs),
              })}
            </p>
          ) : null}

          {likelyLucky ? (
            <p className="font-sans text-small text-warning">
              {t("Рекорд заметно быстрее типичного темпа — возможно, повезло.")}
            </p>
          ) : (
            <p className="font-sans text-small text-muted">
              {t("Рекорд близко к типичному темпу — стабильный уровень.")}
            </p>
          )}

          {trendRecentMedianMs !== null && trendPriorMedianMs !== null ? (
            <p className="font-sans text-small text-muted">
              {trendDeltaPct === null
                ? t("За последние {n} сборок медиана {recent}, за предыдущие {n} — {prior}.", {
                    n: MIN_SAMPLE,
                    recent: ms(trendRecentMedianMs),
                    prior: ms(trendPriorMedianMs),
                  })
                : Math.abs(trendDeltaPct) < 0.05
                  ? t(
                      "За последние {n} сборок медиана {recent}, за предыдущие {n} — {prior}: без изменений.",
                      {
                        n: MIN_SAMPLE,
                        recent: ms(trendRecentMedianMs),
                        prior: ms(trendPriorMedianMs),
                      },
                    )
                  : trendDeltaPct < 0
                    ? t(
                        "За последние {n} сборок медиана {recent}, за предыдущие {n} — {prior}: быстрее на {pct}%.",
                        {
                          n: MIN_SAMPLE,
                          recent: ms(trendRecentMedianMs),
                          prior: ms(trendPriorMedianMs),
                          pct: fmtPct1(trendDeltaPct),
                        },
                      )
                    : t(
                        "За последние {n} сборок медиана {recent}, за предыдущие {n} — {prior}: медленнее на {pct}%.",
                        {
                          n: MIN_SAMPLE,
                          recent: ms(trendRecentMedianMs),
                          prior: ms(trendPriorMedianMs),
                          pct: fmtPct1(trendDeltaPct),
                        },
                      )}
            </p>
          ) : (
            <p className="font-sans text-small text-muted">
              {t("Тренд появится после ещё {n} сборок (нужно {min} на сравнение).", {
                n: Math.max(0, MIN_SAMPLE * 2 - validCount),
                min: MIN_SAMPLE * 2,
              })}
            </p>
          )}
        </>
      )}

      {dnfRate === null ? (
        <p className="font-sans text-small text-muted">
          {t("Доля незавершённых сборок появится после {min} попыток (сейчас {count}).", {
            min: MIN_SAMPLE,
            count: attemptCount,
          })}
        </p>
      ) : (
        <p className="font-sans text-small text-ink">
          {t("Доля незавершённых сборок: {pct}% (по {count} попыткам).", {
            pct: Math.round(dnfRate * 100),
            count: attemptCount,
          })}
          {dnfTrendRecentRate !== null &&
          dnfTrendPriorRate !== null &&
          dnfTrendDeltaPts !== null ? (
            <>
              {" "}
              {(() => {
                const delta = Math.round(dnfTrendDeltaPts);
                const recentPct = Math.round(dnfTrendRecentRate * 100);
                const priorPct = Math.round(dnfTrendPriorRate * 100);
                if (delta === 0) {
                  return t("Было {prior}%, стало {recent}% — без изменений.", {
                    prior: priorPct,
                    recent: recentPct,
                  });
                }
                return delta > 0
                  ? t("Было {prior}%, стало {recent}% — растёт.", {
                      prior: priorPct,
                      recent: recentPct,
                    })
                  : t("Было {prior}%, стало {recent}% — снижается.", {
                      prior: priorPct,
                      recent: recentPct,
                    });
              })()}
            </>
          ) : null}
        </p>
      )}
    </Shell>
  );
}
