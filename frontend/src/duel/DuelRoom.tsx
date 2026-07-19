// Duel room — the shared-ritual half of the duel screen (plan:
// stage4-duel-by-link). Renders every non-terminal duelMachine phase
// (everything except "result", which DuelPage renders as DuelResult).
//
// Ritual reuse (KEY invariant — do NOT fork): the solve itself is the exact
// same `useSoloSession({ fixedScramble, onResult, disableSoloSave })` +
// `SolveRitual` pair the tournament brick uses (see
// tournament/useTournamentAttempt.ts / pages/TournamentPage.tsx's
// ActiveRitual). `onResult` here both records the local outcome
// (self_finished) and ships it over the socket (`finish`) — no /solves
// write, honesty stays "pending" server-side.
//
// The ritual is mounted whenever a scramble has been revealed
// (`state.scramble !== null`) — NOT gated on the top-level duel `phase` —
// so a mid-solve `opponent_left`/`disconnected` banner layers OVER the
// still-running ritual instead of tearing it down (§ disconnect-DNF: the
// solver may still be racing a deadline even after the opponent drops).
//
// Countdown overlay: purely a human-level gate ("поверх камеры до
// server_start_at") — it does NOT touch the timer's source of truth (that
// stays the hands-FSM + frame timestamps inside useSoloSession). See plan
// Assumptions: true ms-lockstep is not guaranteed, self-reported like the
// weekly challenge.

import { useEffect, useRef, useState, type Dispatch, type ReactNode } from "react";
import { Link } from "react-router-dom";
import Button from "../components/Button";
import Spinner from "../components/Spinner";
import SolveRitual from "../solo/SolveRitual";
import { useSoloSession } from "../solo/useSoloSession";
import InvitePanel from "./InvitePanel";
import {
  ritualPhaseToWire,
  type DuelAction,
  type DuelMachineState,
  type RitualOutcome,
} from "./duelMachine";
import type { DuelSocketApi } from "./useDuelSocket";

function Card({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border-2 border-ink bg-surface p-7">
      {children}
    </div>
  );
}

function WaitingCard() {
  return (
    <Card>
      <span className="font-sans text-overline uppercase text-muted">Дуэль по ссылке</span>
      <h3 className="font-sans text-h3 text-ink">Жду соперника</h3>
      <p className="max-w-prose font-sans text-body text-muted" aria-live="polite">
        Соперник ещё не подключился по приглашению.
      </p>
    </Card>
  );
}

function RoomNotFoundCard() {
  return (
    <Card>
      <p role="alert" className="max-w-prose font-sans text-body text-danger">
        Такой дуэли не существует — ссылка неверна или комната закрыта.
      </p>
      <Link to="/">
        <Button>На главную</Button>
      </Link>
    </Card>
  );
}

function DuelAlreadyActiveCard({ existingRoomId }: { existingRoomId: string | null }) {
  return (
    <Card>
      <p role="alert" className="max-w-prose font-sans text-body text-danger">
        У тебя уже есть активная дуэль — одновременно можно участвовать только в одной.
      </p>
      {existingRoomId ? (
        <Link to={`/duel/${existingRoomId}`}>
          <Button>Перейти к активной дуэли</Button>
        </Link>
      ) : (
        <Link to="/">
          <Button variant="secondary">На главную</Button>
        </Link>
      )}
    </Card>
  );
}

function OpponentLeftBanner({ graceSeconds }: { graceSeconds: number | null }) {
  return (
    <div
      role="status"
      className="flex flex-col gap-1 rounded-md border-2 border-l-8 border-ink border-l-warning bg-surface px-4 py-3"
    >
      <span className="font-sans text-small font-bold text-ink">Соперник отключился</span>
      <span className="font-sans text-small text-muted">
        {graceSeconds !== null
          ? `Жду его возвращения ещё ${graceSeconds} с — если не вернётся, дуэль завершится.`
          : "Жду его возвращения — если не вернётся, дуэль завершится автоматически."}
      </span>
    </div>
  );
}

function DisconnectedBanner() {
  return (
    <div
      role="status"
      className="flex flex-col gap-1 rounded-md border-2 border-l-8 border-ink border-l-danger bg-surface px-4 py-3"
    >
      <span className="font-sans text-small font-bold text-ink">Связь потеряна</span>
      <span className="font-sans text-small text-muted">Переподключаюсь…</span>
    </div>
  );
}

