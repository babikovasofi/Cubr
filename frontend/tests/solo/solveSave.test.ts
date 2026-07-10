import { describe, it, expect, vi } from "vitest";
import { buildSolvePayload, saveSoloResult } from "../../src/solo/solveSave";
import { ApiError } from "../../src/api/client";
import type { SolveRead } from "../../src/api/solves";

const READ: SolveRead = {
  id: "s1",
  scramble: "R U R'",
  time_ms: 12340,
  status: "valid",
  verify_frames_ok: true,
  created_at: "2026-07-10T00:00:00Z",
};

describe("buildSolvePayload", () => {
  it("rounds elapsedMs and marks a valid solve", () => {
    expect(buildSolvePayload("R U R'", 12340.7, false)).toEqual({
      scramble: "R U R'",
      time_ms: 12341,
      status: "valid",
      verify_frames_ok: true,
    });
  });

  it("marks a DNF (verify_frames_ok=false) and clamps time_ms to >= 1", () => {
    const p = buildSolvePayload("F2 B2", 0, true);
    expect(p.status).toBe("dnf");
    expect(p.verify_frames_ok).toBe(false);
    expect(p.time_ms).toBe(1); // backend requires time_ms > 0
  });
});

describe("saveSoloResult", () => {
  it("is a no-op for anonymous users (never calls create)", async () => {
    const create = vi.fn();
    const out = await saveSoloResult({
      isAuthed: false,
      payload: buildSolvePayload("R", 1000, false),
      create,
    });
    expect(out).toBe("anon");
    expect(create).not.toHaveBeenCalled();
  });

  it("returns 'saved' when create resolves", async () => {
    const create = vi.fn().mockResolvedValue(READ);
    const payload = buildSolvePayload("R", 1000, false);
    const out = await saveSoloResult({ isAuthed: true, payload, create });
    expect(out).toBe("saved");
    expect(create).toHaveBeenCalledWith(payload);
  });

  it("returns 'unauthorized' on a 401 (expired JWT) so the result is not lost", async () => {
    const create = vi.fn().mockRejectedValue(new ApiError(401, null, "нет"));
    const out = await saveSoloResult({
      isAuthed: true,
      payload: buildSolvePayload("R", 1000, false),
      create,
    });
    expect(out).toBe("unauthorized");
  });

  it("returns 'failed' on any other error", async () => {
    const create = vi.fn().mockRejectedValue(new ApiError(500, null, "нет"));
    const out = await saveSoloResult({
      isAuthed: true,
      payload: buildSolvePayload("R", 1000, false),
      create,
    });
    expect(out).toBe("failed");
  });
});
