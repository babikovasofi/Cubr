// История ПРЕДЫДУЩИХ сборок — baseline для карточки «что дальше» на экране
// результата (см. solo/nextCardModel.ts, solo/NextCard.tsx). Никакого нового
// эндпоинта: тот же `GET /solves`, что уже дёргает профиль (ProfilePage,
// GoalCard, SolveProgressChart).
//
// Грузится один раз за цикл ритуала, ровно в момент входа в "calibrate" —
// а не в "loading" — потому что после «Ещё раз» цикл идёт СРАЗУ в "calibrate"
// (soloPhase.ts: `again` → freshCalibrate), в "loading" он возвращается
// только один раз, при самом первом заходе. Так к моменту следующего
// результата в baseline уже есть предыдущая сборка (текущая ещё не начата —
// сравнение не видит само себя), а фактическое сохранение (useSoloSession,
// эффект на phase "result") стартует намного позже, когда этот запрос давно
// завершился.
//
// Анонимный посетитель — это тоже "нет истории" (эндпоинт защищён), поэтому
// запрос вообще не шлётся: сразу kind:"anon", без лишнего 401 в консоли.

import { useEffect, useState } from "react";
import { listSolves, type SolveRead } from "../api/solves";
import { isAuthed } from "../store/authStore";
import type { SoloPhase } from "./soloPhase";

export type SoloHistoryState =
  { kind: "anon" } | { kind: "loading" } | { kind: "error" } | { kind: "ok"; solves: SolveRead[] };

export interface SoloHistory {
  state: SoloHistoryState;
  /** Повторить загрузку после ошибки, не дожидаясь следующего цикла ритуала. */
  reload: () => void;
}

export function useSoloHistory(phase: SoloPhase): SoloHistory {
  const [state, setState] = useState<SoloHistoryState>(() =>
    isAuthed() ? { kind: "loading" } : { kind: "anon" },
  );
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (phase !== "calibrate") return;
    if (!isAuthed()) {
      setState({ kind: "anon" });
      return;
    }
    let alive = true;
    setState({ kind: "loading" });
    listSolves(50, 0)
      .then((solves) => alive && setState({ kind: "ok", solves }))
      .catch(() => alive && setState({ kind: "error" }));
    return () => {
      alive = false;
    };
    // reloadKey — ручной триггер повтора после ошибки, сам по себе не читается.
  }, [phase, reloadKey]);

  return { state, reload: () => setReloadKey((k) => k + 1) };
}
