// @vitest-environment jsdom
//
// Covers the state machine's phase transitions and its error-recovery paths
// (409 already-submitted, 401 mid-ritual, network failure) without touching
// fetch — api/daily is mocked directly, one level below the hook. Mirrors
// tests/tournament/useTournamentAttempt.test.ts.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const { getCurrentDailyMock, startDailyAttemptMock, submitDailyAttemptMock } = vi.hoisted(() => ({
  getCurrentDailyMock: vi.fn(),
  startDailyAttemptMock: vi.fn(),
  submitDailyAttemptMock: vi.fn(),
}));

vi.mock("../../src/api/daily", () => ({
  getCurrentDaily: getCurrentDailyMock,
  startDailyAttempt: startDailyAttemptMock,
  submitDailyAttempt: submitDailyAttemptMock,
}));

import { useDailyAttempt } from "../../src/daily/useDailyAttempt";
import { ApiError } from "../../src/api/client";

const NONE_CURRENT = {
  date: "2026-07-19",
  day_label: "2026-07-19",
  event: "333",
  attempt_status: null,
  time_ms: null,
  started_at: null,
  submitted_at: null,
  deadline_at: null,
};

const STARTED_CURRENT = {
  ...NONE_CURRENT,
  attempt_status: "started",
  started_at: "2026-07-19T00:00:00Z",
  deadline_at: "2026-07-19T00:10:00Z",
};

const TERMINAL_CURRENT = {
  ...NONE_CURRENT,
  attempt_status: "valid",
  time_ms: 12340,
  started_at: "2026-07-19T00:00:00Z",
  submitted_at: "2026-07-19T00:05:00Z",
};

const ATTEMPT = {
  id: "a1",
  daily_id: "d1",
  status: "started",
  honesty: "pending",
  time_ms: null,
  started_at: "2026-07-19T00:00:00Z",
  submitted_at: null,
  date: "2026-07-19",
  day_label: "2026-07-19",
  event: "333",
  scramble: "R U R' U'",
};

beforeEach(() => {
  getCurrentDailyMock.mockReset();
  startDailyAttemptMock.mockReset();
  submitDailyAttemptMock.mockReset();
});

describe("useDailyAttempt — load phase", () => {
  it("mounts by calling GET /current exactly once and never POSTs before commit", async () => {
    getCurrentDailyMock.mockResolvedValueOnce(NONE_CURRENT);
    const { result } = renderHook(() => useDailyAttempt());

    expect(result.current.state.phase).toBe("loading");
    await waitFor(() => expect(result.current.state.phase).toBe("precommit"));

    expect(getCurrentDailyMock).toHaveBeenCalledTimes(1);
    expect(startDailyAttemptMock).not.toHaveBeenCalled();
    expect(submitDailyAttemptMock).not.toHaveBeenCalled();
  });

  it("attempt_status 'started' on load lands on resume (no start call)", async () => {
    getCurrentDailyMock.mockResolvedValueOnce(STARTED_CURRENT);
    const { result } = renderHook(() => useDailyAttempt());
    await waitFor(() => expect(result.current.state.phase).toBe("resume"));
    expect(result.current.state.current?.deadline_at).toBe(STARTED_CURRENT.deadline_at);
    expect(startDailyAttemptMock).not.toHaveBeenCalled();
  });

  it("a terminal attempt_status on load skips the ritual entirely and lands on terminal", async () => {
    getCurrentDailyMock.mockResolvedValueOnce(TERMINAL_CURRENT);
    const { result } = renderHook(() => useDailyAttempt());
    await waitFor(() => expect(result.current.state.phase).toBe("terminal"));
    expect(result.current.state.terminal).toEqual({
      day_label: "2026-07-19",
      status: "valid",
      time_ms: 12340,
      forcedLateDnf: false,
    });
    expect(startDailyAttemptMock).not.toHaveBeenCalled();
  });

  it("a GET failure lands on load_error with a retry that can recover", async () => {
    getCurrentDailyMock.mockRejectedValueOnce(new ApiError(0, null, "Не удалось связаться с сервером."));
    const { result } = renderHook(() => useDailyAttempt());
    await waitFor(() => expect(result.current.state.phase).toBe("load_error"));

    getCurrentDailyMock.mockResolvedValueOnce(NONE_CURRENT);
    await act(() => result.current.retryLoad());
    expect(result.current.state.phase).toBe("precommit");
  });
});

describe("useDailyAttempt — commit", () => {
  it("commit() reveals the scramble via POST start and moves to active", async () => {
    getCurrentDailyMock.mockResolvedValueOnce(NONE_CURRENT);
    const { result } = renderHook(() => useDailyAttempt());
    await waitFor(() => expect(result.current.state.phase).toBe("precommit"));

    startDailyAttemptMock.mockResolvedValueOnce(ATTEMPT);
    getCurrentDailyMock.mockResolvedValueOnce(STARTED_CURRENT); // best-effort deadline refresh
    await act(() => result.current.commit());

    expect(result.current.state.phase).toBe("active");
    expect(result.current.state.attempt?.scramble).toBe("R U R' U'");
  });

  it("a commit failure lands on commit_error, retryable via commit() again", async () => {
    getCurrentDailyMock.mockResolvedValueOnce(NONE_CURRENT);
    const { result } = renderHook(() => useDailyAttempt());
    await waitFor(() => expect(result.current.state.phase).toBe("precommit"));

    startDailyAttemptMock.mockRejectedValueOnce(new ApiError(0, null, "Не удалось связаться с сервером."));
    await act(() => result.current.commit());
    expect(result.current.state.phase).toBe("commit_error");
    expect(result.current.state.attempt).toBeNull();
  });
});

