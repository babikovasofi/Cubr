// @vitest-environment jsdom
//
// useScramble now sources its string from the backend (GET /scramble via
// api/scramble.ts) instead of the cubing CDN. Covers: happy path (fetch
// resolves), offline fallback (fetch rejects -> local generator, not stuck
// loading), and the last-resort error path (fetch AND local fallback both
// fail -> error state with retry).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const { fetchScrambleMock, randomScrambleMock, randomStateFaceletsMock } = vi.hoisted(() => ({
  fetchScrambleMock: vi.fn(),
  randomScrambleMock: vi.fn(),
  randomStateFaceletsMock: vi.fn(),
}));

vi.mock("../../src/api/scramble", () => ({
  fetchScramble: fetchScrambleMock,
}));

// Partial mock: keep the real scrambleToFacelets/validateFacelets/SOLVED, but
// let each test control the two LOCAL generators used by the offline fallback.
// Both default to the real implementation via mockImplementation below.
vi.mock("../../src/vision/cubeState", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/vision/cubeState")>();
  randomScrambleMock.mockImplementation(actual.randomScramble);
  randomStateFaceletsMock.mockImplementation(actual.randomStateFacelets);
  return {
    ...actual,
    randomScramble: randomScrambleMock,
    randomStateFacelets: randomStateFaceletsMock,
  };
});

import { useScramble } from "../../src/scramble/hooks/useScramble";
import { validateFacelets } from "../../src/vision/cubeState";

beforeEach(() => {
  fetchScrambleMock.mockReset();
  // Only clear call history — mockReset() would also wipe the real-impl
  // delegation wired up once in the vi.mock factory above.
  randomScrambleMock.mockClear();
  randomStateFaceletsMock.mockClear();
});

describe("useScramble", () => {
  it("uses the server scramble when fetchScramble resolves", async () => {
    fetchScrambleMock.mockResolvedValueOnce({
      scramble: "R U R' U' F2 D2 L B2 R2 U'",
      event: "333",
      scramble_token: "tok-abc",
    });
    const { result } = renderHook(() => useScramble());

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.scramble).toBe("R U R' U' F2 D2 L B2 R2 U'");
    expect(result.current.scrambleToken).toBe("tok-abc");
    expect(result.current.moves).toEqual(["R", "U", "R'", "U'", "F2", "D2", "L", "B2", "R2", "U'"]);
    expect(result.current.expectedFacelets).not.toBeNull();
    expect(validateFacelets(result.current.expectedFacelets!).ok).toBe(true);
    expect(fetchScrambleMock).toHaveBeenCalledTimes(1);
    // Local generators were never touched on the happy path.
    expect(randomScrambleMock).not.toHaveBeenCalled();
    expect(randomStateFaceletsMock).not.toHaveBeenCalled();
  });

  it("falls back to the local generator when fetchScramble rejects, and does not get stuck loading", async () => {
    fetchScrambleMock.mockRejectedValueOnce(new Error("network down"));
    const { result } = renderHook(() => useScramble());

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.scramble.length).toBeGreaterThan(0);
    // Locally-generated scramble has no server-issued token — must not leak
    // a stale/undefined value, and the solo save path relies on this null.
    expect(result.current.scrambleToken).toBeNull();
    expect(result.current.moves.length).toBeGreaterThan(0);
    expect(result.current.expectedFacelets).not.toBeNull();
    expect(validateFacelets(result.current.expectedFacelets!).ok).toBe(true);
    expect(randomScrambleMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces an error with retry available when both the fetch and the local fallback fail", async () => {
    fetchScrambleMock.mockRejectedValue(new Error("network down"));
    randomScrambleMock.mockImplementationOnce(() => {
      throw new Error("local move-gen exploded");
    });
    randomStateFaceletsMock.mockImplementationOnce(() => {
      throw new Error("local state-gen exploded too");
    });
    const { result } = renderHook(() => useScramble());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("local state-gen exploded too");
    expect(result.current.scramble).toBe("");
    expect(result.current.scrambleToken).toBeNull();
    expect(typeof result.current.regenerate).toBe("function");

    // Retry is available: calling it re-enters loading and can recover.
    fetchScrambleMock.mockResolvedValueOnce({
      scramble: "R U R' U'",
      event: "333",
      scramble_token: "tok-retry",
    });
    act(() => result.current.regenerate());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.scramble).toBe("R U R' U'");
    expect(result.current.scrambleToken).toBe("tok-retry");
  });

  it("clears a previous token on regenerate before the new fetch resolves (no stale id leak)", async () => {
    fetchScrambleMock.mockResolvedValueOnce({
      scramble: "R U R'",
      event: "333",
      scramble_token: "tok-first",
    });
    const { result } = renderHook(() => useScramble());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.scrambleToken).toBe("tok-first");

    let resolveSecond!: (v: { scramble: string; event: string; scramble_token: string }) => void;
    fetchScrambleMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSecond = resolve;
      }),
    );
    act(() => result.current.regenerate());
    // While the second fetch is in flight, the stale first token must be gone.
    expect(result.current.scrambleToken).toBeNull();

    resolveSecond({ scramble: "F2 B2", event: "333", scramble_token: "tok-second" });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.scrambleToken).toBe("tok-second");
  });
});

// Fixed mode (tournament reuse, П8): the scramble comes from the server's
// POST .../attempt/start response, not from this hook — it must never fetch or
// fall back to a locally-generated scramble in this mode.
describe("useScramble({ fixed })", () => {
  it("uses the fixed scramble synchronously — no fetch, no loading, no local fallback", () => {
    const { result } = renderHook(() => useScramble({ fixed: "R U R' U' F2 D2" }));

    expect(fetchScrambleMock).not.toHaveBeenCalled();
    expect(randomScrambleMock).not.toHaveBeenCalled();
    expect(randomStateFaceletsMock).not.toHaveBeenCalled();

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.scramble).toBe("R U R' U' F2 D2");
    expect(result.current.moves).toEqual(["R", "U", "R'", "U'", "F2", "D2"]);
    expect(result.current.scrambleToken).toBeNull();
    expect(result.current.expectedFacelets).not.toBeNull();
    expect(validateFacelets(result.current.expectedFacelets!).ok).toBe(true);
  });

  it("expectedFacelets is null (not thrown) when the fixed scramble can't be replayed", () => {
    const { result } = renderHook(() => useScramble({ fixed: "not a real scramble" }));
    expect(result.current.loading).toBe(false);
    expect(result.current.expectedFacelets).toBeNull();
    expect(result.current.error).toBeNull(); // a bad fixed scramble is not a hook error
  });

  it("regenerate() is a no-op in fixed mode — the scramble never changes and nothing fetches", () => {
    const { result } = renderHook(() => useScramble({ fixed: "R U R' U'" }));
    act(() => result.current.regenerate());
    expect(result.current.scramble).toBe("R U R' U'");
    expect(result.current.loading).toBe(false);
    expect(fetchScrambleMock).not.toHaveBeenCalled();
    expect(randomScrambleMock).not.toHaveBeenCalled();
  });
});
