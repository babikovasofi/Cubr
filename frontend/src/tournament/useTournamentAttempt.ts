// State machine for the weekly "Челлендж недели" ritual (plan: tournament-ui).
//
// Phases: loading -> precommit | resume | terminal (from GET /tournament/current,
// fired once on mount — this NEVER creates a tournament/attempt row and NEVER
// reveals the scramble, П8). committing -> active | commit_error (from POST
// .../attempt/start, fired ONLY from an explicit commit()/resume call — this is
// the ONLY place the scramble is ever revealed). submitting -> terminal |
// submit_error (from POST .../attempt/submit).
//
// Error handling (skeptic MEDs): 409 (already submitted, e.g. a second tab) is
// recovered by re-reading GET /current and landing on terminal with the server's
// authoritative result — never a dead end. 401 (session expired mid-ritual) keeps
// the client's result in memory and reports "unauthorized" so the UI can prompt a
// re-login and retry the SAME payload. A network failure reports "network" —
// also retryable, result never dropped. "forcedLateDnf" flags the case where the
// client finished with a real (non-DNF) time but the server's response says "dnf"
// (the attempt window closed before the submit landed) — surfaced, never hidden.

import { useEffect, useReducer } from "react";
import { ApiError } from "../api/client";
import { toast } from "../components/Toast";
import {
  getCurrent,
  startAttempt,
  submitAttempt,
  type TournamentAttemptRead,
  type TournamentCurrentRead,
} from "../api/tournament";

export type TournamentPhase =
  | "loading"
  | "load_error"
  | "precommit"
  | "resume"
  | "committing"
  | "commit_error"
  | "active"
  | "submitting"
  | "submit_error"
  | "terminal";

export interface TerminalResult {
  week_label: string;
  status: "valid" | "dnf";
  time_ms: number | null;
  forcedLateDnf: boolean;
}

export interface RitualResult {
  elapsedMs: number;
  dnf: boolean;
  cameraVerified: boolean;
}

export type SubmitErrorKind = "unauthorized" | "network" | "generic";

export interface TournamentState {
  phase: TournamentPhase;
  current: TournamentCurrentRead | null;
  attempt: TournamentAttemptRead | null; // populated by commit() — carries the scramble
  terminal: TerminalResult | null;
  error: string | null;
  submitErrorKind: SubmitErrorKind | null;
  pendingResult: RitualResult | null; // preserved across a submit retry
}

type Action =
  | { type: "load_start" }
  | { type: "loaded"; current: TournamentCurrentRead }
  | { type: "load_error"; message: string }
  | { type: "commit_start" }
  | { type: "commit_ok"; attempt: TournamentAttemptRead; current: TournamentCurrentRead | null }
  | { type: "commit_error"; message: string }
  | { type: "submit_start"; result: RitualResult }
  | { type: "submit_ok"; attempt: TournamentAttemptRead; forcedLateDnf: boolean }
  | { type: "submit_error"; kind: SubmitErrorKind; message: string }
  | { type: "submit_recovered"; current: TournamentCurrentRead; forcedLateDnf: boolean };

const initialState: TournamentState = {
  phase: "loading",
  current: null,
  attempt: null,
  terminal: null,
  error: null,
  submitErrorKind: null,
  pendingResult: null,
};

function terminalFromCurrent(
  current: TournamentCurrentRead,
  forcedLateDnf: boolean,
): TerminalResult | null {
  if (current.attempt_status !== "valid" && current.attempt_status !== "dnf") return null;
  return {
    week_label: current.week_label,
    status: current.attempt_status,
    time_ms: current.time_ms,
    forcedLateDnf,
  };
}

function reducer(s: TournamentState, a: Action): TournamentState {
  switch (a.type) {
    case "load_start":
      return { ...s, phase: "loading", error: null };

    case "loaded": {
      const { current } = a;
      if (current.attempt_status === null) {
        return { ...s, phase: "precommit", current, error: null };
      }
      if (current.attempt_status === "started") {
        return { ...s, phase: "resume", current, error: null };
      }
      return {
        ...s,
        phase: "terminal",
        current,
        terminal: terminalFromCurrent(current, false),
        error: null,
      };
    }

    case "load_error":
      return { ...s, phase: "load_error", error: a.message };

    case "commit_start":
      return { ...s, phase: "committing", error: null };

    case "commit_ok":
      return {
        ...s,
        phase: "active",
        attempt: a.attempt,
        current: a.current ?? s.current,
        error: null,
      };

    case "commit_error":
      return { ...s, phase: "commit_error", error: a.message };

    case "submit_start":
      return {
        ...s,
        phase: "submitting",
        pendingResult: a.result,
        error: null,
        submitErrorKind: null,
      };

    case "submit_ok":
      return {
        ...s,
        phase: "terminal",
        terminal: {
          week_label: a.attempt.week_label,
          status: a.attempt.status === "dnf" ? "dnf" : "valid",
          time_ms: a.attempt.time_ms,
          forcedLateDnf: a.forcedLateDnf,
        },
        error: null,
      };

    case "submit_error":
      return { ...s, phase: "submit_error", error: a.message, submitErrorKind: a.kind };

    case "submit_recovered":
      return {
        ...s,
        phase: "terminal",
        current: a.current,
        terminal: terminalFromCurrent(a.current, a.forcedLateDnf),
        error: null,
      };
  }
}

