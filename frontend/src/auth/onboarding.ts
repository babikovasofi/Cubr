// Client-side "has this user seen onboarding" flag (plan assumption: no server
// field yet — future work). localStorage-guarded for non-DOM environments.

const KEY = "cubr_onboarded";

export function hasOnboarded(): boolean {
  if (typeof localStorage === "undefined") return true;
  return localStorage.getItem(KEY) === "1";
}

export function markOnboarded(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(KEY, "1");
}

// A `next` redirect target is only honored if it is a LOCAL path — starts with a
// single "/" and not "//" (protocol-relative) — so a crafted ?next=//evil.com or
// ?next=https://evil.com can't turn login into an open redirect (defense-in-depth).
function isSafeLocalPath(p: string): boolean {
  return p.startsWith("/") && !p.startsWith("//");
}

// Where to land after a successful login: an explicit safe `next` wins, otherwise
// first-timers go to onboarding, returning users go home.
export function postLoginPath(next: string | null): string {
  if (next && isSafeLocalPath(next)) return next;
  return hasOnboarded() ? "/" : "/onboarding";
}
