// Visual scramble walkthrough: one <twisty-player> animating the current move,
// the plain-Russian direction for it (moveCopy — the source of truth, since a
// twisty animation alone is ambiguous for a non-cuber), a progress bar, back/next,
// a minimap, keyboard control, an orientation banner, and a notation/visual toggle
// persisted to localStorage. Ported from prototype2/main.ts over the pure
// walkthrough + moveCopy modules.

import { useEffect, useRef, useState } from "react";
import { useTwisty } from "../scramble/hooks/useTwisty";
import { moveLabelRu } from "../scramble/moveCopy";
import { useT } from "../i18n/t";

const NOTATION_KEY = "cubr.scramble.showNotation";
const SPEED_KEY = "cubr.scramble.autoplaySpeed";

// Пауза между ходами в автопрокрутке. Медленно — темп «повторяю за экраном»,
// быстро — для тех, кто читает нотацию с листа. Значения подобраны от реального
// времени анимации twisty (~300 мс на ход): ниже 600 мс ход не успевает
// дочитаться глазами.
export const AUTOPLAY_SPEEDS = [
  { id: "slow", label: "медленно", delayMs: 2200 },
  { id: "normal", label: "обычно", delayMs: 1400 },
  { id: "fast", label: "быстро", delayMs: 900 },
] as const;

export type AutoplaySpeedId = (typeof AUTOPLAY_SPEEDS)[number]["id"];

export function speedById(id: string | null): (typeof AUTOPLAY_SPEEDS)[number] {
  return AUTOPLAY_SPEEDS.find((s) => s.id === id) ?? AUTOPLAY_SPEEDS[1];
}

interface ScrambleWalkthroughProps {
  moves: string[];
  onDone: () => void;
  doneLabel?: string;
}

