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

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <section
      aria-label="Цель"
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4.5"
    >
      {children}
    </section>
  );
}

export default function GoalCard({ solves }: { solves: SolveRead[] }) {
  const timeFormat = useSettingsStore((s) => s.timeFormat);
  const { nextMs, bestMs, gapMs, holdMs, streakUnder, stable } = goalProgress(solves);

  if (bestMs === null) {
    return (
      <Shell>
        <h3 className="font-sans text-h3 text-ink">Цель</h3>
        <p className="font-sans text-body text-muted">
          Появится после первой засчитанной сборки — рубеж подбирается по твоему рекорду.
        </p>
      </Shell>
    );
  }

  const cells = Array.from({ length: STREAK_TARGET }, (_, i) => i < streakUnder);

  return (
    <Shell>
      <h3 className="font-sans text-h3 text-ink">
        {nextMs === null ? "Цель: все рубежи взяты" : `Цель: ${milestoneLabel(nextMs)}`}
      </h3>

      <p className="font-sans text-body text-muted">
        {nextMs === null || gapMs === null
          ? `Рекорд: ${formatSolveMs(bestMs, timeFormat)}.`
          : gapMs > 0
            ? `До рубежа ${formatSolveMs(gapMs, "seconds")} по личному рекорду (${formatSolveMs(bestMs, timeFormat)}).`
            : `Рекорд ровно на рубеже (${formatSolveMs(bestMs, timeFormat)}) — нужно быстрее.`}
      </p>

      {holdMs === null ? (
        <p className="font-sans text-small text-muted">
          Первый рубеж ещё не пробит — как только уложишься, появится счётчик стабильности.
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
              ? `${STREAK_TARGET} подряд ниже ${milestoneLabel(holdMs)} — рубеж держится.`
              : `${streakUnder} из ${STREAK_TARGET} подряд ниже ${milestoneLabel(holdMs)}.`}
          </span>
        </div>
      )}
    </Shell>
  );
}
