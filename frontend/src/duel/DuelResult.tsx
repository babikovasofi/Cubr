// Duel result panel (plan: stage4-duel-by-link). Shows both times, the
// winner or "ничья", and a "Реванш" button — cups/rating are deliberately
// NOT shown (Stage 4 explicitly excludes both, see plan Out of scope) and
// honesty is never surfaced (self-reported, server always "pending").

import Button from "../components/Button";
import Timer from "../components/Timer";
import type { DuelH2HRead, DuelSeriesRead } from "../api/duel";
import type { CardData } from "../share/resultCard";
import ShareCardButton from "../share/ShareCardButton";
import { useAuthStore } from "../store/authStore";
import { useSettingsStore } from "../store/settingsStore";
import { formatSolveMs, type TimeFormat } from "../lib/formatTime";
import type { DuelResultPayload, PlayerSlot } from "./duelMachine";
import { useT, type T } from "../i18n/t";
import { pluralRu } from "../i18n/plural";

export interface DuelResultProps {
  result: DuelResultPayload;
  yourSlot: PlayerSlot;
  onRematch: () => void;
  rematchBusy: boolean;
  rematchError: string | null;
  h2h: DuelH2HRead | null;
  // Running score of the CURRENT SITTING of rematches (plan: rematch-series)
  // — as opposed to `h2h`'s lifetime record. `null` on a still-loading or
  // failed best-effort fetch — the line is simply absent, same as `h2h`.
  series: DuelSeriesRead | null;
  // Absent on a bootstrap-only reload with no live scramble in state — the
  // share card is skipped rather than drawn without it (plan: result-share-card).
  scramble: string | null;
}

function formatTime(
  status: "pending" | "valid" | "dnf",
  timeMs: number | null,
  format: TimeFormat,
): string {
  if (status === "dnf" || timeMs === null) return "DNF";
  return formatSolveMs(timeMs, format);
}

// Whole-phrase-is-the-key plural forms (see i18n/plural.ts) — [one, few,
// many]. "раз" is grammatically identical for the "one" and "many" buckets
// (1 раз, 5 раз), so those two forms collapse to the same dictionary key;
// English covers both with the same "time(s)" template (see en.ts).
const H2H_PHRASES = [
  "Вы играли {n} раз, счёт {you}:{opp}",
  "Вы играли {n} раза, счёт {you}:{opp}",
  "Вы играли {n} раз, счёт {you}:{opp}",
] as const;

// Series line (plan: rematch-series) — current-sitting score, distinct from
// h2h's lifetime one. "игра" declines fully (игра/игры/игр), no collision.
const SERIES_PHRASES = [
  "В этой серии {n} игра, счёт {you}:{opp}",
  "В этой серии {n} игры, счёт {you}:{opp}",
  "В этой серии {n} игр, счёт {you}:{opp}",
] as const;

const DRAW_PHRASES = ["(+{n} ничья)", "(+{n} ничьи)", "(+{n} ничьих)"] as const;

interface RecordCounts {
  played: number;
  your_wins: number;
  opponent_wins: number;
  draws: number;
}

function recordLabel(
  t: T,
  phrases: readonly [string, string, string],
  counts: RecordCounts,
): string {
  let label = t(pluralRu(counts.played, phrases), {
    n: counts.played,
    you: counts.your_wins,
    opp: counts.opponent_wins,
  });
  if (counts.draws > 0) {
    label += ` ${t(pluralRu(counts.draws, DRAW_PHRASES), { n: counts.draws })}`;
  }
  return label;
}

export default function DuelResult({
  result,
  yourSlot,
  onRematch,
  rematchBusy,
  rematchError,
  h2h,
  series,
  scramble,
}: DuelResultProps) {
  const t = useT();
  const ownId = useAuthStore((s) => s.user?.id ?? null);
  const timeFormat = useSettingsStore((s) => s.timeFormat);
  const you = result.players.find((p) => p.slot === yourSlot) ?? null;
  const opponent = result.players.find((p) => p.slot !== yourSlot) ?? null;

  const draw = result.winner_id === null;
  const youWon = !draw && ownId !== null && result.winner_id === ownId;
  const quiet = draw || !youWon; // §6.3 quiet loss/draw treatment — no red slab

  const outcomeLabel = draw ? "Ничья" : youWon ? "Ты выиграл" : "Не в этот раз";

  // Card mirrors ONLY what's already on screen — the formatted times and this
  // outcome label. Never winner_id/any UUID/email (privacy, plan: result-share-card).
  const yourTime = formatTime(you?.status ?? "pending", you?.time_ms ?? null, timeFormat);
  const opponentTime = formatTime(
    opponent?.status ?? "pending",
    opponent?.time_ms ?? null,
    timeFormat,
  );
  const cardData: CardData | null = scramble
    ? {
        kind: "duel",
        dnf: false,
        timeLabel: yourTime,
        scramble,
        dateLabel: new Date().toLocaleDateString("ru-RU"),
        duel: { outcome: outcomeLabel, you: yourTime, opponent: opponentTime },
      }
    : null;

  return (
    <section className="flex flex-col gap-4 overflow-hidden rounded-lg border border-line bg-surface">
      <div className={quiet ? "bg-surface-2 px-7 py-3" : "px-7 pt-7"}>
        <span className="font-sans text-overline uppercase text-muted">{t("Дуэль")}</span>
      </div>

      <div className="px-7 text-center">
        <h3 className="font-sans text-h3 text-ink">{outcomeLabel}</h3>
        {h2h && h2h.played > 0 ? (
          <p className="mt-1 font-sans text-caption text-muted">
            {recordLabel(t, H2H_PHRASES, h2h)}
          </p>
        ) : null}
        {series && series.played >= 2 ? (
          <p className="mt-1 font-sans text-caption text-muted">
            {recordLabel(t, SERIES_PHRASES, series)}
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-4 px-7 pb-7">
        <div className="flex flex-col items-center gap-2 rounded-md border border-line bg-surface-2 p-4">
          <span className="font-sans text-caption uppercase text-muted">{t("Ты")}</span>
          <Timer value={yourTime} phase={you?.status === "dnf" ? "dnf" : "success"} />
        </div>
        <div className="flex flex-col items-center gap-2 rounded-md border border-line bg-surface-2 p-4">
          <span className="font-sans text-caption uppercase text-muted">{t("Соперник")}</span>
          <Timer value={opponentTime} phase={opponent?.status === "dnf" ? "dnf" : "success"} />
        </div>
      </div>

      <div className="flex flex-col items-start gap-3 px-7 pb-7">
        <Button onClick={onRematch} disabled={rematchBusy}>
          {rematchBusy ? t("Готовлю реванш…") : t("Реванш")}
        </Button>
        {cardData ? <ShareCardButton data={cardData} /> : null}
        {rematchError ? (
          <p role="alert" className="font-sans text-small text-danger">
            {rematchError}
          </p>
        ) : null}
      </div>
    </section>
  );
}