export default function ScrambleWalkthrough({
  moves,
  onDone,
  doneLabel = "Готово, проверить",
}: ScrambleWalkthroughProps) {
  const t = useT();
  const total = moves.length;
  const { slotRef, ready, error, showState, animateMove } = useTwisty();
  const [index, setIndex] = useState(0); // moves applied (0 = solved/start)
  const [showNotation, setShowNotation] = useState(
    () => typeof localStorage !== "undefined" && localStorage.getItem(NOTATION_KEY) === "1",
  );
  const prevIndex = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [speedId, setSpeedId] = useState<AutoplaySpeedId>(
    () =>
      speedById(typeof localStorage !== "undefined" ? localStorage.getItem(SPEED_KEY) : null).id,
  );
  const speed = speedById(speedId);

  const clamp = (n: number) => (n < 0 ? 0 : n > total ? total : n);
  const goNext = () => setIndex((i) => clamp(i + 1));
  const goPrev = () => setIndex((i) => clamp(i - 1));

  // Drive the player: a single forward step animates the move; anything else
  // (back, minimap jump, first render) snaps to the static state.
  useEffect(() => {
    if (!ready) return;
    if (index === prevIndex.current + 1) animateMove(moves, index);
    else showState(moves, index);
    prevIndex.current = index;
  }, [index, ready, moves, animateMove, showState]);

  // Автопрокрутка: сама делает следующий ход, пока не дойдёт до конца. Человеку
  // не надо жать «дальше» 25 раз — он просто повторяет за экраном.
  //
  // Таймер живёт на паре (playing, index): каждый ход планирует ровно один
  // следующий, поэтому смена скорости или ручной шаг перепланируют его, а не
  // накапливают параллельные интервалы.
  useEffect(() => {
    if (!playing || !ready) return;
    if (index >= total) {
      setPlaying(false);
      return;
    }
    const id = setTimeout(() => setIndex((i) => clamp(i + 1)), speed.delayMs);
    return () => clearTimeout(id);
  }, [playing, ready, index, total, speed.delayMs]);

  // Ручной шаг назад/вперёд и прыжок по мини-карте останавливают автопрокрутку:
  // человек перехватил управление.
  const stopAndRun = (fn: () => void) => {
    setPlaying(false);
    fn();
  };

  // Keyboard: arrows / space. Ignore while a control is focused (it would double-fire).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "BUTTON" ||
          t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return;
      }
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        goNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const toggleNotation = () => {
    setShowNotation((v) => {
      const next = !v;
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(NOTATION_KEY, next ? "1" : "0");
      }
      return next;
    });
  };

  const atEnd = index >= total;
  const lastToken = index > 0 ? moves[index - 1] : null;
  const directionText = lastToken
    ? `${lastToken} — ${moveLabelRu(lastToken, t)}`
    : "Поставь кубик как на баннере, потом жми «дальше».";
  const progressText = atEnd
    ? `Готово: все ${total} ходов сделаны`
    : index === 0
      ? "Начало"
      : `Ход ${index} из ${total}`;

  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-md border border-line bg-surface-2 px-3.5 py-2 font-sans text-small font-bold text-ink">
        {t("Ориентация: белый верх, зелёный к себе.")}
      </p>

      {error ? (
        <p role="alert" className="font-sans text-body text-danger">
          Не удалось загрузить 3D-кубик (проверь интернет): {error}
        </p>
      ) : null}

      <div
        ref={slotRef}
        className="mx-auto aspect-square w-full max-w-xs rounded-lg border-2 border-ink bg-surface [&>*]:h-full [&>*]:w-full"
        aria-label={t("3D-модель кубика на текущем шаге")}
      />

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between font-sans text-small text-muted">
          <span>{progressText}</span>
          <span aria-hidden>{Math.round((total === 0 ? 1 : index / total) * 100)}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full bg-primary transition-[width] duration-200"
            style={{ width: `${(total === 0 ? 1 : index / total) * 100}%` }}
          />
        </div>
      </div>

      <p className="min-h-[3rem] font-sans text-h3 text-ink" aria-live="polite">
        {directionText}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => stopAndRun(goPrev)}
          disabled={index === 0}
          className="inline-flex h-10 items-center rounded-full border-2 border-ink bg-surface px-4 font-sans text-small font-extrabold text-ink disabled:cursor-not-allowed disabled:border-line disabled:text-faint"
        >
          {t("← назад")}
        </button>
        {atEnd ? (
          <button
            type="button"
            onClick={onDone}
            className="inline-flex h-10 items-center rounded-full border-2 border-ink bg-primary px-4 font-sans text-small font-extrabold text-white"
          >
            {doneLabel}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => stopAndRun(goNext)}
            className="inline-flex h-10 items-center rounded-full border-2 border-ink bg-primary px-4 font-sans text-small font-extrabold text-white"
          >
            {t("дальше →")}
          </button>
        )}

        {!atEnd ? (
          <button
            type="button"
            onClick={() => setPlaying((v) => !v)}
            className="inline-flex h-10 items-center rounded-full border-2 border-ink bg-surface px-4 font-sans text-small font-extrabold text-ink"
          >
            {playing ? t("Пауза") : t("Показать самому")}
          </button>
        ) : null}

        <label className="inline-flex items-center gap-2 font-sans text-small text-muted">
          {t("Скорость")}
          <select
            value={speedId}
            onChange={(e) => {
              const next = e.target.value as AutoplaySpeedId;
              setSpeedId(next);
              if (typeof localStorage !== "undefined") localStorage.setItem(SPEED_KEY, next);
            }}
            className="rounded-md border border-line bg-surface px-2 py-1 font-sans text-small text-ink"
          >
            {AUTOPLAY_SPEEDS.map((s) => (
              <option key={s.id} value={s.id}>
                {t(s.label)}
              </option>
            ))}
          </select>
        </label>

        <label className="ml-auto inline-flex cursor-pointer items-center gap-2 font-sans text-small text-muted">
          <input
            type="checkbox"
            checked={showNotation}
            onChange={toggleNotation}
            className="h-4 w-4 accent-primary"
          />
          {t("Нотация")}
        </label>
      </div>

      {showNotation ? (
        <p className="rounded-md border border-line bg-surface-2 px-3.5 py-2 font-mono text-small text-ink">
          {moves.join(" ")}
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5" aria-label={t("Мини-карта ходов")}>
          {moves.map((mv, i) => {
            const isCurrent = i === index - 1;
            const isDone = i < index - 1;
            return (
              <button
                key={`${i}-${mv}`}
                type="button"
                title={moveLabelRu(mv, t)}
                onClick={() => stopAndRun(() => setIndex(i + 1))}
                className={[
                  "h-8 min-w-8 rounded-md border-2 px-1.5 font-mono text-small font-bold",
                  isCurrent
                    ? "border-ink bg-primary text-white"
                    : isDone
                      ? "border-line bg-surface-2 text-muted"
                      : "border-line bg-surface text-ink",
                ].join(" ")}
              >
                {mv}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
