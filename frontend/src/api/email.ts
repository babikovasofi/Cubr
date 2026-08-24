// Email endpoints, Stage B (swarm-report/friend-chat-plan.md §7 "Этап B").
//
// `unsubscribeChat` is public — no cookie needed, called from /unsubscribe
// (reached from the letter, no session there). The other two are the profile
// toggle and go through the normal authed `request()`.

import { request } from "./client";

export interface EmailPrefs {
  chat_email_enabled: boolean;
}

/** POST /email/unsubscribe — no auth. Token comes from the letter's link. */
export function unsubscribeChat(token: string, signal?: AbortSignal): Promise<void> {
  return request<void>("/email/unsubscribe", {
    method: "POST",
    json: { token },
    signal,
  });
}

export function getEmailPrefs(signal?: AbortSignal): Promise<EmailPrefs> {
  return request<EmailPrefs>("/email/prefs", { signal });
}

// PUT /email/prefs {chat_email_enabled} -> 200 {chat_email_enabled}.
export function updateEmailPrefs(
  patch: EmailPrefs,
  signal?: AbortSignal,
): Promise<EmailPrefs | void> {
  return request<EmailPrefs | void>("/email/prefs", {
    method: "PUT",
    json: patch,
    signal,
  });
}
