// «Что дальше» — карточка внизу ResultScreen (соло). Сравнение со средним и
// рекордом, прогресс к цели sub-N и следующее действие. Вся арифметика — в
// nextCardModel.ts (buildNextCard); этот компонент только рисует и держит
// маленькое локальное состояние кнопки «Позвать на дуэль».
//
// Дизайн (design-system §1, §6.3): рабочий вид — тихая карточка `1px line`;
// «рекорд побит» — единственный момент праздника, стикер-пилюля `2px ink` +
// `shadow-sticker`, поворот −2°, ≤2% экрана. Никакого цвета поверх цвета.

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Button from "../components/Button";
import { createRoom, saveDuelSessionToken } from "../api/duel";
import { useAuthStore } from "../store/authStore";
import { useSettingsStore } from "../store/settingsStore";
import { formatSolveMs } from "../lib/formatTime";
import { buildNextCard, type NextCardModel } from "./nextCardModel";
import { milestoneLabel } from "../profile/goals";
import type { SoloHistory } from "./useSoloHistory";
import { useT, type T } from "../i18n/t";

export interface NextCardProps {
  dnf: boolean;
  /** Время этой сборки, мс. Игнорируется, когда `dnf` — DNF не несёт времени. */
  elapsedMs: number;
  history: SoloHistory;
  onAgain: () => void;
}

function Comparison({
  t,
  model,
  timeFormat,
}: {
  t: T;
  model: NextCardModel;
  timeFormat: "seconds" | "clock";
}) {
  if (!model.hasHistory) {
    return (
      <p className="font-sans text-body text-muted">
        {t("Сохрани ещё одну сборку — здесь появится сравнение со средним и рекордом.")}
      </p>
    );
  }

  const vsAverage =
    model.vsAverageMs === null
      ? null
      : model.vsAverageMs < 0
        ? t("Быстрее своего среднего на {delta}.", {
            delta: formatSolveMs(-model.vsAverageMs, "seconds"),
          })
        : model.vsAverageMs > 0
          ? t("Медленнее своего среднего на {delta}.", {
              delta: formatSolveMs(model.vsAverageMs, "seconds"),
            })
          : t("Ровно на уровне своего среднего.");

  const record = model.recordMs !== null ? formatSolveMs(model.recordMs, timeFormat) : "";

  return (
    <div className="flex flex-col gap-1">
      {vsAverage ? <p className="font-sans text-body text-ink">{vsAverage}</p> : null}
      {model.recordBeaten && model.beatRecordByMs !== null ? (
        <p className="font-sans text-body font-bold text-ink">
          {t("На {delta} быстрее прежнего рекорда ({record}).", {
            delta: formatSolveMs(model.beatRecordByMs, "seconds"),
            record,
          })}
        </p>
      ) : model.gapToRecordMs !== null ? (
        <p className="font-sans text-small text-muted">
          {model.gapToRecordMs === 0
            ? t("Ровно на уровне личного рекорда ({record}).", { record })
            : t("До личного рекорда {gap} ({record}).", {
                gap: formatSolveMs(model.gapToRecordMs, "seconds"),
                record,
              })}
        </p>
      ) : null}
    </div>
  );
}

function GoalLine({ t, model }: { t: T; model: NextCardModel }) {
  const { goal } = model;
  if (goal.bestMs === null) return null;

  if (goal.nextMs === null) {
    return goal.holdMs !== null ? (
      <p className="font-sans text-small text-muted">
        {t("Все обычные рубежи взяты — держишь {milestone}.", {
          milestone: milestoneLabel(goal.holdMs),
        })}
      </p>
    ) : null;
  }

  return (
    <p className="font-sans text-small text-muted">
      {goal.gapMs === 0
        ? t("На рубеже {milestone} — нужно чуть быстрее.", {
            milestone: milestoneLabel(goal.nextMs),
          })
        : t("До цели {milestone} осталось {gap}.", {
            milestone: milestoneLabel(goal.nextMs),
            gap: formatSolveMs(goal.gapMs ?? 0, "seconds"),
          })}
    </p>
  );
}

function RecordBadge({ t }: { t: T }) {
  return (
    <div
      aria-hidden
      style={{ transform: "rotate(-2deg)" }}
      className="inline-flex w-fit items-center self-start rounded-md border-2 border-ink bg-success px-3 py-1.5 font-sans text-small font-extrabold uppercase text-white shadow-sticker"
    >
      {t("Новый личный рекорд!")}
    </div>
  );
}

function Actions({ t, onAgain, authed }: { t: T; onAgain: () => void; authed: boolean }) {
  const navigate = useNavigate();
  const [duelBusy, setDuelBusy] = useState(false);
  const [duelError, setDuelError] = useState<string | null>(null);

  async function startDuel(): Promise<void> {
    setDuelBusy(true);
    setDuelError(null);
    try {
      const room = await createRoom();
      saveDuelSessionToken(room.room_id, room.session_token);
      navigate(`/duel/${room.room_id}`, { state: { joinUrl: room.join_url } });
    } catch {
      setDuelError(t("Не удалось создать дуэль. Попробуй ещё раз."));
      setDuelBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-3">
      <div className="flex flex-wrap gap-3">
        <Button onClick={onAgain}>{t("Ещё раз")}</Button>
        {authed ? (
          <Button variant="secondary" onClick={() => void startDuel()} disabled={duelBusy}>
            {duelBusy ? t("Создаю комнату…") : t("Позвать на дуэль")}
          </Button>
        ) : null}
        {authed ? (
          <Link to="/daily" className="no-underline">
            <Button variant="secondary">{t("Скрамбл дня")}</Button>
          </Link>
        ) : null}
      </div>
      {duelError ? (
        <p role="alert" className="font-sans text-small text-danger">
          {duelError}
        </p>
      ) : null}
    </div>
  );
}

export default function NextCard({ dnf, elapsedMs, history, onAgain }: NextCardProps) {
  const t = useT();
  const timeFormat = useSettingsStore((s) => s.timeFormat);
  const authed = useAuthStore((s) => s.status === "authed");
  const { state } = history;

  const currentMs = dnf ? null : Math.round(elapsedMs);
  const solves = state.kind === "ok" ? state.solves : [];
  const model = buildNextCard(solves, currentMs);
  const celebrate = !dnf && model.recordBeaten;

  return (
    <section
      aria-label={t("Что дальше")}
      className={[
        "flex w-full flex-col gap-4 rounded-lg bg-surface p-6 text-left",
        celebrate ? "border-2 border-ink shadow-sticker-lg" : "border border-line",
      ].join(" ")}
    >
      {celebrate ? (
        <RecordBadge t={t} />
      ) : (
        <h3 className="font-sans text-h3 text-ink">{t("Что дальше")}</h3>
      )}

      {state.kind === "loading" ? (
        <p className="font-sans text-body text-muted">{t("Считаю статистику…")}</p>
      ) : state.kind === "error" ? (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="font-sans text-small text-danger">
            {t("Не удалось посчитать сравнение со статистикой.")}
          </p>
          <Button variant="secondary" onClick={history.reload}>
            {t("Повторить")}
          </Button>
        </div>
      ) : dnf ? (
        <p className="font-sans text-body text-muted">
          {t("Эта попытка не защитана — сравнение появится у следующей засчитанной сборки.")}
        </p>
      ) : (
        <Comparison t={t} model={model} timeFormat={timeFormat} />
      )}

      {!dnf && state.kind !== "loading" && state.kind !== "error" ? (
        <GoalLine t={t} model={model} />
      ) : null}

      <Actions t={t} onAgain={onAgain} authed={authed} />
    </section>
  );
}
