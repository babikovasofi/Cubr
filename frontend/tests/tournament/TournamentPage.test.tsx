// @vitest-environment jsdom
//
// RTL coverage for the composed page (plan: tournament-ui). The ritual itself
// (camera/hands/vision) is already covered elsewhere (soloPhase, useCubeReader,
// fsm tests); here useSoloSession is stubbed so these tests verify ONLY the
// tournament wiring: П8 (no scramble before an explicit commit), the two-step
// danger confirm, terminal-on-load, the forced-late-DNF note, and the resume
// countdown — driven through the REAL useTournamentAttempt + api/tournament
// mocked one level below fetch.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const { getCurrentMock, startAttemptMock, submitAttemptMock, getStandingsMock } = vi.hoisted(
  () => ({
    getCurrentMock: vi.fn(),
    startAttemptMock: vi.fn(),
    submitAttemptMock: vi.fn(),
    getStandingsMock: vi.fn(),
  }),
);

vi.mock("../../src/api/tournament", () => ({
  getCurrent: getCurrentMock,
  startAttempt: startAttemptMock,
  submitAttempt: submitAttemptMock,
  getStandings: getStandingsMock,
}));

// Stub the ritual hook: TournamentPage's own wiring is under test, not the
// camera/vision ritual (which needs no mocking here — it's simply never asked
// to render more than its "loading" gate).
const { useSoloSessionMock } = vi.hoisted(() => ({ useSoloSessionMock: vi.fn() }));
vi.mock("../../src/solo/useSoloSession", () => ({ useSoloSession: useSoloSessionMock }));

import TournamentPage from "../../src/pages/TournamentPage";
import { initialSoloState } from "../../src/solo/soloPhase";
import type { SoloSession, UseSoloSessionOpts } from "../../src/solo/useSoloSession";

let capturedOnResult: UseSoloSessionOpts["onResult"] | undefined;

function stubSession(): SoloSession {
  return {
    state: initialSoloState,
    signals: { handsDetected: false, bothInZone: false, still: false, ready: false },
    videoRef: { current: null },
    overlayRef: { current: null },
    workRef: { current: null },
    scramble: "",
    moves: [],
    scrambleLoading: true,
    scrambleError: null,
    canVerify: false,
    regenerateScramble: () => {},
    cameraStarted: false,
    cameraError: null,
    startCamera: async () => {},
    calibrateMode: "full",
    selectedCubeName: null,
    calibrationStep: 0,
    calibrated: false,
    validated: false,
    calibrateError: null,
    calibrateStep: async () => {},
    useSavedProfile: () => {},
    fallbackToFullCalibration: () => {},
    collecting: false,
    verifyFacesLength: 0,
    verifyCapturedFaces: [],
    verifyError: null,
    verifyStep: async () => {},
    dropVerifyFace: () => {},
    verifyFailCount: 0,
    skipVerify: () => {},
    solveVerifyError: null,
    solveVerifyStep: async () => {},
    solveVerifyFailCount: 0,
    skipSolveVerify: () => {},
    gotoVerify: async () => {},
    backToWalkthrough: () => {},
    again: () => {},
    timerSeconds: "0.00",
    saveState: "idle",
  };
}

useSoloSessionMock.mockImplementation((opts?: UseSoloSessionOpts) => {
  capturedOnResult = opts?.onResult;
  return stubSession();
});

const NONE_CURRENT = {
  iso_year: 2026,
  iso_week: 29,
  week_label: "2026-W29",
  event: "333",
  attempt_status: null,
  time_ms: null,
  started_at: null,
  submitted_at: null,
  deadline_at: null,
};

const ATTEMPT = {
  id: "a1",
  tournament_id: "t1",
  status: "started",
  honesty: "pending",
  time_ms: null,
  started_at: "2026-07-17T00:00:00Z",
  submitted_at: null,
  iso_year: 2026,
  iso_week: 29,
  week_label: "2026-W29",
  event: "333",
  scramble: "R U R' U' F2 D2 L B2 R2 U'",
};

function renderPage() {
  return render(
    <MemoryRouter>
      <TournamentPage />
    </MemoryRouter>,
  );
}

const EMPTY_STANDINGS = {
  iso_year: 2026,
  iso_week: 29,
  week_label: "2026-W29",
  event: "333",
  entries: [],
  your_entry: null,
  valid_count: 0,
  dnf_count: 0,
};

beforeEach(() => {
  getCurrentMock.mockReset();
  startAttemptMock.mockReset();
  submitAttemptMock.mockReset();
  getStandingsMock.mockReset();
  getStandingsMock.mockResolvedValue(EMPTY_STANDINGS);
  capturedOnResult = undefined;
});

