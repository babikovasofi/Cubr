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
  nickname: string | null;
  avatar_url: string | null;
  cups: number;
  best_single_ms: number | null;
  best_ao5_ms: number | null;
}

export interface UserUpdate {
  nickname?: string | null;
  avatar_url?: string | null;
}

export function register(email: string, password: string, nickname?: string): Promise<UserRead> {
  return request<UserRead>("/auth/register", {
    json: { email, password, ...(nickname ? { nickname } : {}) },
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
