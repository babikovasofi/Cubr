import { describe, it, expect } from "vitest";
import { HandsFsm, type Observation } from "../../src/vision/fsm";
import { config } from "../../src/vision/config";

// Helper to drive the FSM with a stream of frames at a fixed dt.
function drive(
  fsm: HandsFsm,
  frames: Partial<Observation>[],
  startT = 1000,
  dt = 16,
): { state: string; events: (string | null)[] } {
  const events: (string | null)[] = [];
  let t = startT;
  let state = fsm.state as string;
  for (const f of frames) {
    const obs: Observation = {
      t,
      handsDetected: f.handsDetected ?? true,
      bothInZone: f.bothInZone ?? false,
      still: f.still ?? false,
      handsOutOfZone: f.handsOutOfZone ?? 0,
    };
    const r = fsm.step(obs);
    state = r.state;
    events.push(r.event);
    t += dt;
  }
  return { state, events };
}

function repeat(frame: Partial<Observation>, n: number): Partial<Observation>[] {
  return Array.from({ length: n }, () => ({ ...frame }));
}

describe("HandsFsm progression", () => {
  it("reaches HANDS_IN_ZONE after ZONE_ENTER_MS of both in zone", () => {
    const fsm = new HandsFsm();
    const nFrames = Math.ceil(config.ZONE_ENTER_MS / 16) + 2;
    const { state } = drive(fsm, repeat({ bothInZone: true }, nFrames));
    expect(state).toBe("HANDS_IN_ZONE");
  });

  it("stillness < STILL_MS does NOT reach READY", () => {
    const fsm = new HandsFsm();
    // Enter zone, then be still for LESS than STILL_MS.
    const enter = repeat({ bothInZone: true }, Math.ceil(config.ZONE_ENTER_MS / 16) + 2);
    const shortStill = repeat({ bothInZone: true, still: true }, Math.floor(config.STILL_MS / 16) - 2);
    const { state } = drive(fsm, [...enter, ...shortStill]);
    expect(state).toBe("HANDS_IN_ZONE");
    expect(state).not.toBe("READY");
  });

  it("stillness >= STILL_MS reaches READY", () => {
    const fsm = new HandsFsm();
    const enter = repeat({ bothInZone: true }, Math.ceil(config.ZONE_ENTER_MS / 16) + 2);
    const longStill = repeat({ bothInZone: true, still: true }, Math.ceil(config.STILL_MS / 16) + 2);
    const { state } = drive(fsm, [...enter, ...longStill]);
    expect(state).toBe("READY");
  });
});

describe("HandsFsm solve start/stop", () => {
  function toReady(fsm: HandsFsm, t0 = 1000): number {
    const enter = repeat({ bothInZone: true }, Math.ceil(config.ZONE_ENTER_MS / 16) + 2);
    const still = repeat({ bothInZone: true, still: true }, Math.ceil(config.STILL_MS / 16) + 2);
    const res = drive(fsm, [...enter, ...still], t0);
    expect(res.state).toBe("READY");
    return t0 + (enter.length + still.length) * 16;
  }

  it("emits solve_start when a hand leaves the zone (debounced)", () => {
    const fsm = new HandsFsm();
    const t = toReady(fsm);
    const leaving = repeat(
      { handsDetected: true, bothInZone: false, handsOutOfZone: 1 },
      Math.ceil(config.LEAVE_DEBOUNCE_MS / 16) + 2,
    );
    const { state, events } = drive(fsm, leaving, t);
    expect(state).toBe("SOLVING");
    expect(events).toContain("solve_start");
  });

  it("emits solve_stop when both hands return to zones for STOP_MS", () => {
    const fsm = new HandsFsm();
    let t = toReady(fsm);
    const leaving = repeat(
      { bothInZone: false, handsOutOfZone: 1 },
      Math.ceil(config.LEAVE_DEBOUNCE_MS / 16) + 2,
    );
    let res = drive(fsm, leaving, t);
    t += leaving.length * 16;
    expect(res.state).toBe("SOLVING");

    const back = repeat({ bothInZone: true }, Math.ceil(config.STOP_MS / 16) + 2);
    res = drive(fsm, back, t);
    expect(res.state).toBe("STOPPED");
    expect(res.events).toContain("solve_stop");
  });
});

describe("HandsFsm robustness", () => {
  it("debounce absorbs a single-frame zone dropout (no spurious leave)", () => {
    const fsm = new HandsFsm();
    // Build up to HANDS_IN_ZONE, drop for ONE frame, keep going -> stays.
    const enter = repeat({ bothInZone: true }, Math.ceil(config.ZONE_ENTER_MS / 16) + 2);
    const glitch: Partial<Observation>[] = [{ bothInZone: false, handsOutOfZone: 1 }];
    const cont = repeat({ bothInZone: true, still: true }, Math.ceil(config.STILL_MS / 16) + 2);
    const { state } = drive(fsm, [...enter, ...glitch, ...cont]);
    // One-frame glitch (16ms << LEAVE_DEBOUNCE_MS) must not knock us to NO_HANDS.
    expect(state).toBe("READY");
  });

  it("ABORTs when detection is lost past ABORT_MS in READY", () => {
    const fsm = new HandsFsm();
    const enter = repeat({ bothInZone: true }, Math.ceil(config.ZONE_ENTER_MS / 16) + 2);
    const still = repeat({ bothInZone: true, still: true }, Math.ceil(config.STILL_MS / 16) + 2);
    drive(fsm, [...enter, ...still]);
    expect(fsm.state).toBe("READY");

    const t = 1000 + (enter.length + still.length) * 16;
    const lost = repeat(
      { handsDetected: false, bothInZone: false },
      Math.ceil(config.ABORT_MS / 16) + 2,
    );
    const { state, events } = drive(fsm, lost, t);
    expect(events).toContain("abort");
    expect(state).toBe("NO_HANDS");
  });

  it("distinguishes 'hand left zone' from 'detection lost' (leave starts, loss aborts)", () => {
    // Leaving the zone (still detected) starts the solve; it must NOT abort.
    const fsm = new HandsFsm();
    const enter = repeat({ bothInZone: true }, Math.ceil(config.ZONE_ENTER_MS / 16) + 2);
    const still = repeat({ bothInZone: true, still: true }, Math.ceil(config.STILL_MS / 16) + 2);
    drive(fsm, [...enter, ...still]);
    const t = 1000 + (enter.length + still.length) * 16;
    const leaving = repeat(
      { handsDetected: true, bothInZone: false, handsOutOfZone: 1 },
      Math.ceil(Math.max(config.LEAVE_DEBOUNCE_MS, config.ABORT_MS) / 16) + 4,
    );
    const { state, events } = drive(fsm, leaving, t);
    expect(events).toContain("solve_start");
    expect(events).not.toContain("abort");
    expect(state).toBe("SOLVING");
  });
});
