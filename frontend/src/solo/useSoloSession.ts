// Solo-ritual orchestrator. Owns the per-frame loop (camera onFrame → hands.detect
// → HandsFsm.step → phase reducer + timer), the 6-face verify collection, and the
// camera lifecycle. Ported from prototype/main.ts, adapted to React 19 hooks.
//
// StrictMode: the camera/hands are started imperatively on a user action (not in an
// effect), and a single unmount-cleanup effect stops the stream + closes the
// landmarker. stop()/close() are idempotent, so the StrictMode early-cleanup is safe.
//
// Timebase (plan #4/#6): the timer reads o.t (the frame timestamp) — startT/stopT
// live in the reducer; the live display derives from the current frame's nowTs. No
// performance.now() in a React handler.
//
// Tournament reuse (opts, П8): `fixedScramble` threads straight through to
// useScramble's fixed mode (no fetch, no local re-roll). `onResult` diverts the
// result-phase effect away from the solo save path (buildSolvePayload/createSolve)
// and instead calls back with the raw outcome exactly once, reusing the SAME
// one-shot `savedRef` guard as the solo branch so neither path can double-fire.
// `disableSoloSave` additionally suppresses the solo save path when no `onResult`
// is given (defensive — every current caller that sets one also sets the other).
// Solo callers (SoloPage) pass no opts at all, so this hook's behavior for them is
// unchanged.

import { useEffect, useReducer, useRef, useState } from "react";
import { HandsFsm } from "../vision/fsm";
import { config } from "../vision/config";
import { drawOverlay, defaultZones, type OverlayLabels } from "../vision/overlay";
import { useCamera, CameraError, type FrameInfo } from "../vision/hooks/useCamera";
import { cameraErrorRu } from "../vision/cameraErrors";
import { useHands, HandsInitError } from "../vision/hooks/useHands";
import { useCubeReader } from "../vision/hooks/useCubeReader";
import { useScramble } from "../scramble/hooks/useScramble";
import {
  cameraDeniedRu,
  modelFailedRu,
  faceUnreadableRu,
  rotationFailedRu,
  rotationAmbiguousRu,
  solveVerifyMismatchRu,
} from "../vision/guide";
import { soloReducer, initialSoloState, type SoloState } from "./soloPhase";
import { useCalibrate, type CalibrateMode } from "./useCalibrate";
import { buildSolvePayload, saveSoloResult, type SaveState } from "./solveSave";
import { isAuthed } from "../store/authStore";
import { getSelectedCubeId } from "../store/cubesStore";
import { useSettingsStore } from "../store/settingsStore";
import { formatSolveMs } from "../lib/formatTime";
import { SOLVED } from "../vision/cubeState";
import { createSolve } from "../api/solves";
import { toast } from "../components/Toast";
import { useT } from "../i18n/t";

export type { CalibrateMode };

const ZONES = defaultZones();
// Ключи перевода: подписи рисуются на canvas в цикле кадров, поэтому язык
// подставляется в момент отрисовки (см. labelsRef ниже), а не при импорте.
// Видео и canvas CSS-зеркалятся (scaleX(-1)), поэтому «сырая» левая зона
// (zones.left) выводится в ПРАВОЙ половине экрана. Пользователь видит себя как
// в зеркале: его настоящая правая рука — справа на экране. Значит над сырой
// левой зоной (= правая половина экрана) подпись «Правая рука», и наоборот.
const OVERLAY_LABEL_KEYS: OverlayLabels = {
  guide: "Держи кубик здесь",
  left: "Правая рука",
  right: "Левая рука",
};

