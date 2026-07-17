// «Челлендж недели»: one shared scramble a week, one attempt, recorded once — no
// standings yet (plan: tournament-ui, out of scope). Composes useTournamentAttempt
// (state machine reading/starting/submitting the attempt) with the same ritual
// solo uses (SolveRitual), reused via useSoloSession's fixed-scramble + onResult
// options. П8: the scramble is revealed ONLY after an explicit commit click — the
// ritual (and therefore useScramble) is not even MOUNTED before that.

import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import Button from "../components/Button";
import Spinner from "../components/Spinner";
import SolveRitual from "../solo/SolveRitual";
import { useSoloSession } from "../solo/useSoloSession";
import TournamentResult from "../tournament/TournamentResult";
import TournamentStandings from "../tournament/TournamentStandings";
import { useTournamentStandings } from "../tournament/useTournamentStandings";
import {
  useTournamentAttempt,
  type RitualResult,
  type TournamentState,
} from "../tournament/useTournamentAttempt";

function useCountdown(deadlineIso: string | null): { label: string; expired: boolean } {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!deadlineIso) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [deadlineIso]);

  if (!deadlineIso) return { label: "", expired: false };
  const remainingMs = new Date(deadlineIso).getTime() - now;
  const expired = remainingMs <= 0;
  const totalSec = Math.max(0, Math.floor(remainingMs / 1000));
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  return { label: `${mm}:${String(ss).padStart(2, "0")}`, expired };
}

// Mounted ONLY while phase === "active" — this is what makes the П8 guarantee
// hold: useScramble (inside useSoloSession) never exists, so never fetches or
// even could leak the scramble, until a commit already happened server-side.
function ActiveRitual({
  scramble,
  onResult,
}: {
  scramble: string;
  onResult: (r: RitualResult) => void;
}) {
  const s = useSoloSession({ fixedScramble: scramble, disableSoloSave: true, onResult });
  return <SolveRitual s={s} />;
}

function Card({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border-2 border-ink bg-surface p-7">
      {children}
    </div>
  );
}

function Overline({ children }: { children: ReactNode }) {
  return <span className="font-sans text-overline uppercase text-muted">{children}</span>;
}

function PrecommitCard({ current, commit }: { current: TournamentState["current"]; commit: () => void }) {
  const [confirming, setConfirming] = useState(false);

  return (
    <Card>
      <Overline>Челлендж недели{current ? ` · ${current.week_label}` : ""}</Overline>
      <h3 className="font-sans text-h3 text-ink">Одна попытка на всю неделю</h3>
      <p className="max-w-prose font-sans text-body text-muted">
        Скрамбл общий для всех участников этой недели. Сборка идёт как в соло, но результат
        фиксируется сразу и без переигровок. Таблицы результатов пока нет — это личный вызов, не
        дуэль.
      </p>
      <div className="rounded-md border border-line bg-surface-2 px-3.5 py-3">
        <p className="font-sans text-small font-bold text-ink">
          «Сделать попытку» сразу покажет скрамбл этой недели и потратит единственную попытку.
          Отменить нельзя.
        </p>
      </div>

      {!confirming ? (
        <Button onClick={() => setConfirming(true)} className="self-start">
          Сделать попытку
        </Button>
      ) : (
        <div className="flex flex-col gap-3 rounded-md border border-line px-3.5 py-3">
          <p className="font-sans text-small text-ink">
            Точно начать? Скрамбл станет виден сразу, вернуться назад будет нельзя.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button variant="danger" onClick={commit}>
              Да, начать
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Отмена
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function ResumeCard({ current, commit }: { current: TournamentState["current"]; commit: () => void }) {
  const { label, expired } = useCountdown(current?.deadline_at ?? null);

  return (
    <Card>
      <Overline>Челлендж недели{current ? ` · ${current.week_label}` : ""}</Overline>
      <h3 className="font-sans text-h3 text-ink">Попытка уже начата</h3>
      <p className="max-w-prose font-sans text-body text-muted">
        {expired
          ? "Окно попытки, похоже, истекло — жми «Продолжить», сервер сам защитает результат."
          : `Осталось ${label} на эту попытку. Скрамбл прежний — «Продолжить» вернёт к нему.`}
      </p>
      <Button onClick={commit} className="self-start">
        Продолжить
      </Button>
    </Card>
  );
}

function ErrorCard({
  message,
  retryLabel,
  onRetry,
  reauth,
}: {
  message: string | null;
  retryLabel: string;
  onRetry: () => void;
  reauth?: boolean;
}) {
  return (
    <Card>
      <p role="alert" className="max-w-prose font-sans text-body text-danger">
        {message ?? "Что-то пошло не так. Попробуй ещё раз."}
      </p>
      {reauth ? (
        <p className="font-sans text-small text-muted">
          Результат сохранён локально —{" "}
          <Link to="/login?next=/tournament" className="font-bold text-primary">
            войди заново
          </Link>
          , затем повтори отправку.
        </p>
      ) : null}
      <Button onClick={onRetry} className="self-start">
        {retryLabel}
      </Button>
    </Card>
  );
}

export default function TournamentPage() {
  const { state, commit, submit, retrySubmit, retryLoad } = useTournamentAttempt();
  const { phase, current, attempt, terminal, error, submitErrorKind } = state;
  const standings = useTournamentStandings();

  const onResult = (r: RitualResult): void => {
    void submit(r);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="font-sans text-h2 text-ink">Челлендж недели</h2>
        <Link to="/" className="font-sans text-body font-bold text-primary no-underline">
          ← На главную
        </Link>
      </div>

      {phase === "loading" ? <Spinner label="Загружаю состояние недели…" /> : null}

      {phase === "load_error" ? (
        <ErrorCard message={error} retryLabel="Повторить" onRetry={() => void retryLoad()} />
      ) : null}

      {phase === "precommit" ? (
        <PrecommitCard current={current} commit={() => void commit()} />
      ) : null}

      {phase === "resume" ? <ResumeCard current={current} commit={() => void commit()} /> : null}

      {phase === "committing" ? <Spinner label="Готовлю попытку…" /> : null}

      {phase === "commit_error" ? (
        <ErrorCard message={error} retryLabel="Повторить" onRetry={() => void commit()} />
      ) : null}

      {phase === "active" && attempt ? (
        <ActiveRitual scramble={attempt.scramble} onResult={onResult} />
      ) : null}

      {phase === "submitting" ? <Spinner label="Отправляю результат…" /> : null}

      {phase === "submit_error" ? (
        <ErrorCard
          message={
            submitErrorKind === "unauthorized"
              ? "Сессия истекла, пока шла сборка."
              : submitErrorKind === "network"
                ? "Не удалось отправить результат — проверь интернет."
                : error
          }
          retryLabel="Повторить отправку"
          onRetry={() => void retrySubmit()}
          reauth={submitErrorKind === "unauthorized"}
        />
      ) : null}

      {phase === "terminal" && terminal ? <TournamentResult result={terminal} /> : null}

      <TournamentStandings
        data={standings.data}
        loading={standings.loading}
        error={standings.error}
        reload={standings.reload}
      />
    </div>
  );
}