describe("useDailyAttempt — submit", () => {
  async function toActive() {
    getCurrentDailyMock.mockResolvedValueOnce(NONE_CURRENT);
    const { result } = renderHook(() => useDailyAttempt());
    await waitFor(() => expect(result.current.state.phase).toBe("precommit"));

    startDailyAttemptMock.mockResolvedValueOnce(ATTEMPT);
    getCurrentDailyMock.mockResolvedValueOnce(STARTED_CURRENT);
    await act(() => result.current.commit());
    expect(result.current.state.phase).toBe("active");
    return result;
  }

  it("a valid solve submits {time_ms,status:'valid'} and lands on terminal", async () => {
    const result = await toActive();
    submitDailyAttemptMock.mockResolvedValueOnce({ ...ATTEMPT, status: "valid", time_ms: 9876 });

    await act(() => result.current.submit({ elapsedMs: 9876.4, dnf: false, cameraVerified: true }));

    expect(submitDailyAttemptMock).toHaveBeenCalledWith({ time_ms: 9876, status: "valid" });
    expect(result.current.state.phase).toBe("terminal");
    expect(result.current.state.terminal).toEqual({
      day_label: "2026-07-19",
      status: "valid",
      time_ms: 9876,
      forcedLateDnf: false,
    });
  });

  it("a DNF solve submits status:'dnf' and lands on terminal", async () => {
    const result = await toActive();
    submitDailyAttemptMock.mockResolvedValueOnce({ ...ATTEMPT, status: "dnf", time_ms: 1 });

    await act(() => result.current.submit({ elapsedMs: 0, dnf: true, cameraVerified: false }));

    expect(submitDailyAttemptMock).toHaveBeenCalledWith({ time_ms: 1, status: "dnf" });
    expect(result.current.state.terminal?.status).toBe("dnf");
  });

  it("flags forcedLateDnf when the client finished but the server's window had already closed", async () => {
    const result = await toActive();
    // Client thought it finished with a real time; server forces dnf anyway.
    submitDailyAttemptMock.mockResolvedValueOnce({ ...ATTEMPT, status: "dnf", time_ms: null });

    await act(() => result.current.submit({ elapsedMs: 8000, dnf: false, cameraVerified: true }));

    expect(result.current.state.terminal?.status).toBe("dnf");
    expect(result.current.state.terminal?.forcedLateDnf).toBe(true);
  });

  it("409 (already submitted elsewhere) recovers via GET and still lands on terminal", async () => {
    const result = await toActive();
    submitDailyAttemptMock.mockRejectedValueOnce(new ApiError(409, null, "Attempt already submitted"));
    getCurrentDailyMock.mockResolvedValueOnce(TERMINAL_CURRENT);

    await act(() => result.current.submit({ elapsedMs: 12340, dnf: false, cameraVerified: true }));

    expect(result.current.state.phase).toBe("terminal");
    expect(result.current.state.terminal?.status).toBe("valid");
  });

  it("401 mid-ritual keeps the result and is retryable with the SAME time_ms", async () => {
    const result = await toActive();
    submitDailyAttemptMock.mockRejectedValueOnce(new ApiError(401, null, "expired"));

    await act(() => result.current.submit({ elapsedMs: 5000, dnf: false, cameraVerified: true }));

    expect(result.current.state.phase).toBe("submit_error");
    expect(result.current.state.submitErrorKind).toBe("unauthorized");
    expect(result.current.state.pendingResult).toEqual({
      elapsedMs: 5000,
      dnf: false,
      cameraVerified: true,
    });

    submitDailyAttemptMock.mockResolvedValueOnce({ ...ATTEMPT, status: "valid", time_ms: 5000 });
    await act(() => result.current.retrySubmit());

    expect(submitDailyAttemptMock).toHaveBeenLastCalledWith({ time_ms: 5000, status: "valid" });
    expect(result.current.state.phase).toBe("terminal");
  });

  it("a network failure is retryable and never drops the result", async () => {
    const result = await toActive();
    submitDailyAttemptMock.mockRejectedValueOnce(new ApiError(0, null, "Не удалось связаться с сервером."));

    await act(() => result.current.submit({ elapsedMs: 7000, dnf: false, cameraVerified: true }));

    expect(result.current.state.phase).toBe("submit_error");
    expect(result.current.state.submitErrorKind).toBe("network");
    expect(result.current.state.pendingResult?.elapsedMs).toBe(7000);

    submitDailyAttemptMock.mockResolvedValueOnce({ ...ATTEMPT, status: "valid", time_ms: 7000 });
    await act(() => result.current.retrySubmit());
    expect(result.current.state.phase).toBe("terminal");
  });
});