export interface SoloSession {
  state: SoloState;
  // Refs for CameraStage to bind.
  videoRef: React.RefObject<HTMLVideoElement | null>;
  overlayRef: React.RefObject<HTMLCanvasElement | null>;
  workRef: React.RefObject<HTMLCanvasElement | null>;
  // Scramble.
  scramble: string;
  moves: string[];
  scrambleLoading: boolean;
  scrambleError: string | null;
  canVerify: boolean; // expected facelets available for the bridge
  regenerateScramble: () => void;
  // Camera.
  cameraStarted: boolean;
  cameraError: string | null;
  startCamera: () => Promise<void>;
  // Calibrate-first (honest start): quick one-white-face over a seeded profile, or
  // the full 6-face fallback for anon / no-profile / a failed quick-adjust.
  calibrateMode: CalibrateMode;
  selectedCubeName: string | null;
  calibrationStep: number;
  calibrated: boolean;
  validated: boolean; // false for the seeded+quick-adjust path (casual only, HIGH#4)
  calibrateError: string | null;
  calibrateStep: () => Promise<void>;
  useSavedProfile: () => void;
  fallbackToFullCalibration: () => void;
  // Scramble verify.
  collecting: boolean;
  verifyFacesLength: number;
  verifyError: string | null;
  verifyStep: () => Promise<void>;
  // Demo escape hatch: appears after repeated camera-read failures (skeptic-honest —
  // marks the result cameraVerified:false rather than pretending it verified).
  verifyFailCount: number;
  skipVerify: () => void;
  // Honest finish (solved-cube confirmation).
  solveVerifyError: string | null;
  solveVerifyStep: () => Promise<void>;
  solveVerifyFailCount: number;
  skipSolveVerify: () => void;
  // Navigation.
  gotoVerify: () => Promise<void>;
  backToWalkthrough: () => void;
  again: () => void;
  // Timer.
  timerSeconds: string;
  // Живые сигналы для панели «готово к таймеру» — чтобы человек видел, что
  // система его распознаёт и когда можно стартовать (throttled ~8 Гц).
  signals: { handsDetected: boolean; bothInZone: boolean; still: boolean; ready: boolean };
  // Server persistence of the finished result (plan §B #8).
  saveState: SaveState;
}

export interface UseSoloSessionOpts {
  /** Server-issued scramble (tournament attempt) — see useScramble's fixed mode. */
  fixedScramble?: string;
  /** When set, the result-phase effect calls this instead of saving to /solves. */
  onResult?: (r: { elapsedMs: number; dnf: boolean; cameraVerified: boolean }) => void;
  /** Suppress the solo /solves save path even without onResult (defensive). */
  disableSoloSave?: boolean;
}

