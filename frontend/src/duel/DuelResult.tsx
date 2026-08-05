// Duel result panel (plan: stage4-duel-by-link). Shows both times, the
// winner or "ничья", and a "Реванш" button — cups/rating are deliberately
// NOT shown (Stage 4 explicitly excludes both, see plan Out of scope) and
// honesty is never surfaced (self-reported, server always "pending").

import Button from "../components/Button";
import Timer from "../components/Timer";
import type { DuelH2HRead } from "../api/duel";
import type { CardData } from "../share/resultCard";
import ShareCardButton from "../share/ShareCardButton";
import { useAuthStore } from "../store/authStore";
import { useSettingsStore } from "../store/settingsStore";
import { formatSolveMs, type TimeFormat } from "../lib/formatTime";
import type { DuelResultPayload, PlayerSlot } from "./duelMachine";
import { useT } from "../i18n/t";

export interface DuelResultProps {
  result: DuelResultPayload;
  yourSlot: PlayerSlot;
  onRematch: () => void;
  rematchBusy: boolean;
  rematchError: string | null;
  h2h: DuelH2HRead | null;
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

// Standard Russian plural-form picker: [one, few, many] e.g. 1 → forms[0],
// 2-4 → forms[1], 0/5-20/25.. → forms[2] — 11-14 fall into "many" (mod-100
// check), not the mod-10 "few" bucket they'd otherwise hit.
function pluralizeRu(n: number, forms: [string, string, string]): string {
  const mod100 = Math.abs(n) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

function h2hLabel(h2h: DuelH2HRead): string {
  const times = pluralizeRu(h2h.played, ["раз", "раза", "раз"]);
  let label = `Вы играли ${h2h.played} ${times}, счёт ${h2h.your_wins}:${h2h.opponent_wins}`;
  if (h2h.draws > 0) {
    const draws = pluralizeRu(h2h.draws, ["ничья", "ничьи", "ничьих"]);
    label += ` (+${h2h.draws} ${draws})`;
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
          <p className="mt-1 font-sans text-caption text-muted">{h2hLabel(h2h)}</p>
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
