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
import { isCountdownMuted, scheduleCountdownBeeps, setCountdownMuted } from "./countdownSound";
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

// Speaker glyph for the mute toggle — inline SVG (no icon dep, no emoji),
// currentColor so it inherits the button's token-driven text color.
function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 7.5h3.2L10 4v12l-3.8-3.5H3z" />
      {muted ? (
        <path d="M13 7l4 6M17 7l-4 6" />
      ) : (
        <path d="M13.2 6.8a5 5 0 0 1 0 6.4M15.7 4.3a8.5 8.5 0 0 1 0 11.4" />
      )}
    </svg>
  );
}

// Purely visual gate over the camera/ritual until the server's synchronized
// start instant — does not touch the timer source of truth. The countdown
// audio (tick-tick-tick-go, plan: countdown-sounds) is scheduled here
// independently of the 100ms visual interval below — muting or the audio
// failing silently never affects the visible seconds/"Старт!" text.
function CountdownOverlay({
  serverStartAt,
  onElapsed,
}: {
  serverStartAt: string;
  onElapsed: () => void;
}) {
  const [remainingMs, setRemainingMs] = useState(() => new Date(serverStartAt).getTime() - Date.now());
  const [muted, setMuted] = useState(() => isCountdownMuted());
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

  useEffect(() => {
    if (muted) return;
    return scheduleCountdownBeeps(serverStartAt);
  }, [serverStartAt, muted]);

  const handleToggleMute = (): void => {
    const next = !muted;
    setCountdownMuted(next);
    setMuted(next);
  };

  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));

  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-lg bg-ink/90 text-center">
      <button
        type="button"
        onClick={handleToggleMute}
        aria-pressed={muted}
        aria-label={muted ? "Включить звук отсчёта" : "Выключить звук отсчёта"}
        className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-white/30 bg-white/10 px-3 py-1.5 font-sans text-caption font-bold text-white transition-colors hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <SpeakerIcon muted={muted} />
        <span>{muted ? "Без звука" : "Звук"}</span>
      </button>
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
