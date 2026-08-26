// Карточка цели в профиле (V3 «Цели и стрики»). Считается из уже загруженной
// истории — второго запроса нет. Логика в `goals.ts`, здесь только показ.
//
// Две разные вещи в одной карточке и это осознанно: «куда дальше» (следующий
// рубеж по личному рекорду) и «что закрепить» (последний пробитый рубеж и
// сколько последних сборок под ним подряд). Одна цифра врала бы: рекорд без
// стабильности — везение, стабильность без рекорда — потолок.

import type { SolveRead } from "../api/solves";
import { formatSolveMs } from "../lib/formatTime";
import { useSettingsStore } from "../store/settingsStore";
import { goalProgress, milestoneLabel, STREAK_TARGET } from "./goals";
import EmptyState from "../components/EmptyState";
import { useT } from "../i18n/t";

function Shell({ children }: { children: React.ReactNode }) {
  const t = useT();
  return (
    <section
      aria-label={t("Цель")}
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4.5"
    >
      {children}
    </section>
  );
}

export default function GoalCard({ solves }: { solves: SolveRead[] }) {
  const t = useT();
  const timeFormat = useSettingsStore((s) => s.timeFormat);
  const { nextMs, bestMs, gapMs, holdMs, streakUnder, stable } = goalProgress(solves);

  if (bestMs === null) {
    return (
      <EmptyState
        title={t("Цель")}
        description={t(
          "Появится после первой засчитанной сборки — рубеж подбирается по твоему рекорду.",
        )}
      />
    );
  }

  const cells = Array.from({ length: STREAK_TARGET }, (_, i) => i < streakUnder);

  return (
    <Shell>
      <h3 className="font-sans text-h3 text-ink">
        {nextMs === null
          ? t("Цель: все рубежи взяты")
          : t("Цель: собрать быстрее {milestone}", { milestone: milestoneLabel(nextMs) })}
      </h3>

      <p className="font-sans text-body text-muted">
        {nextMs === null || gapMs === null
          ? t("Рекорд: {best}.", { best: formatSolveMs(bestMs, timeFormat) })
          : gapMs > 0
            ? t("До рубежа {gap} по личному рекорду ({best}).", {
                gap: formatSolveMs(gapMs, "seconds"),
                best: formatSolveMs(bestMs, timeFormat),
              })
            : t("Рекорд ровно на рубеже ({best}) — нужно быстрее.", {
                best: formatSolveMs(bestMs, timeFormat),
              })}
      </p>

      {holdMs === null ? (
        <p className="font-sans text-small text-muted">
          {t("Первый рубеж ещё не пробит — как только уложишься, появится счётчик стабильности.")}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          {/* Пять наклеек: сколько последних подряд уже ниже пробитого рубежа. */}
          <div className="flex gap-1.5" aria-hidden>
            {cells.map((filled, i) => (
              <span
                key={i}
                data-testid="goal-cell"
                className="h-5 w-5 rounded-sm border-2 border-ink"
                style={{ background: filled ? "var(--success)" : "var(--surface-2)" }}
              />
            ))}
          </div>
          <span className="font-sans text-small text-muted">
            {stable
              ? t("{target} подряд ниже {milestone} — рубеж держится.", {
                  target: STREAK_TARGET,
                  milestone: milestoneLabel(holdMs),
                })
              : t("{done} из {target} подряд ниже {milestone}.", {
                  done: streakUnder,
                  target: STREAK_TARGET,
                  milestone: milestoneLabel(holdMs),
                })}
          </span>
        </div>
      )}
    </Shell>
  );
}
