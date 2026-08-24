// Shared "load my solve history" hook. Extracted out of ProfilePage's History
// section (was an inline useEffect+listSolves there) so HomePage's Dashboard
// can show the same window of solves without a second, slightly-different
// copy of the fetch/loading/error dance.
//
// listSolves(50, 0) is the one call both pages need — 50 is enough for the
// chart, the goal card and the visible history table. No pagination here
// (out of scope, see swarm-report/design-fillers-plan.md).

import { useEffect, useState } from "react";
import { listSolves, type SolveRead } from "../api/solves";
import { ApiError } from "../api/client";
import { useT } from "../i18n/t";

export type SolvesState =
  { kind: "loading" } | { kind: "error"; message: string } | { kind: "ok"; solves: SolveRead[] };

export interface UseSolvesResult {
  state: SolvesState;
  reload: () => void;
}

export function useSolves(): UseSolvesResult {
  const t = useT();
  const [state, setState] = useState<SolvesState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    listSolves(50, 0)
      .then((solves) => alive && setState({ kind: "ok", solves }))
      .catch((e: unknown) => {
        if (!alive) return;
        setState({
          kind: "error",
          message: e instanceof ApiError ? e.message : t("Не удалось загрузить историю."),
        });
      });
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  return { state, reload: () => setReloadKey((k) => k + 1) };
}
