// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useTournamentStandings } from "../../src/tournament/useTournamentStandings";
import { ApiError } from "../../src/api/client";

const { getStandingsMock } = vi.hoisted(() => ({
  getStandingsMock: vi.fn(),
}));

vi.mock("../../src/api/tournament", () => ({
  getStandings: getStandingsMock,
}));

const STANDINGS = {
  iso_year: 2026,
  iso_week: 29,
  week_label: "2026-W29",
  event: "333",
  entries: [
    { display_name: "Alice", time_ms: 5000, is_self: false },
    { display_name: "Bob", time_ms: 3000, is_self: true },
  ],
  your_entry: { display_name: "Bob", time_ms: 3000, is_self: true },
  valid_count: 2,
  dnf_count: 0,
};

beforeEach(() => {
  getStandingsMock.mockReset();
});

afterEach(() => vi.clearAllMocks());

describe("useTournamentStandings", () => {
  it("mounts, fetches getStandings once, transitions loading→data", async () => {
    getStandingsMock.mockResolvedValueOnce(STANDINGS);
    const { result } = renderHook(() => useTournamentStandings());

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
    expect(getStandingsMock).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(STANDINGS);
    expect(result.current.error).toBeNull();
  });

  it("empty response (no entries) is ok", async () => {
    const emptyStandings = {
      iso_year: 2026,
      iso_week: 29,
      week_label: "2026-W29",
      event: "333",
      entries: [],
      your_entry: null,
      valid_count: 0,
      dnf_count: 0,
    };
    getStandingsMock.mockResolvedValueOnce(emptyStandings);
    const { result } = renderHook(() => useTournamentStandings());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(emptyStandings);
    expect(result.current.error).toBeNull();
  });

  it("fetch reject surfaces error, reload recovers to data", async () => {
    const apiError = new ApiError(500, null, "Server error");
    getStandingsMock.mockRejectedValueOnce(apiError);
    const { result } = renderHook(() => useTournamentStandings());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
    expect(result.current.data).toBeNull();

    // Reload
    getStandingsMock.mockResolvedValueOnce(STANDINGS);
    await act(async () => {
      result.current.reload();
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(STANDINGS);
    expect(result.current.error).toBeNull();
    expect(getStandingsMock).toHaveBeenCalledTimes(2);
  });

  it("aborts request on unmount", async () => {
    let capturedSignal: AbortSignal | undefined;
    getStandingsMock.mockImplementation((_, signal) => {
      capturedSignal = signal;
      return new Promise(() => {}); // Never resolves
    });

    const { unmount } = renderHook(() => useTournamentStandings());
    expect(getStandingsMock).toHaveBeenCalledTimes(1);
    expect(capturedSignal).toBeTruthy();
    expect(capturedSignal?.aborted).toBe(false);

    unmount();

    await waitFor(() => {
      expect(capturedSignal?.aborted).toBe(true);
    });
  });
});
