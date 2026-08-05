// StackMat-style synthesized countdown beeps (plan: countdown-sounds) — Web
// Audio synthesis only, no audio asset file, no new dependency. A single
// module-level AudioContext is lazily created and reused across countdowns
// and rematches (never closed). Everything here degrades to a silent no-op
// when Web Audio / a real user gesture isn't available — the visual
// countdown in DuelRoom.tsx's CountdownOverlay never depends on this module.

let sharedCtx: AudioContext | null = null;
let ctxAttempted = false;

// Lazily builds (once) and returns the shared AudioContext, or null when
// unavailable (SSR / no Web Audio support). Never call .close() on the
// result — it's reused for the lifetime of the tab.
export function getAudioContext(): AudioContext | null {
  if (ctxAttempted) return sharedCtx;
  ctxAttempted = true;
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    sharedCtx = new Ctor();
  } catch {
    sharedCtx = null;
  }
  return sharedCtx;
}

let unlockInstalled = false;

// One-time gesture unlock: the server-driven countdown arrives with no fresh
// user gesture of its own, so a lazily-created AudioContext would otherwise
// stay "suspended" forever. Call once on mount (DuelPage) — idempotent, safe
// to call again (StrictMode double-invoke adds no duplicate listeners).
export function installAudioUnlock(): void {
  if (unlockInstalled) return;
  if (typeof document === "undefined") return;
  unlockInstalled = true;
  const unlock = (): void => {
    const ctx = getAudioContext();
    if (ctx && ctx.state !== "closed") {
      void ctx.resume().catch(() => {
        // best-effort — scheduleCountdownBeeps re-checks ctx.state anyway
      });
    }
  };
  const opts: AddEventListenerOptions = { once: true };
  document.addEventListener("pointerdown", unlock, opts);
  document.addEventListener("keydown", unlock, opts);
  document.addEventListener("touchstart", unlock, opts);
}

const TICK_FREQ_HZ = 1000;
const TICK_DUR_S = 0.06;
const GO_FREQ_HZ = 1760;
const GO_DUR_S = 0.15;
// Upper bound on scheduled tick count — duel countdowns are ~3 s (plan
// Assumptions), this just covers any longer countdown without cost (ticks
// beyond the actual countdown length are filtered out by the startAt-k >
// currentTime check below).
const MAX_TICKS = 10;

function playTone(ctx: AudioContext, when: number, freq: number, dur: number): {
  osc: OscillatorNode;
  gain: GainNode;
} {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = freq;
  osc.connect(gain);
  gain.connect(ctx.destination);
  // Short attack + exponential decay so the tone doesn't click.
  const attack = 0.005;
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(0.3, when + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  osc.start(when);
  osc.stop(when + dur);
  return { osc, gain };
}

const NOOP: () => void = () => {};

// Schedules a tick on each whole-second boundary remaining before
// `serverStartAt` plus a distinct go-tone at the start instant, sample-
// accurately via osc.start(when) off ctx.currentTime (never setTimeout).
// Returns a cleanup that stops every scheduled node; safe to call the
// cleanup more than once.
export function scheduleCountdownBeeps(serverStartAt: string): () => void {
  if (isCountdownMuted()) return NOOP;
  const ctx = getAudioContext();
  if (!ctx || ctx.state !== "running") return NOOP;
  const msUntilStart = Date.parse(serverStartAt) - Date.now();
  if (!(msUntilStart > 0)) return NOOP;

  const startAt = ctx.currentTime + msUntilStart / 1000;
  const nodes: { osc: OscillatorNode; gain: GainNode }[] = [];

  for (let k = 1; k <= MAX_TICKS; k++) {
    const when = startAt - k;
    if (when > ctx.currentTime) {
      nodes.push(playTone(ctx, when, TICK_FREQ_HZ, TICK_DUR_S));
    }
  }
  nodes.push(playTone(ctx, startAt, GO_FREQ_HZ, GO_DUR_S));

  let cleaned = false;
  return () => {
    if (cleaned) return;
    cleaned = true;
    for (const { osc, gain } of nodes) {
      try {
        osc.stop();
      } catch {
        // already stopped/ended on its own — fine
      }
      osc.disconnect();
      gain.disconnect();
    }
  };
}

const MUTE_KEY = "cubr_countdown_muted";

// localStorage-guarded (mirror src/auth/onboarding.ts) for non-DOM
// environments and disabled/private-mode storage. Default: unmuted.
export function isCountdownMuted(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setCountdownMuted(muted: boolean): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (muted) {
      localStorage.setItem(MUTE_KEY, "1");
    } else {
      localStorage.removeItem(MUTE_KEY);
    }
  } catch {
    // best-effort persistence only
  }
}
