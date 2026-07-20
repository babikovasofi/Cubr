// Fetches the de-ranked daily participation board (plan: daily-scramble).
// Independent of useDailyAttempt's state machine — mounts its own GET and
// renders in every attempt phase (loading/precommit/resume/active/terminal), per
// the plan: the board is a standalone, always-visible section on /daily.

import { useEffect, useState } from "react";
import { ApiError } from "../api/client";
import { getDailyBoard, type DailyBoardRead } from "../api/daily";

interface UseDailyBoardResult {
  data: DailyBoardRead | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return "Не удалось загрузить таблицу дня.";
}

export function useDailyBoard(): UseDailyBoardResult {
  const [data, setData] = useState<DailyBoardRead | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    getDailyBoard(undefined, controller.signal)
      .then((result) => {
        if (!alive) return;
        setData(result);
        setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        setError(errorMessage(e));
        setLoading(false);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [reloadKey]);

  return { data, loading, error, reload: () => setReloadKey((k) => k + 1) };
}
