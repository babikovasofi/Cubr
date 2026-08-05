// Daily-scramble endpoints. Mirrors backend/app/schemas/daily.py.
// Authed only — no public/anon route exists here, and none may: the shared
// daily scramble is revealed ONLY by the two POST responses below, never by
// GET /daily/current (П8 — see useDailyAttempt.ts).

import { request } from "./client";

export type DailyAttemptStatus = "started" | "valid" | "dnf";

// GET /daily/current — read-only snapshot, deliberately has NO `scramble`
// field on the wire. `attempt_status` is null when the caller has no attempt
// today (the GET never creates a daily challenge/attempt row).
export interface DailyCurrentRead {
  date: string;
  day_label: string;
  event: string;
  attempt_status: DailyAttemptStatus | null;
  time_ms: number | null;
  started_at: string | null;
  submitted_at: string | null;
  deadline_at: string | null;
}

// POST .../attempt/start and .../attempt/submit both return the full attempt,
// INCLUDING `scramble` — this is the only shape that ever carries it. Daily
// has no badge engine, so unlike TournamentAttemptRead there is no
// `new_badges` field.
export interface DailyAttemptRead {
  id: string;
  daily_id: string;
  status: string;
  honesty: string;
  time_ms: number | null;
  started_at: string;
  submitted_at: string | null;
  date: string;
  day_label: string;
  event: string;
  scramble: string;
}

export interface DailyAttemptSubmit {
  time_ms: number;
  status: "valid" | "dnf";
}

// GET /daily/current/board — de-ranked participation board (no rank/position
// field on the wire, by design — see DailyBoard.tsx). Never carries email or
// the account nickname, only the opt-in `public_handle` (surfaced here as
// `display_name`, already "Аноним"-substituted server-side).
export interface DailyBoardEntry {
  display_name: string;
  time_ms: number;
  is_self: boolean;
}

export interface DailyBoardRead {
  date: string;
  day_label: string;
  event: string;
  entries: DailyBoardEntry[];
  your_entry: DailyBoardEntry | null;
  valid_count: number;
  dnf_count: number;
}

// GET /daily/streak — derived, storage-free streak over the caller's own
// finished daily attempts (see backend app/services/streak.py). No scramble.
export interface DailyStreakRead {
  current_streak: number;
  best_streak: number;
  completed_today: boolean;
  last_day: string | null;
  today: string;
}

export function getCurrentDaily(signal?: AbortSignal): Promise<DailyCurrentRead> {
  return request<DailyCurrentRead>("/daily/current", { signal });
}

export function getDailyBoard(limit?: number, signal?: AbortSignal): Promise<DailyBoardRead> {
  const query = limit != null ? `?limit=${encodeURIComponent(String(limit))}` : "";
  return request<DailyBoardRead>(`/daily/current/board${query}`, { signal });
}

// Idempotent: a second call the same UTC day reloads the existing attempt
// (and the same shared scramble) instead of re-rolling.
export function startDailyAttempt(signal?: AbortSignal): Promise<DailyAttemptRead> {
  return request<DailyAttemptRead>("/daily/current/attempt/start", {
    method: "POST",
    signal,
  });
}

export function submitDailyAttempt(
  body: DailyAttemptSubmit,
  signal?: AbortSignal,
): Promise<DailyAttemptRead> {
  return request<DailyAttemptRead>("/daily/current/attempt/submit", {
    json: body,
    signal,
  });
}

export function getDailyStreak(signal?: AbortSignal): Promise<DailyStreakRead> {
  return request<DailyStreakRead>("/daily/streak", { signal });
}
