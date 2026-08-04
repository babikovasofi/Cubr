// «Скрамбл дня»: one shared scramble a day, one attempt, recorded once — same
// shape as the weekly challenge (plan: daily-scramble, mirrors TournamentPage).
// Composes useDailyAttempt (state machine reading/starting/submitting the
// attempt) with the same ritual solo uses (SolveRitual), reused via
// useSoloSession's fixed-scramble + onResult options. П8: the scramble is
// revealed ONLY after an explicit commit click — the ritual (and therefore
// useScramble) is not even MOUNTED before that.

import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import Button from "../components/Button";
import Spinner from "../components/Spinner";
import SolveRitual from "../solo/SolveRitual";
import { useSoloSession } from "../solo/useSoloSession";
import DailyResult from "../daily/DailyResult";
import DailyBoard from "../daily/DailyBoard";
import StreakBadge from "../daily/StreakBadge";
import { useDailyBoard } from "../daily/useDailyBoard";
import { useDailyAttempt, type RitualResult, type DailyState } from "../daily/useDailyAttempt";
import { useT } from "../i18n/t";

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

function PrecommitCard({
  current,
  commit,
}: {
  current: DailyState["current"];
  commit: () => void;
}) {
  const t = useT();
  const [confirming, setConfirming] = useState(false);

  return (
    <Card>
      <Overline>
        {t("Скрамбл дня")}
        {current ? ` · ${current.day_label}` : ""}
      </Overline>
      <h3 className="font-sans text-h3 text-ink">{t("Одна попытка на весь день")}</h3>
      <p className="max-w-prose font-sans text-body text-muted">
        {t(
          "Скрамбл общий для всех участников этого дня. Сборка идёт как в соло, но результат фиксируется сразу и без переигровок. Таблицы результатов пока нет — это личный вызов, не дуэль.",
        )}
      </p>
      <div className="rounded-md border border-line bg-surface-2 px-3.5 py-3">
        <p className="font-sans text-small font-bold text-ink">
          {t(
            "«Сделать попытку» сразу покажет скрамбл этого дня и потратит единственную попытку. Отменить нельзя.",
          )}
        </p>
      </div>

      {!confirming ? (
        <Button onClick={() => setConfirming(true)} className="self-start">
          {t("Сделать попытку")}
        </Button>
      ) : (
        <div className="flex flex-col gap-3 rounded-md border border-line px-3.5 py-3">
          <p className="font-sans text-small text-ink">
            {t("Точно начать? Скрамбл станет виден сразу, вернуться назад будет нельзя.")}
          </p>
          <div className="flex flex-wrap gap-3">
            <Button variant="danger" onClick={commit}>
              {t("Да, начать")}
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              {t("Отмена")}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function ResumeCard({ current, commit }: { current: DailyState["current"]; commit: () => void }) {
  const t = useT();
  const { label, expired } = useCountdown(current?.deadline_at ?? null);

  return (
    <Card>
      <Overline>
        {t("Скрамбл дня")}
        {current ? ` · ${current.day_label}` : ""}
      </Overline>
      <h3 className="font-sans text-h3 text-ink">{t("Попытка уже начата")}</h3>
      <p className="max-w-prose font-sans text-body text-muted">
        {expired
          ? t("Окно попытки, похоже, истекло — жми «Продолжить», сервер сам защитает результат.")
          : t("Осталось {label} на эту попытку. Скрамбл прежний — «Продолжить» вернёт к нему.", {
              label,
            })}
      </p>
      <Button onClick={commit} className="self-start">
        {t("Продолжить")}
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
  const t = useT();
  return (
    <Card>
      <p role="alert" className="max-w-prose font-sans text-body text-danger">
        {t(message ?? "Что-то пошло не так. Попробуй ещё раз.")}
      </p>
      {reauth ? (
        <p className="font-sans text-small text-muted">
          {t("Результат сохранён локально —")}{" "}
          <Link to="/login?next=/daily" className="font-bold text-primary">
            {t("войди заново")}
          </Link>
          {t(", затем повтори отправку.")}
        </p>
      ) : null}
      <Button onClick={onRetry} className="self-start">
        {retryLabel}
      </Button>
    </Card>
  );
}

export default function DailyPage() {
  const t = useT();
  const { state, commit, submit, retrySubmit, retryLoad } = useDailyAttempt();
  const { phase, current, attempt, terminal, error, submitErrorKind } = state;
  const board = useDailyBoard();

  const onResult = (r: RitualResult): void => {
    void submit(r);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="font-sans text-h2 text-ink">{t("Скрамбл дня")}</h2>
        <Link to="/" className="font-sans text-body font-bold text-primary no-underline">
          {t("← На главную")}
        </Link>
      </div>

      {/* Серия — над состоянием дня: это причина зайти, а не результат попытки. */}
      <StreakBadge />

      {phase === "loading" ? <Spinner label={t("Загружаю состояние дня…")} /> : null}

      {phase === "load_error" ? (
        <ErrorCard message={error} retryLabel={t("Повторить")} onRetry={() => void retryLoad()} />
      ) : null}

      {phase === "precommit" ? (
        <PrecommitCard current={current} commit={() => void commit()} />
      ) : null}

      {phase === "resume" ? <ResumeCard current={current} commit={() => void commit()} /> : null}

      {phase === "committing" ? <Spinner label={t("Готовлю попытку…")} /> : null}

      {phase === "commit_error" ? (
        <ErrorCard message={error} retryLabel={t("Повторить")} onRetry={() => void commit()} />
      ) : null}

      {phase === "active" && attempt ? (
        <ActiveRitual scramble={attempt.scramble} onResult={onResult} />
      ) : null}

      {phase === "submitting" ? <Spinner label={t("Отправляю результат…")} /> : null}

      {phase === "submit_error" ? (
        <ErrorCard
          message={
            submitErrorKind === "unauthorized"
              ? "Сессия истекла, пока шла сборка."
              : submitErrorKind === "network"
                ? "Не удалось отправить результат — проверь интернет."
                : error
          }
          retryLabel={t("Повторить отправку")}
          onRetry={() => void retrySubmit()}
          reauth={submitErrorKind === "unauthorized"}
        />
      ) : null}

      {phase === "terminal" && terminal ? <DailyResult result={terminal} /> : null}

      <DailyBoard
        data={board.data}
        loading={board.loading}
        error={board.error}
        reload={board.reload}
      />
    </div>
  );
}