describe("TournamentPage — precommit (П8)", () => {
  it("never shows the scramble before commit, and the two-step confirm calls start exactly once", async () => {
    getCurrentMock.mockResolvedValueOnce(NONE_CURRENT);
    renderPage();

    const commitButton = await screen.findByRole("button", { name: "Сделать попытку" });
    // Both the precommit card and the standings board render the week label —
    // assert at least one instance rather than a single unique match.
    expect(screen.getAllByText(/2026-W29/).length).toBeGreaterThan(0);
    // The scramble string must never appear anywhere in the DOM pre-commit.
    expect(screen.queryByText(ATTEMPT.scramble)).toBeNull();
    expect(startAttemptMock).not.toHaveBeenCalled();

    // First click only opens the inline confirm — must NOT call start yet.
    fireEvent.click(commitButton);
    await screen.findByRole("button", { name: "Да, начать" });
    expect(startAttemptMock).not.toHaveBeenCalled();

    // "Отмена" backs out without ever calling start.
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(screen.queryByRole("button", { name: "Да, начать" })).toBeNull();
    expect(startAttemptMock).not.toHaveBeenCalled();

    // Second pass through the two-step confirm actually commits.
    fireEvent.click(screen.getByRole("button", { name: "Сделать попытку" }));
    startAttemptMock.mockResolvedValueOnce(ATTEMPT);
    getCurrentMock.mockResolvedValueOnce({ ...NONE_CURRENT, attempt_status: "started" });
    fireEvent.click(await screen.findByRole("button", { name: "Да, начать" }));

    await waitFor(() => expect(startAttemptMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(useSoloSessionMock).toHaveBeenCalled());
    const opts = useSoloSessionMock.mock.calls.at(-1)?.[0] as UseSoloSessionOpts;
    expect(opts.fixedScramble).toBe(ATTEMPT.scramble);
    expect(opts.disableSoloSave).toBe(true);
  });
});

describe("TournamentPage — terminal on load", () => {
  it("a completed week skips the ritual and renders the result directly", async () => {
    getCurrentMock.mockResolvedValueOnce({
      ...NONE_CURRENT,
      attempt_status: "valid",
      time_ms: 12340,
    });
    renderPage();

    expect(await screen.findByText("12.34")).toBeTruthy();
    expect(startAttemptMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Ещё раз")).toBeNull();
  });

  it("a DNF week renders DNF quietly, with no re-roll CTA", async () => {
    getCurrentMock.mockResolvedValueOnce({
      ...NONE_CURRENT,
      attempt_status: "dnf",
      time_ms: null,
    });
    renderPage();

    expect(await screen.findByText("DNF")).toBeTruthy();
    expect(screen.queryByText("Ещё раз")).toBeNull();
  });
});

describe("TournamentPage — resume", () => {
  it("shows a countdown to deadline_at and Продолжить re-commits (idempotent)", async () => {
    const deadline = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    getCurrentMock.mockResolvedValueOnce({
      ...NONE_CURRENT,
      attempt_status: "started",
      started_at: new Date().toISOString(),
      deadline_at: deadline,
    });
    renderPage();

    await screen.findByText(/Осталось \d+:\d{2} на эту попытку/);
    const resumeButton = screen.getByRole("button", { name: "Продолжить" });

    startAttemptMock.mockResolvedValueOnce(ATTEMPT);
    getCurrentMock.mockResolvedValueOnce({
      ...NONE_CURRENT,
      attempt_status: "started",
      deadline_at: deadline,
    });
    fireEvent.click(resumeButton);

    await waitFor(() => expect(startAttemptMock).toHaveBeenCalledTimes(1));
  });
});

describe("TournamentPage — forced late-DNF note", () => {
  it("surfaces the note when the server forces dnf despite a real client time", async () => {
    getCurrentMock.mockResolvedValueOnce(NONE_CURRENT);
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Сделать попытку" }));
    startAttemptMock.mockResolvedValueOnce(ATTEMPT);
    getCurrentMock.mockResolvedValueOnce({ ...NONE_CURRENT, attempt_status: "started" });
    fireEvent.click(await screen.findByRole("button", { name: "Да, начать" }));

    await waitFor(() => expect(capturedOnResult).toBeDefined());

    submitAttemptMock.mockResolvedValueOnce({ ...ATTEMPT, status: "dnf", time_ms: null });
    await act(async () => {
      capturedOnResult!({ elapsedMs: 8000, dnf: false, cameraVerified: true });
    });

    expect(await screen.findByText("DNF")).toBeTruthy();
    expect(
      screen.getByText(/Окно попытки истекло до того, как результат дошёл до сервера/),
    ).toBeTruthy();
  });
});
