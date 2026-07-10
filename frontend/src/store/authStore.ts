// Auth session store (zustand, plan §B). The `cubr_auth` cookie is httpOnly, so
// JS can NEVER read auth state directly — the only way to know if we are logged in
// is to ask the server. `bootstrap()` probes GET /users/me once at app start:
//   200 → authed (user cached);  401 → anon (this is NORMAL, not an error — no
//   console noise, no toast).
//
// status: "loading" until bootstrap resolves, then "authed" | "anon".

import { create } from "zustand";
import { ApiError } from "../api/client";
import * as authApi from "../api/auth";
import type { UserRead, UserUpdate } from "../api/auth";

export type AuthStatus = "loading" | "authed" | "anon";

interface AuthState {
  user: UserRead | null;
  status: AuthStatus;
  bootstrap: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, nickname?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
  updateMe: (patch: UserUpdate) => Promise<UserRead>;
}

let bootstrapped = false;
let bootstrapInFlight: Promise<void> | null = null;

async function loadMe(set: (s: Partial<AuthState>) => void): Promise<void> {
  try {
    const user = await authApi.getMe();
    set({ user, status: "authed" });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      set({ user: null, status: "anon" });
      return; // 401 is the normal anon path — swallow silently
    }
    // A real failure (network/5xx): treat as anon so the app is usable, but let
    // callers see it if they awaited.
    set({ user: null, status: "anon" });
    throw e;
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  status: "loading",

  bootstrap: async () => {
    // Latch only on a DEFINITIVE result (200 authed / 401 anon). A transient
    // network/5xx failure at boot must NOT pin the app to anon forever — leave
    // `bootstrapped` false so a later bootstrap() retries. The in-flight guard
    // dedupes concurrent calls (e.g. StrictMode double-mount).
    if (bootstrapped) return;
    if (bootstrapInFlight) return bootstrapInFlight;
    bootstrapInFlight = loadMe(set)
      .then(() => {
        bootstrapped = true; // reached a definitive 200/401
      })
      .catch(() => {
        /* transient probe failure — already reduced to anon, keep retryable */
      })
      .finally(() => {
        bootstrapInFlight = null;
      });
    return bootstrapInFlight;
  },

  login: async (email, password) => {
    await authApi.login(email, password);
    await loadMe(set);
  },

  register: async (email, password, nickname) => {
    await authApi.register(email, password, nickname);
  },

  logout: async () => {
    try {
      await authApi.logout();
    } finally {
      set({ user: null, status: "anon" });
    }
  },

  refreshMe: async () => {
    await loadMe(set);
  },

  updateMe: async (patch) => {
    const user = await authApi.updateMe(patch);
    set({ user, status: "authed" });
    return user;
  },
}));

// Non-reactive read for imperative callers (e.g. the solo save fire-and-forget).
export function isAuthed(): boolean {
  return useAuthStore.getState().status === "authed";
}

// Test-only: reset the one-shot bootstrap guard.
export function __resetBootstrapForTests(): void {
  bootstrapped = false;
}
