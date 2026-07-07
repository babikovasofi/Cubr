// Pure hands finite-state machine. NO DOM, NO timers of its own — the caller
// feeds it observations with a timestamp (performance.now() domain) and reads
// back the state + any emitted event. This makes it fully unit-testable.
//
// States: NO_HANDS -> HANDS_IN_ZONE -> READY -> SOLVING -> STOPPED, plus an
// ABORT/reset path when detection is lost for too long in READY/SOLVING.
//
// Key distinctions the plan demands:
//  * "hand left zone" (still detected, just outside the zone rect) starts the
//    solve — this is the intended solve trigger.
//  * "detection lost" (no hand landmarks at all, e.g. cube grabbed over hand)
//    is NOT a leave; if it persists past ABORT_MS in READY/SOLVING it aborts.
//  * Debounce on EVERY transition, including leave-events: a condition must hold
//    for its whole window before the transition fires (kills 1-frame flicker).

import { config } from "./config.ts";

export type FsmState =
  | "NO_HANDS"
  | "HANDS_IN_ZONE"
  | "READY"
  | "SOLVING"
  | "STOPPED";

export type FsmEvent =
  | "solve_start"
  | "solve_stop"
  | "abort"
  | null;

// One observation per processed frame.
export interface Observation {
  t: number; // performance.now()-domain timestamp of this frame
  handsDetected: boolean; // any hand landmarks present at all
  bothInZone: boolean; // both palms inside their zones
  still: boolean; // motion below scale-invariant threshold this frame
  // How many hands are currently OUTSIDE their zone (still detected).
  // Used with START_RULE to decide "first" vs "both left".
  handsOutOfZone: number;
}

export interface FsmResult {
  state: FsmState;
  event: FsmEvent;
}

interface Pending {
  // For each candidate transition we track when its condition first became true.
  since: number | null;
  cond: boolean;
}

export class HandsFsm {
  state: FsmState = "NO_HANDS";

  // Debounce trackers keyed by semantic condition.
  private inZone: Pending = { since: null, cond: false };
  private stillEnough: Pending = { since: null, cond: false };
  private leftZone: Pending = { since: null, cond: false };
  private backInZone: Pending = { since: null, cond: false };
  private detectionLost: Pending = { since: null, cond: false };

  private cfg = config;

  reset(): void {
    this.state = "NO_HANDS";
    this.inZone = { since: null, cond: false };
    this.stillEnough = { since: null, cond: false };
    this.leftZone = { since: null, cond: false };
    this.backInZone = { since: null, cond: false };
    this.detectionLost = { since: null, cond: false };
  }

  private track(p: Pending, cond: boolean, t: number): number {
    if (cond) {
      if (p.since === null) p.since = t;
    } else {
      p.since = null;
    }
    p.cond = cond;
    return p.since === null ? 0 : t - p.since;
  }

  /** Feed one frame; returns the (possibly unchanged) state + any event. */
  step(o: Observation): FsmResult {
    let event: FsmEvent = null;

    // ABORT: in READY or SOLVING, if detection is lost past ABORT_MS, reset.
    // (Detection lost != hand left zone. A left hand is still detected.)
    if (this.state === "READY" || this.state === "SOLVING") {
      const lostFor = this.track(this.detectionLost, !o.handsDetected, o.t);
      if (lostFor >= this.cfg.ABORT_MS) {
        this.reset();
        return { state: this.state, event: "abort" };
      }
    } else {
      this.track(this.detectionLost, !o.handsDetected, o.t);
    }

    switch (this.state) {
      case "NO_HANDS": {
        const held = this.track(this.inZone, o.bothInZone, o.t);
        if (held >= this.cfg.ZONE_ENTER_MS) {
          this.state = "HANDS_IN_ZONE";
          this.inZone.since = null;
        }
        break;
      }

      case "HANDS_IN_ZONE": {
        // Fall back if hands leave / detection drops (debounced).
        if (!o.bothInZone) {
          const outFor = this.track(this.leftZone, true, o.t);
          if (outFor >= this.cfg.LEAVE_DEBOUNCE_MS) {
            this.state = "NO_HANDS";
            this.leftZone.since = null;
            this.stillEnough.since = null;
            break;
          }
        } else {
          this.leftZone.since = null;
        }

        // Progress to READY on sustained stillness.
        const stillFor = this.track(
          this.stillEnough,
          o.bothInZone && o.still,
          o.t,
        );
        if (stillFor >= this.cfg.STILL_MS) {
          this.state = "READY";
          this.stillEnough.since = null;
        }
        break;
      }

      case "READY": {
        // Start rule, debounced. "first": >=1 hand out. "both": both out.
        const threshold =
          this.cfg.START_RULE === "both" ? o.handsOutOfZone >= 2 : o.handsOutOfZone >= 1;
        const leftFor = this.track(this.leftZone, o.handsDetected && threshold, o.t);
        if (leftFor >= this.cfg.LEAVE_DEBOUNCE_MS) {
          this.state = "SOLVING";
          this.leftZone.since = null;
          event = "solve_start";
        }
        break;
      }

      case "SOLVING": {
        // Stop when both hands are back in their zones, debounced by STOP_MS.
        const backFor = this.track(this.backInZone, o.bothInZone, o.t);
        if (backFor >= this.cfg.STOP_MS) {
          this.state = "STOPPED";
          this.backInZone.since = null;
          event = "solve_stop";
        }
        break;
      }

      case "STOPPED":
        // Terminal for one cycle; caller calls reset() to run again.
        break;
    }

    return { state: this.state, event };
  }
}
