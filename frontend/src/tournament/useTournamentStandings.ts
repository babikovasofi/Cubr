// Fetches the de-ranked weekly participation board (plan: tournament-leaderboard).
// Independent of useTournamentAttempt's state machine — mounts its own GET and
// renders in every attempt phase (loading/precommit/resume/active/terminal), per
// the plan: the board is a standalone, always-visible section on /tournament.

import { useEffect, useState } from "react";
import { ApiError } from "../api/client";
import { getStandings, type TournamentStandingsRead } from "../api/tournament";

interface UseTournamentStandingsResult {
  data: TournamentStandingsRead | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return "Не удалось загрузить турнирную таблицу.";
}

export function useTournamentStandings(): UseTournamentStandingsResult {
  const [data, setData] = useState<TournamentStandingsRead | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    getStandings(undefined, controller.signal)
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
