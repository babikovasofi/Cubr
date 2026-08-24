// Auth + user endpoints (fastapi-users). Mirrors backend/app/schemas/user.py.
// Login MUST be form-urlencoded with field `username` (OAuth2PasswordRequestForm);
// sending JSON here 422s.

import { request } from "./client";

export interface UserRead {
  id: string;
  email: string;
  is_active: boolean;
  is_superuser: boolean;
  is_verified: boolean;
  avatar_url: string | null;
  cups: number;
  // Ступень текущего `cups`, computed_field на бэкенде из ЕДИНОЙ таблицы
  // порогов `app.services.cups.CUPS_TIERS` (backend/app/schemas/user.py:50-68)
  // — фронт НИКОГДА не дублирует эту лесенку у себя (см. CupsRoad.tsx).
  // `cups_to_next === null` только на последней (red) ступени — открытый верх.
  cups_rank: string;
  cups_floor: number;
  cups_to_next: number | null;
  best_single_ms: number | null;
  best_ao5_ms: number | null;
  // ЕДИНОЕ имя аккаунта: свой заголовок профиля И то, что видят другие (список
  // друзей, таблицы турнира и скрамбла дня — display_name там уже готов
  // сервером). Deliberately-set, opt-in, NEVER derived from email; null =
  // "Аноним" на бордах / честная заглушка на своей странице. Отображается с
  // ведущим "@" (см. lib/handle.ts) — само значение "@" не содержит.
  handle: string | null;
  // Витрина профиля (V3): видна только владельцу — публичных профилей нет.
  method: SolvingMethod | null;
  cubing_since_year: number | null;
  // Когда человек прошёл онбординг; null — ещё не проходил. Признак СЕРВЕРНЫЙ:
  // локальный флаг отвечал на вопрос «показывали ли в этом браузере», из-за
  // чего новый аккаунт в старом браузере онбординг пропускал, а тот же человек
  // со второго устройства получал его заново.
  onboarded_at: string | null;
  // Когда заведён аккаунт. Нужен, чтобы перенос старого локального флага
  // применялся только к тем, кто жил до появления серверного признака.
  created_at: string | null;
}

/** Закрытый список: свободный текст тут ничего не добавляет. Зеркалит бэкенд. */
export type SolvingMethod = "cfop" | "roux" | "zz" | "petrus" | "beginner" | "other";

export interface UserUpdate {
  handle?: string | null;
  avatar_url?: string | null;
  method?: SolvingMethod | null;
  cubing_since_year?: number | null;
}

/** Отметить онбординг пройденным. Идемпотентно: первая отметка выигрывает. */
export function markOnboardedOnServer(): Promise<UserRead> {
  return request<UserRead>("/users/me/onboarded", { method: "POST" });
}

export function register(email: string, password: string, handle?: string): Promise<UserRead> {
  return request<UserRead>("/auth/register", {
    json: { email, password, ...(handle ? { handle } : {}) },
  });
}

// 204 + Set-Cookie on success. Note the `username` field carries the email.
export function login(email: string, password: string): Promise<void> {
  return request<void>("/auth/login", {
    form: { username: email, password },
  });
}

export function logout(): Promise<void> {
  return request<void>("/auth/logout", { method: "POST" });
}

export function requestVerify(email: string): Promise<void> {
  return request<void>("/auth/request-verify-token", { json: { email } });
}

export function verify(token: string): Promise<UserRead> {
  return request<UserRead>("/auth/verify", { json: { token } });
}

export function forgotPassword(email: string): Promise<void> {
  return request<void>("/auth/forgot-password", { json: { email } });
}

export function resetPassword(token: string, password: string): Promise<void> {
  return request<void>("/auth/reset-password", { json: { token, password } });
}

export function getMe(): Promise<UserRead> {
  return request<UserRead>("/users/me");
}

export function updateMe(patch: UserUpdate): Promise<UserRead> {
  return request<UserRead>("/users/me", { method: "PATCH", json: patch });
}

export async function googleAuthorizeUrl(): Promise<string> {
  const res = await request<{ authorization_url: string }>("/auth/google/authorize");
  return res.authorization_url;
}
