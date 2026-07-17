// Calibrate-first sub-hook for the solo ritual (Part A honest start). Owns the
// SOLVED-cube colour baseline that precedes the scramble: either a one-white-face
// quick-adjust over a seeded profile, or the full 6-face registration fallback
// (anon / no profile / a rejected quick-adjust). Extracted from useSoloSession to
// keep each file focused.
//
// HONESTY (skeptic HIGH#3/#4): quick-adjust demands a confidently WHITE face and is
// session-local only; a seeded+quick-adjusted reader is validated=false. wrong-face
// / diverged drop to the 6-face path — never a silent adjust.

import { useEffect, useRef, useState, type RefObject } from "react";
import { profileToRefs } from "../api/cubes";
import { useCubesStore } from "../store/cubesStore";
import type { CubeReader } from "../vision/hooks/useCubeReader";
import type { SoloPhase } from "./soloPhase";
import { faceUnreadableRu, quickAdjustWrongFaceRu, quickAdjustDivergedRu } from "../vision/guide";

export type CalibrateMode = "quick" | "full";

export interface CalibrateApi {
  calibrateMode: CalibrateMode;
  selectedCubeName: string | null;
  calibrationStep: number;
  calibrated: boolean;
  validated: boolean;
  calibrateError: string | null;
  calibrateStep: () => Promise<void>;
  fallbackToFullCalibration: () => void;
  /** Reset error state + clear/re-seed refs for a fresh cycle (plan #7 `again`). */
  reseed: () => void;
}

export function useCalibrate(opts: {
  reader: CubeReader;
  videoRef: RefObject<HTMLVideoElement | null>;
  phase: SoloPhase;
  cameraStarted: boolean;
  startCamera: () => Promise<void>;
  onCalibrated: () => void;
}): CalibrateApi {
  const { reader, videoRef, phase, cameraStarted, startCamera, onCalibrated } = opts;

  const selectedCubeId = useCubesStore((st) => st.selectedCubeId);
  const cubeList = useCubesStore((st) => st.list);
  const selectedCube = selectedCubeId ? cubeList.find((c) => c.id === selectedCubeId) ?? null : null;
  const profile = selectedCube?.color_profile ?? null;
  const hasProfile = profile !== null;

  // When quick-adjust rejects the shown face, drop to the 6-face path for this run.
  const [forceFull, setForceFull] = useState(false);
  const [calibrateError, setCalibrateError] = useState<string | null>(null);
  const calibrateMode: CalibrateMode = hasProfile && !forceFull ? "quick" : "full";

  // Seed the reader from the selected profile once per cube (session-local clone).
  const seededCubeRef = useRef<string | null>(null);
  useEffect(() => {
    if (hasProfile && selectedCubeId && seededCubeRef.current !== selectedCubeId) {
      reader.seedProfile(profileToRefs(profile!));
      seededCubeRef.current = selectedCubeId;
      setForceFull(false);
    }
    if (!hasProfile) seededCubeRef.current = null;
    // reader closures proxy stable refs; profile is derived from the deps.
  }, [hasProfile, selectedCubeId]);

  // Camera must be live during the calibrate-first screen (it precedes the scramble).
  useEffect(() => {
    if (phase === "calibrate" && !cameraStarted) void startCamera();
  }, [phase, cameraStarted, startCamera]);

  const calibrateStep = async (): Promise<void> => {
    setCalibrateError(null);
    await startCamera();
    const v = videoRef.current;
    if (!v) return;

    if (calibrateMode === "quick") {
      const r = reader.quickAdjust(v);
      switch (r.kind) {
        case "ok":
          onCalibrated();
          return;
        case "wrong-face":
          setForceFull(true);
          reader.recalibrate();
          setCalibrateError(quickAdjustWrongFaceRu());
          return;
        case "diverged":
          setForceFull(true);
          reader.recalibrate();
          setCalibrateError(quickAdjustDivergedRu());
          return;
        case "unreadable":
          setCalibrateError(faceUnreadableRu());
          return;
      }
    }

    // Full 6-face fallback (anon / no profile / rejected quick-adjust).
    reader.captureCalibration(v);
    if (reader.getProfile() !== null) onCalibrated();
  };

  const fallbackToFullCalibration = (): void => {
    setCalibrateError(null);
    setForceFull(true);
    reader.recalibrate();
  };

  const reseed = (): void => {
    setCalibrateError(null);
    setForceFull(false);
    if (hasProfile && profile) reader.seedProfile(profileToRefs(profile));
    else reader.recalibrate();
  };

  return {
    calibrateMode,
    selectedCubeName: selectedCube?.name ?? null,
    calibrationStep: reader.calibrationStep,
    calibrated: reader.calibrated,
    validated: reader.validated,
    calibrateError,
    calibrateStep,
    fallbackToFullCalibration,
    reseed,
  };
}