export function useSoloSession(opts?: UseSoloSessionOpts): SoloSession {
  const t = useT();
  // Подписи оверлея живут в ref: рисуются в цикле кадров, а не в рендере, и
  // должны переезжать на новый язык без перезапуска камеры.
  const labelsRef = useRef<OverlayLabels>(OVERLAY_LABEL_KEYS);
  labelsRef.current = {
    guide: t(OVERLAY_LABEL_KEYS.guide),
    left: t(OVERLAY_LABEL_KEYS.left),
    right: t(OVERLAY_LABEL_KEYS.right),
  };
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const workRef = useRef<HTMLCanvasElement | null>(null);

  // Track death (device grabbed/unplugged/asleep) → reset so the UI can restart
  // without a page reload.
  const [cameraStarted, setCameraStarted] = useState(false);
  const timeFormat = useSettingsStore((s) => s.timeFormat);
  const camera = useCamera(videoRef, () => setCameraStarted(false));
  const hands = useHands();
  const reader = useCubeReader(workRef);
  const scramble = useScramble({ fixed: opts?.fixedScramble });

  const fsmRef = useRef<HandsFsm | null>(null);
  const getFsm = (): HandsFsm => (fsmRef.current ??= new HandsFsm());

  const [state, dispatch] = useReducer(soloReducer, initialSoloState);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [solveVerifyError, setSolveVerifyError] = useState<string | null>(null);
  const [liveMs, setLiveMs] = useState(0);
  // Живые сигналы распознавания для панели готовности. Пишутся троттлено
  // (~8 Гц), чтобы кадры не заваливали рендер (урок из dev-лабы таймера).
  const [signals, setSignals] = useState({
    handsDetected: false,
    bothInZone: false,
    still: false,
    ready: false,
  });
  const lastSigRef = useRef(0);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const savedRef = useRef(false);

  // Demo escape hatch (not a vision fix): counts consecutive failed 6-face reads
  // per verify screen so a "Пропустить" button can appear after repeated
  // camera-read failures, instead of blocking the ritual forever on R1 vision
  // accuracy. Reset whenever the tester leaves/restarts that screen.
  const [verifyFailCount, setVerifyFailCount] = useState(0);
  const [solveVerifyFailCount, setSolveVerifyFailCount] = useState(0);

  // Leave the loading gate once the scramble is generated.
  useEffect(() => {
    if (!scramble.loading && !scramble.error && stateRef.current.phase === "loading") {
      dispatch({ type: "scramble_ready" });
    }
  }, [scramble.loading, scramble.error]);

  // On entering "result": either hand off to the caller's onResult (tournament —
  // exactly once, no /solves write) or persist the solve exactly once (solo, plan
  // §B #8; anonymous = no-op). Same one-shot guard covers BOTH branches so neither
  // can double-fire (StrictMode double-run / re-renders).
  useEffect(() => {
    if (state.phase !== "result") {
      savedRef.current = false;
      return;
    }
    if (savedRef.current) return;
    savedRef.current = true;

    if (opts?.onResult) {
      opts.onResult({
        elapsedMs: state.elapsedMs,
        dnf: state.dnf,
        cameraVerified: state.cameraVerified,
      });
      return;
    }
    if (opts?.disableSoloSave) return;

    if (!isAuthed()) {
      setSaveState("anon");
      return;
    }
    setSaveState("saving");
    const payload = buildSolvePayload(
      scramble.scramble,
      state.elapsedMs,
      state.dnf,
      getSelectedCubeId(),
      state.cameraVerified,
      scramble.scrambleToken,
    );
    void saveSoloResult({
      isAuthed: true,
      payload,
      create: createSolve,
      onNewBadges: (badges) => {
        for (const b of badges) toast(`Бейдж получен: ${b.title}`, "success");
      },
    }).then(setSaveState);
  }, [
    state.phase,
    state.elapsedMs,
    state.dnf,
    state.cameraVerified,
    scramble.scramble,
    scramble.scrambleToken,
    opts?.onResult,
    opts?.disableSoloSave,
  ]);

  // Per-frame loop. Captured once at startCamera time; reads live refs, so it needs
  // no re-registration on re-render.
  const onFrame = (info: FrameInfo): void => {
    const { video, nowTs, width, height } = info;
    if (!width || !height) return;

    const obs = hands.detect(video, nowTs);

    const overlay = overlayRef.current;
    if (overlay) {
      overlay.width = width;
      overlay.height = height;
      const octx = overlay.getContext("2d");
      if (octx) drawOverlay(octx, width, height, obs, ZONES, config.GUIDE_RECT, labelsRef.current);
    }

    const st = stateRef.current;
    if (st.phase !== "armed" && st.phase !== "solving") return;

    const res = getFsm().step({
      t: nowTs,
      handsDetected: obs.handsDetected,
      bothInZone: obs.bothInZone,
      still: obs.still,
      handsOutOfZone: obs.handsOutOfZone,
    });
    if (res.event === "solve_start") dispatch({ type: "solve_start", t: nowTs });
    else if (res.event === "solve_stop") dispatch({ type: "solve_stop", t: nowTs });
    else if (res.event === "abort") {
      dispatch({ type: "abort" });
      getFsm().reset();
    }
    if (st.phase === "solving" && st.startT !== null) setLiveMs(nowTs - st.startT);

    // Троттленые сигналы готовности для панели (только пока ждём старт).
    if (st.phase === "armed" && nowTs - lastSigRef.current >= 120) {
      lastSigRef.current = nowTs;
      setSignals({
        handsDetected: obs.handsDetected,
        bothInZone: obs.bothInZone,
        still: obs.still,
        ready: res.state === "READY",
      });
    }
  };

  const startCamera = async (): Promise<void> => {
    if (cameraStarted && camera.isLive()) return;
    try {
      setCameraError(null);
      await hands.init();
      hands.setZones(ZONES);
      await camera.start(onFrame);
      setCameraStarted(true);
    } catch (e) {
      // Победила параллельная попытка: поток живой, значит ошибки нет — что бы
      // ни вернул наш собственный вызов. Иначе на экране остаётся работающее
      // видео с красной надписью «нет доступа к камере».
      if (camera.isLive()) {
        setCameraStarted(true);
        setCameraError(null);
        return;
      }
      if (e instanceof HandsInitError) setCameraError(modelFailedRu());
      else if (e instanceof CameraError) setCameraError(cameraErrorRu(e.kind));
      else setCameraError(cameraDeniedRu());
    }
  };

  // Unmount cleanup: stop the stream + close the landmarker (StrictMode-safe).
  useEffect(() => {
    return () => {
      camera.stop();
      hands.close();
    };
    // Run once: camera/hands proxy to stable refs, so an empty dep list is correct
    // and avoids tearing down the stream on every render.
  }, []);

  // Calibrate-first sub-hook (honest start): one-white-face quick-adjust over a
  // seeded profile, or the full 6-face fallback. Owns its own error/seed state.
  const calibrate = useCalibrate({
    reader,
    videoRef,
    phase: state.phase,
    cameraStarted,
    startCamera,
    onCalibrated: () => dispatch({ type: "calibrate_ok" }),
  });

  const verifyStep = async (): Promise<void> => {
    setVerifyError(null);
    if (!reader.calibrated) return;
    const expected = scramble.expectedFacelets;
    if (!expected) {
      setVerifyError("Не удалось подготовить эталон скрамбла. Обнови скрамбл.");
      return;
    }
    if (!reader.collecting) {
      reader.beginVerify();
      return;
    }
    const v = videoRef.current;
    if (!v) return;
    // Solo is casual (validated:false) — tolerant verify so a single colour misread
    // (R1) doesn't reject an honestly-scrambled cube. Ranked (Stage 4) will pass
    // tolerant=false. See config.CASUAL_VERIFY_MIN_CORRECT_FRAC.
    const r = await reader.pushVerifyFace(v, expected, true);
    switch (r.kind) {
      case "pending":
        return;
      case "ok":
        getFsm().reset();
        setVerifyFailCount(0);
        dispatch({ type: "verify_ok" });
        return;
      case "mismatch":
        setVerifyFailCount((n) => n + 1);
        dispatch({ type: "verify_mismatch", face: r.face, count: r.count });
        return;
      case "unreadable":
        setVerifyFailCount((n) => n + 1);
        // Причина отказа — часть сообщения: «повтори» без объяснения не даёт
        // человеку ничего сделать (блик? рамка мимо? два похожих цвета?).
        setVerifyError(r.diag ? `${faceUnreadableRu()} (${r.diag})` : faceUnreadableRu());
        reader.resetVerify();
        return;
      case "assign":
        setVerifyFailCount((n) => n + 1);
        setVerifyError(faceUnreadableRu());
        reader.resetVerify();
        return;
      case "ambiguous":
        setVerifyFailCount((n) => n + 1);
        setVerifyError(rotationAmbiguousRu());
        reader.resetVerify();
        return;
      case "illegal":
      case "resolve":
        setVerifyFailCount((n) => n + 1);
        setVerifyError(rotationFailedRu());
        reader.resetVerify();
        return;
    }
  };

  // Demo escape hatch: skip the camera verification after repeated failures
  // (verifyFailCount >= 2, gated in the UI). Arms the timer WITHOUT an honest
  // read — cameraVerified:false rides through to the result + verify_frames_ok.
  const skipVerify = (): void => {
    setVerifyError(null);
    setVerifyFailCount(0);
    reader.resetVerify();
    getFsm().reset();
    dispatch({ type: "verify_skip" });
  };

  // Honest finish: after the timer freezes (phase "stopped"), collect 6 faces and
  // check the cube is actually SOLVED (ground truth = SOLVED facelets, NOT the
  // scramble target — skeptic constraint #7). First tap begins the collector.
  const solveVerifyStep = async (): Promise<void> => {
    setSolveVerifyError(null);
    if (!reader.calibrated) return;
    if (!reader.collecting) {
      // First tap from "stopped" advances the phase; a re-begin after a
      // mismatch/error just restarts the collector (phase already solve_verify).
      if (state.phase === "stopped") dispatch({ type: "goto_solve_verify" });
      reader.beginVerify();
      return;
    }
    const v = videoRef.current;
    if (!v) return;
    // Casual solo honest-finish: tolerant match against SOLVED so a couple of
    // colour misreads don't reject a genuinely solved cube. Ranked → tolerant=false.
    const r = await reader.pushVerifyFace(v, SOLVED, true);
    switch (r.kind) {
      case "pending":
        return;
      case "ok":
        getFsm().reset();
        setSolveVerifyFailCount(0);
        dispatch({ type: "solve_verify_ok" });
        return;
      case "mismatch":
        setSolveVerifyFailCount((n) => n + 1);
        dispatch({ type: "solve_verify_mismatch", face: r.face, count: r.count });
        setSolveVerifyError(solveVerifyMismatchRu(r.count, t));
        reader.resetVerify();
        return;
      case "unreadable":
      case "assign":
        setSolveVerifyFailCount((n) => n + 1);
        setSolveVerifyError(
          "diag" in r && r.diag ? `${faceUnreadableRu()} (${r.diag})` : faceUnreadableRu(),
        );
        reader.resetVerify();
        return;
      case "ambiguous":
        setSolveVerifyFailCount((n) => n + 1);
        setSolveVerifyError(rotationAmbiguousRu());
        reader.resetVerify();
        return;
      case "illegal":
      case "resolve":
        setSolveVerifyFailCount((n) => n + 1);
        setSolveVerifyError(rotationFailedRu());
        reader.resetVerify();
        return;
    }
  };

  // Demo escape hatch: skip the honest-finish confirmation after repeated
  // failures (solveVerifyFailCount >= 2, gated in the UI). Reaches "result"
  // WITHOUT confirming the cube is actually solved — cameraVerified:false.
  const skipSolveVerify = (): void => {
    setSolveVerifyError(null);
    setSolveVerifyFailCount(0);
    reader.resetVerify();
    getFsm().reset();
    dispatch({ type: "solve_verify_skip" });
  };

  // Переход НЕ ждёт камеру: экран verify сам показывает cameraError и «Повторить»,
  // а startCamera может зависнуть (getUserMedia/video.play() по скрытому <video>,
  // пока walkthrough держит CameraStage в display:none). Раньше зависший await
  // просто съедал клик по «Готово, проверить» — кнопка выглядела мёртвой.
  const gotoVerify = async (): Promise<void> => {
    dispatch({ type: "goto_verify" });
    await startCamera();
  };

  const backToWalkthrough = (): void => {
    setVerifyError(null);
    setVerifyFailCount(0);
    reader.resetVerify();
    dispatch({ type: "back_to_walkthrough" });
  };

  const again = (): void => {
    getFsm().reset();
    reader.resetVerify();
    setVerifyError(null);
    setSolveVerifyError(null);
    setVerifyFailCount(0);
    setSolveVerifyFailCount(0);
    setLiveMs(0);
    setSaveState("idle");
    savedRef.current = false;
    // Clear/re-seed refs so a second solo re-does the honest start, never reusing
    // stale refs (plan #7).
    calibrate.reseed();
    // Solo-only: a fixed (tournament) scramble is single-use and regenerate() is
    // already a no-op for it — this guard just makes that intent explicit.
    if (!opts?.fixedScramble) scramble.regenerate();
    dispatch({ type: "again" });
  };

  const timerSeconds =
    state.phase === "solving"
      ? formatSolveMs(liveMs, timeFormat)
      : state.phase === "stopped" || state.phase === "solve_verify" || state.phase === "result"
        ? formatSolveMs(state.elapsedMs, timeFormat)
        : formatSolveMs(0, timeFormat);

  return {
    state,
    signals,
    videoRef,
    overlayRef,
    workRef,
    scramble: scramble.scramble,
    moves: scramble.moves,
    scrambleLoading: scramble.loading,
    scrambleError: scramble.error,
    canVerify: scramble.expectedFacelets !== null,
    regenerateScramble: scramble.regenerate,
    cameraStarted,
    cameraError,
    startCamera,
    calibrateMode: calibrate.calibrateMode,
    selectedCubeName: calibrate.selectedCubeName,
    calibrationStep: calibrate.calibrationStep,
    calibrated: calibrate.calibrated,
    validated: calibrate.validated,
    calibrateError: calibrate.calibrateError,
    calibrateStep: calibrate.calibrateStep,
    useSavedProfile: calibrate.useSavedProfile,
    fallbackToFullCalibration: calibrate.fallbackToFullCalibration,
    collecting: reader.collecting,
    verifyFacesLength: reader.verifyFacesLength,
    verifyError,
    verifyStep,
    verifyFailCount,
    skipVerify,
    solveVerifyError,
    solveVerifyStep,
    solveVerifyFailCount,
    skipSolveVerify,
    gotoVerify,
    backToWalkthrough,
    again,
    timerSeconds,
    saveState,
  };
}