function ReadyWaitBanner() {
  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-md border border-line bg-surface-2 px-3.5 py-3"
    >
      <span
        aria-hidden
        className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-success"
      />
      <span className="font-sans text-small text-ink">Готов. Жду соперника…</span>
    </div>
  );
}

function FinishedWaitBanner() {
  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-md border border-line bg-surface-2 px-3.5 py-3"
    >
      <Spinner />
      <span className="font-sans text-small text-ink">Жду результат соперника…</span>
    </div>
  );
}

// Purely visual gate over the camera/ritual until the server's synchronized
// start instant — does not touch the timer source of truth.
function CountdownOverlay({
  serverStartAt,
  onElapsed,
}: {
  serverStartAt: string;
  onElapsed: () => void;
}) {
  const [remainingMs, setRemainingMs] = useState(() => new Date(serverStartAt).getTime() - Date.now());
  const firedRef = useRef(false);

  useEffect(() => {
    firedRef.current = false;
    const target = new Date(serverStartAt).getTime();
    const id = setInterval(() => {
      const left = target - Date.now();
      setRemainingMs(left);
      if (left <= 0 && !firedRef.current) {
        firedRef.current = true;
        clearInterval(id);
        onElapsed();
      }
    }, 100);
    return () => clearInterval(id);
  }, [serverStartAt, onElapsed]);

  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));

  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-lg bg-ink/90 text-center">
      <span className="font-sans text-h1 font-black text-white">{seconds > 0 ? seconds : "Старт!"}</span>
      <span className="font-sans text-small text-white/80">Приготовься — камера скрыта до старта.</span>
    </div>
  );
}

// Mounted only once a scramble has been revealed. Owns the identical
// solo ritual, diverted to the duel socket instead of /solves — see the
// module comment.
function ActiveRitual({
  scramble,
  dispatch,
  socket,
}: {
  scramble: string;
  dispatch: Dispatch<DuelAction>;
  socket: DuelSocketApi;
}) {
  const onResult = (r: RitualOutcome): void => {
    dispatch({ type: "self_finished", result: r });
    socket.sendFinish(r);
  };
  const s = useSoloSession({ fixedScramble: scramble, disableSoloSave: true, onResult });

  const lastSentRef = useRef<string | null>(null);
  useEffect(() => {
    const mapped = ritualPhaseToWire(s.state.phase);
    if (mapped === lastSentRef.current) return;
    lastSentRef.current = mapped;
    socket.sendStatusUpdate(mapped);
    if (mapped === "ready") dispatch({ type: "self_ready" });
    // socket/dispatch are stable across the ritual's lifetime (useDuelSocket
    // returns fresh function identities per render but they always read
    // through refs — see useDuelSocket.ts — so omitting them here is safe;
    // only the local ritual phase should re-run this effect).
  }, [s.state.phase]);

  return <SolveRitual s={s} />;
}

export interface DuelRoomProps {
  state: DuelMachineState;
  dispatch: Dispatch<DuelAction>;
  socket: DuelSocketApi;
  joinUrl: string | null;
}

export default function DuelRoom({ state, dispatch, socket, joinUrl }: DuelRoomProps) {
  const showRitual = state.scramble !== null;

  return (
    <div className="flex flex-col gap-4">
      {state.phase === "connecting" ? <Spinner label="Подключаюсь к комнате…" /> : null}

      {state.phase === "waiting_opponent" ? (
        joinUrl ? <InvitePanel joinUrl={joinUrl} /> : <WaitingCard />
      ) : null}

      {state.phase === "room_not_found" ? <RoomNotFoundCard /> : null}

      {state.phase === "duel_already_active" ? (
        <DuelAlreadyActiveCard existingRoomId={state.existingRoomId} />
      ) : null}

      {showRitual && state.scramble ? (
        <div className="relative">
          <ActiveRitual scramble={state.scramble} dispatch={dispatch} socket={socket} />
          {state.phase === "countdown" && state.serverStartAt ? (
            <CountdownOverlay
              serverStartAt={state.serverStartAt}
              onElapsed={() => dispatch({ type: "solving_start" })}
            />
          ) : null}
        </div>
      ) : null}

      {state.phase === "ready_wait" ? <ReadyWaitBanner /> : null}
      {state.phase === "finished" ? <FinishedWaitBanner /> : null}
      {state.phase === "opponent_left" ? <OpponentLeftBanner graceSeconds={state.graceSeconds} /> : null}
      {state.phase === "disconnected" ? <DisconnectedBanner /> : null}
    </div>
  );
}
