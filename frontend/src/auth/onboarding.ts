// Где человек оказывается после входа и кто считается «первый раз».
//
// Признак «онбординг пройден» — СЕРВЕРНЫЙ (`UserRead.onboarded_at`). Раньше он
// жил только в localStorage и потому отвечал на вопрос «показывали ли в ЭТОМ
// браузере», а не «проходил ли ЭТОТ человек». Живьём это поймалось 2026-08-20 на
// первом входе через Google: новый аккаунт в браузере, где онбординг уже
// проходили, молча уехал на главную. Обратный симптом не лучше — тот же человек
// со второго устройства получал онбординг заново.
//
// Локальный ключ остался, но роль у него теперь одна: перенести уже прошедших
// людей на серверный признак (`localOnboardedFlag`, см. `syncOnboarded`).

import { markOnboardedOnServer, type UserRead } from "../api/auth";

const KEY = "cubr_onboarded";

/** Старый локальный флаг. Только для переноса — решения по нему не принимаются. */
export function localOnboardedFlag(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(KEY) === "1";
}

export function markOnboarded(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(KEY, "1");
}

/** Прошёл ли онбординг ЭТОТ пользователь (по серверному признаку). */
export function hasOnboarded(user: Pick<UserRead, "onboarded_at"> | null): boolean {
  return user?.onboarded_at != null;
}

/**
 * Перенести старый локальный флаг на сервер — один раз, молча.
 *
 * Человека, который уже проходил онбординг до появления серверного признака,
 * нельзя гнать по шагам заново только потому, что в базе пусто. Если локальный
 * флаг стоит, а серверный нет — отмечаем на сервере и продолжаем.
 *
 * Ошибка сети здесь не должна ничего ломать: в худшем случае человек увидит
 * онбординг ещё раз, и это несравнимо лучше, чем застрявший вход.
 */
export async function syncOnboarded(user: UserRead | null): Promise<UserRead | null> {
  if (!user || user.onboarded_at != null || !localOnboardedFlag()) return user;
  try {
    return await markOnboardedOnServer();
  } catch {
    return user;
  }
}

// A `next` redirect target is only honored if it is a LOCAL path — starts with a
// single "/" and not "//" (protocol-relative) — so a crafted ?next=//evil.com or
// ?next=https://evil.com can't turn login into an open redirect (defense-in-depth).
function isSafeLocalPath(p: string): boolean {
  return p.startsWith("/") && !p.startsWith("//");
}

// Where to land after a successful login: an explicit safe `next` wins, otherwise
// first-timers go to onboarding, returning users go home.
export function postLoginPath(next: string | null, user: UserRead | null): string {
  if (next && isSafeLocalPath(next)) return next;
  return hasOnboarded(user) ? "/" : "/onboarding";
}
