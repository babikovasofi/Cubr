// Duel result panel (plan: stage4-duel-by-link). Shows both times, the
// winner or "ничья", and a "Реванш" button — cups/rating are deliberately
// NOT shown (Stage 4 explicitly excludes both, see plan Out of scope) and
// honesty is never surfaced (self-reported, server always "pending").

import Button from "../components/Button";
import Timer from "../components/Timer";
import { useAuthStore } from "../store/authStore";
import type { DuelResultPayload, PlayerSlot } from "./duelMachine";

export interface DuelResultProps {
  result: DuelResultPayload;
  yourSlot: PlayerSlot;
  onRematch: () => void;
  rematchBusy: boolean;
  rematchError: string | null;
}

function formatTime(status: "pending" | "valid" | "dnf", timeMs: number | null): string {
  if (status === "dnf" || timeMs === null) return "DNF";
  return (timeMs / 1000).toFixed(2);
}

export default function DuelResult({
  result,
  yourSlot,
  onRematch,
  rematchBusy,
  rematchError,
}: DuelResultProps) {
  const ownId = useAuthStore((s) => s.user?.id ?? null);
  const you = result.players.find((p) => p.slot === yourSlot) ?? null;
  const opponent = result.players.find((p) => p.slot !== yourSlot) ?? null;

  const draw = result.winner_id === null;
  const youWon = !draw && ownId !== null && result.winner_id === ownId;
  const quiet = draw || !youWon; // §6.3 quiet loss/draw treatment — no red slab

  const outcomeLabel = draw ? "Ничья" : youWon ? "Ты выиграл" : "Не в этот раз";

  return (
    <section className="flex flex-col gap-4 overflow-hidden rounded-lg border border-line bg-surface">
      <div className={quiet ? "bg-surface-2 px-7 py-3" : "px-7 pt-7"}>
        <span className="font-sans text-overline uppercase text-muted">Дуэль</span>
      </div>

      <div className="px-7 text-center">
        <h3 className="font-sans text-h3 text-ink">{outcomeLabel}</h3>
      </div>

      <div className="grid grid-cols-2 gap-4 px-7 pb-7">
        <div className="flex flex-col items-center gap-2 rounded-md border border-line bg-surface-2 p-4">
          <span className="font-sans text-caption uppercase text-muted">Ты</span>
          <Timer
            value={formatTime(you?.status ?? "pending", you?.time_ms ?? null)}
            phase={you?.status === "dnf" ? "dnf" : "success"}
          />
        </div>
        <div className="flex flex-col items-center gap-2 rounded-md border border-line bg-surface-2 p-4">
          <span className="font-sans text-caption uppercase text-muted">Соперник</span>
          <Timer
            value={formatTime(opponent?.status ?? "pending", opponent?.time_ms ?? null)}
            phase={opponent?.status === "dnf" ? "dnf" : "success"}
          />
        </div>
      </div>

      <div className="flex flex-col items-start gap-3 px-7 pb-7">
        <Button onClick={onRematch} disabled={rematchBusy}>
          {rematchBusy ? "Готовлю реванш…" : "Реванш"}
        </Button>
        {rematchError ? (
          <p role="alert" className="font-sans text-small text-danger">
            {rematchError}
          </p>
        ) : null}
      </div>
    </section>
  );
}