function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return "Что-то пошло не так. Попробуй ещё раз.";
}

export interface TournamentAttemptApi {
  state: TournamentState;
  /** Precommit "Сделать попытку" (after the two-step confirm) and resume "Продолжить" — idempotent. */
  commit: () => Promise<void>;
  /** Wired as useSoloSession's onResult; fires POST .../attempt/submit exactly once per ritual. */
  submit: (result: RitualResult) => Promise<void>;
  /** Re-submits the SAME preserved result after a 401/network submit_error. */
  retrySubmit: () => Promise<void>;
  /** Re-runs the mount GET after a load_error. */
  retryLoad: () => Promise<void>;
}

export function useTournamentAttempt(): TournamentAttemptApi {
  const [state, dispatch] = useReducer(reducer, initialState);

  const load = async (): Promise<void> => {
    dispatch({ type: "load_start" });
    try {
      const current = await getCurrent();
      dispatch({ type: "loaded", current });
    } catch (e) {
      dispatch({ type: "load_error", message: errorMessage(e) });
    }
  };

  // Mount: read state once. No POST fires here — the scramble is revealed only by
  // an explicit commit() (П8).
  useEffect(() => {
    void load();
  }, []);

  const commit = async (): Promise<void> => {
    dispatch({ type: "commit_start" });
    try {
      const attempt = await startAttempt();
      // Best-effort refresh so the "active" ritual can show a window countdown —
      // only GET /current carries deadline_at (the start response is the
      // scramble-bearing shape). Non-fatal if this second read fails.
      let current: TournamentCurrentRead | null = null;
      try {
        current = await getCurrent();
      } catch {
        // countdown just won't render; the ritual itself is unaffected
      }
      dispatch({ type: "commit_ok", attempt, current });
    } catch (e) {
      dispatch({ type: "commit_error", message: errorMessage(e) });
    }
  };

  const doSubmit = async (
    payload: { time_ms: number; status: "valid" | "dnf" },
    clientDnf: boolean,
  ): Promise<void> => {
    try {
      const attempt = await submitAttempt(payload);
      const forcedLateDnf = !clientDnf && attempt.status === "dnf";
      if (attempt.new_badges && attempt.new_badges.length > 0) {
        for (const b of attempt.new_badges) toast(`Бейдж получен: ${b.title}`, "success");
      }
      dispatch({ type: "submit_ok", attempt, forcedLateDnf });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // Already submitted (e.g. a second tab raced us) — recover the
        // authoritative result instead of dead-ending on a conflict.
        try {
          const current = await getCurrent();
          dispatch({
            type: "submit_recovered",
            current,
            forcedLateDnf: !clientDnf && current.attempt_status === "dnf",
          });
        } catch (e2) {
          dispatch({ type: "submit_error", kind: "generic", message: errorMessage(e2) });
        }
        return;
      }
      if (e instanceof ApiError && e.status === 401) {
        dispatch({ type: "submit_error", kind: "unauthorized", message: errorMessage(e) });
        return;
      }
      if (e instanceof ApiError && e.status === 0) {
        dispatch({ type: "submit_error", kind: "network", message: errorMessage(e) });
        return;
      }
      dispatch({ type: "submit_error", kind: "generic", message: errorMessage(e) });
    }
  };

  const submit = async (result: RitualResult): Promise<void> => {
    const payload: { time_ms: number; status: "valid" | "dnf" } = {
      time_ms: Math.max(1, Math.round(result.elapsedMs)),
      status: result.dnf ? "dnf" : "valid",
    };
    dispatch({ type: "submit_start", result });
    await doSubmit(payload, result.dnf);
  };

  // Re-submit exactly the same result that was preserved on submit_start — the
  // backend itself forces "dnf" if the window has since closed, so this needs no
  // client-side clock (skeptic: "retry same time_ms while window open").
  const retrySubmit = async (): Promise<void> => {
    if (!state.pendingResult) return;
    await submit(state.pendingResult);
  };

  return { state, commit, submit, retrySubmit, retryLoad: load };
}
