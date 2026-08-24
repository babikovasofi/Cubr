// Weekly-tournament endpoints. Mirrors backend/app/schemas/tournament.py.
// Authed only — no public/anon route exists here, and none may: the shared
// weekly scramble is revealed ONLY by the two POST responses below, never by
// GET /tournament/current (П8 — see useTournamentAttempt.ts).

import { request } from "./client";
import type { BadgeRead } from "./badges";

export type TournamentAttemptStatus = "started" | "valid" | "dnf";

// GET /tournament/current — read-only snapshot, deliberately has NO `scramble`
// field on the wire. `attempt_status` is null when the caller has no attempt
// this week (the GET never creates a tournament/attempt row).
export interface TournamentCurrentRead {
  iso_year: number;
  iso_week: number;
  week_label: string;
  event: string;
  attempt_status: TournamentAttemptStatus | null;
  time_ms: number | null;
  started_at: string | null;
  submitted_at: string | null;
  deadline_at: string | null;
}

// POST .../attempt/start and .../attempt/submit both return the full attempt,
// INCLUDING `scramble` — this is the only shape that ever carries it.
export interface TournamentAttemptRead {
  id: string;
  tournament_id: string;
  status: string;
  honesty: string;
  time_ms: number | null;
  started_at: string;
  submitted_at: string | null;
  iso_year: number;
  iso_week: number;
  week_label: string;
  event: string;
  scramble: string;
  /** Badges newly granted by THIS submission (best-effort award engine); empty/absent otherwise. */
  new_badges?: BadgeRead[];
}

export interface TournamentAttemptSubmit {
  time_ms: number;
  status: "valid" | "dnf";
}

// GET /tournament/current/standings — de-ranked participation board (no rank/
// position field on the wire, by design — see TournamentStandings.tsx). Never
// carries email, only the opt-in `handle` (surfaced here as `display_name`,
// already "Аноним"-substituted server-side).
export interface StandingEntry {
  display_name: string;
  time_ms: number;
  is_self: boolean;
}

export interface TournamentStandingsRead {
  iso_year: number;
  iso_week: number;
  week_label: string;
  event: string;
  entries: StandingEntry[];
  your_entry: StandingEntry | null;
  valid_count: number;
  dnf_count: number;
}

export function getCurrent(signal?: AbortSignal): Promise<TournamentCurrentRead> {
  return request<TournamentCurrentRead>("/tournament/current", { signal });
}

export function getStandings(
  limit?: number,
  signal?: AbortSignal,
): Promise<TournamentStandingsRead> {
  const query = limit != null ? `?limit=${encodeURIComponent(String(limit))}` : "";
  return request<TournamentStandingsRead>(`/tournament/current/standings${query}`, { signal });
}

// Idempotent: a second call in the same week reloads the existing attempt (and
// the same shared scramble) instead of re-rolling.
export function startAttempt(signal?: AbortSignal): Promise<TournamentAttemptRead> {
  return request<TournamentAttemptRead>("/tournament/current/attempt/start", {
    method: "POST",
    signal,
  });
}

export function submitAttempt(
  body: TournamentAttemptSubmit,
  signal?: AbortSignal,
): Promise<TournamentAttemptRead> {
  return request<TournamentAttemptRead>("/tournament/current/attempt/submit", {
    json: body,
    signal,
  });
}
