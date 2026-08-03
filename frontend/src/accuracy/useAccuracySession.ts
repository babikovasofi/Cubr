// Accuracy-run orchestrator (Stage 0.3, DEV-only). The useSoloSession pattern
// minus hands/FSM/timer/save: it owns the camera lifecycle, a guide-only overlay,
// the calibration passthrough, and the fixed-order accuracy collector. On a
// completed 6-face capture it assembles the RAW read, scores it against an
// INDEPENDENT ground truth (known scramble | SOLVED), and folds the result into a
// per-condition accumulator. Drops are counted, never discarded.

import { useEffect, useRef, useState } from "react";
import { config } from "../vision/config";
import { useCamera, CameraError, type FrameInfo } from "../vision/hooks/useCamera";
import { cameraErrorRu } from "../vision/cameraErrors";
import { useCubeReader } from "../vision/hooks/useCubeReader";
import { useScramble } from "../scramble/hooks/useScramble";
import {
  scoreRead,
  scoreFreeGrip,
  formatReport,
  type AccuracyReport,
  type CellDiag,
  type FaceFitDiag,
} from "../vision/accuracy";
import { lenientVerify, type LenientMatch } from "../vision/cubeGrid";
import {
  CAPTURE_ORDER,
  appendDrop,
  appendRead,
  undoRead,
  assembleRawRead,
  looksSolvedRead,
  formatRunSummary,
  type AccuracyRun,
  type ConditionKey,
} from "../vision/accuracyRun";
import { SOLVED, type Facelet } from "../vision/cubeState";
import {
  calibrationRejectedRu,
  cameraDeniedRu,
  centerAssignFailedRu,
  centerSpreadRu,
  faceUnreadableRu,
  fitSpreadRu,
} from "../vision/guide";
import {
  COLOR_NAMES,
  lab2rgb,
  anchorDistances,
  minSeparation,
  checkCalibration,
} from "../vision/colors";

export type AccuracyMode = "scramble" | "solved";
/**
 * Хватка. "fixed" — протокольная: фиксированный порядок захвата И фиксированная
 * ориентация, строгий позиционный счёт. "free" — кубик разрешено вертеть: грань
 * опознаётся по центру, внутри грани сравниваются мультимножества цветов.
 * Подробности и цена — в accuracy.scoreFreeGrip.
 */
export type AccuracyGrip = "fixed" | "free";

export interface AccuracySession {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  overlayRef: React.RefObject<HTMLCanvasElement | null>;
  workRef: React.RefObject<HTMLCanvasElement | null>;
  // Camera.
  cameraStarted: boolean;
  cameraError: string | null;
  startCamera: () => Promise<void>;
  // Mode + ground truth.
  mode: AccuracyMode;
  setMode: (m: AccuracyMode) => void;
  grip: AccuracyGrip;
  setGrip: (g: AccuracyGrip) => void;
  scramble: string;
  moves: string[];
  scrambleLoading: boolean;
  scrambleError: string | null;
  regenerateScramble: () => void;
  groundTruthReady: boolean;
  // Condition tag.
  condition: ConditionKey;
  setCondition: (patch: Partial<ConditionKey>) => void;
  // Calibration.
  calibrationStep: number;
  calibrated: boolean;
  // The 6 learned reference colours (Lab), for a debug swatch view — lets a
  // tester SEE whether calibration produced 6 distinct cube colours or muddy,
  // near-identical refs (which collapse every read to one colour).
  calibratedRefs: Record<string, [number, number, number]> | null;
  captureCalibration: () => void;
  recalibrate: () => void;
  // Accuracy capture.
  collectingAccuracy: boolean;
  accFacesLength: number;
  captureError: string | null;
  captureFace: () => void;
  cancelCapture: () => void;
  excludeLast: () => void;
  // Results.
  lastReport: AccuracyReport | null;
  lastProductReport: AccuracyReport | null;
  run: AccuracyRun;
  runVersion: number;
  resetRun: () => void;
  buildExport: () => string;
}

export function useAccuracySession(): AccuracySession {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const workRef = useRef<HTMLCanvasElement | null>(null);

  // If the live track dies (device grabbed/unplugged/asleep), flip back to the
  // not-started state so the "Включить камеру" button reappears and re-acquires —
  // no page reload needed.
  const [cameraStarted, setCameraStarted] = useState(false);
  const camera = useCamera(videoRef, () => setCameraStarted(false));
  const reader = useCubeReader(workRef);
  const scramble = useScramble();

  // HONESTY BARRIER (skeptic constraint #6): the accuracy harness measures a FRESH
  // full 6-face calibration and NEVER seeds from a stored profile — seeding would
  // fold a prior light's baseline (or a quick-adjust) into the very error we claim
  // to measure, inflating the accuracy gate. `reader.seedProfile`/`reader.quickAdjust`
  // are intentionally NOT called anywhere in this hook. A regression test asserts it.
  void reader.seedProfile; // referenced only to make the barrier explicit; never invoked

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [mode, setModeState] = useState<AccuracyMode>("scramble");
  const [grip, setGripState] = useState<AccuracyGrip>("fixed");
  const [condition, setConditionState] = useState<ConditionKey>({
    mode: "scramble",
    grip: "fixed",
    light: "",
    cube: "",
    person: "",
    calib: "fresh",
  });
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [lastReport, setLastReport] = useState<AccuracyReport | null>(null);
  // Второй счёт того же чтения — продуктовым путём (нормировка света + квоты).
  // Гейт по нему НЕ считается: его планка стоит на сыром зрении.
  const [lastProductReport, setLastProductReport] = useState<AccuracyReport | null>(null);
  // «Почему так прочиталось» по 54 ячейкам последнего чтения — идёт в отчёт рядом
  // с промахами, чтобы пересвет, промах сетки и слипшиеся эталоны различались.
  const [lastDiags, setLastDiags] = useState<CellDiag[] | null>(null);
  const [lastFits, setLastFits] = useState<FaceFitDiag[] | null>(null);
  // Совпадение с эталоном с точностью до поворота — диагностика «врёт зрение или
  // расходится сам кубик». В гейт не идёт.
  const [lastLenient, setLastLenient] = useState<LenientMatch | null>(null);
  const lastReadKeyRef = useRef<ConditionKey | null>(null);

  // The accumulator lives in a ref (append* mutate in place); a version counter
  // triggers the re-render so the panel recomputes the gate.
  const runRef = useRef<AccuracyRun>(new Map());
  const [runVersion, setRunVersion] = useState(0);
  const bump = (): void => setRunVersion((v) => v + 1);

  const conditionRef = useRef(condition);
  useEffect(() => {
    conditionRef.current = condition;
  }, [condition]);

  const setCondition = (patch: Partial<ConditionKey>): void =>
    setConditionState((c) => ({ ...c, ...patch }));

  // Режим — часть ключа условия, поэтому переключатель эталона обязан двигать и
  // тег. Иначе чтения санити попадут в условие, помеченное как скрамбл.
  const setMode = (m: AccuracyMode): void => {
    setModeState(m);
    setCondition({ mode: m });
  };

  // Хватка — часть ключа условия ровно по той же причине, что и режим эталона:
  // свободная и строгая меряют разное, смешивать их числа нельзя.
  const setGrip = (g: AccuracyGrip): void => {
    setGripState(g);
    setCondition({ grip: g });
  };

  // Guide-only overlay: draw the yellow capture frame + its U-edge marker. No
  // hands, no zones — this screen only needs the cube-face guide.
  const onFrame = (info: FrameInfo): void => {
    const { width, height } = info;
    if (!width || !height) return;
    const overlay = overlayRef.current;
    if (!overlay) return;
    overlay.width = width;
    overlay.height = height;
    const ctx = overlay.getContext("2d");
    if (!ctx) return;
    const g = config.GUIDE_RECT;
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = "#ffd23f";
    ctx.lineWidth = 3;
    ctx.strokeRect(g.x * width, g.y * height, g.w * width, g.h * height);
    ctx.fillStyle = "#ffd23f";
    ctx.fillRect(g.x * width, g.y * height - 6, g.w * width, 4);
  };

  const startCamera = async (): Promise<void> => {
    if (cameraStarted && camera.isLive()) return;
    try {
      setCameraError(null);
      await camera.start(onFrame);
      setCameraStarted(true);
    } catch (e) {
      if (e instanceof CameraError) setCameraError(cameraErrorRu(e.kind));
      else setCameraError(cameraDeniedRu());
    }
  };

  useEffect(() => {
    return () => camera.stop();
    // Run once: camera proxies to a stable ref.
  }, []);

  const groundTruth = (): Facelet | null =>
    mode === "solved" ? SOLVED : scramble.expectedFacelets;

  const captureCalibration = (): void => {
    const v = videoRef.current;
    if (!v) return;
    setCaptureError(null);
    if (!reader.captureCalibration(v) && reader.calibrationProblem) {
      // Набор отвергнут целиком, счётчик уже сброшен на 0/6 — молчать нельзя,
      // иначе человек видит только исчезнувший прогресс.
      setCaptureError(calibrationRejectedRu(reader.calibrationProblem));
    }
  };

  const recalibrate = (): void => {
    setCaptureError(null);
    reader.recalibrate();
    reader.resetAccuracy();
    setCondition({ calib: "fresh" });
  };

  const captureFace = async (): Promise<void> => {
    setCaptureError(null);
    if (!reader.calibrated) {
      setCaptureError("Сначала откалибруй камеру: покажи 6 граней собранного кубика.");
      return;
    }
    const truth = groundTruth();
    if (!truth) {
      setCaptureError("Нет эталона. Обнови скрамбл (или переключись в режим «собранный»).");
      return;
    }
    if (!reader.collectingAccuracy) {
      reader.beginAccuracy();
      return;
    }
    const v = videoRef.current;
    if (!v) return;
    const r = await reader.pushAccuracyFace(v);
    // Drift is advisory now (auto-WB drift shouldn't block data collection) — the
    // face was captured; just surface how far it drifted so the tester knows.
    const driftNote = (d?: { face: string; de: number }): string =>
      d
        ? ` (грань ${d.face} уплыла на ΔE ${d.de.toFixed(1)} > ${config.CENTER_DRIFT_DE} — сняли всё равно, попадёт в точность)`
        : "";
    switch (r.kind) {
      case "pending":
        setCaptureError(r.drifted ? `Снято${driftNote(r.drifted)}` : null);
        return;
      case "unreadable":
        // «Сняли не кубик» — не брак чтения, а промах наводки на ОДНОЙ грани:
        // уже снятые грани целы, лечится повтором этой грани. Бросать всё
        // чтение в дроп значило бы наказывать тестировщика за подсказку камеры
        // — за двадцать чтений это выгонит его с харнесса.
        if (r.reason === "not-a-face") {
          setCaptureError(r.diag ?? faceUnreadableRu());
          return;
        }
        setCaptureError(r.diag ? `${faceUnreadableRu()} (${r.diag})` : faceUnreadableRu());
        appendDrop(runRef.current, conditionRef.current, "unreadable");
        reader.resetAccuracy();
        bump();
        return;
      case "complete": {
        // Гейт меряет СЫРОЕ зрение (argmin по несглаженным цветам): подпорки
        // продуктового пути не должны прятать реальную ошибку классификации.
        // Продуктовое чтение (нормировка света + квоты 9×6) считается рядом —
        // это то, что видит человек в соло, и обе цифры нужны, чтобы понимать,
        // сколько даёт зрение, а сколько ограничения поверх него.
        // Кубик прочитан собранным, а эталон — скрамбл: скрамбл не собран на
        // кубике. Это ошибка условия замера, а не зрения, поэтому чтение не
        // скорится вовсе; в дропы идёт как mis-scramble — тем же путём, что и
        // разобранный вручную промах, чтобы ничего не пропадало молча.
        if (truth !== SOLVED && looksSolvedRead(r.rawFaceGrids)) {
          setCaptureError(
            "Кубик прочитан как СОБРАННЫЙ, а эталон — скрамбл. Похоже, скрамбл не собран на кубике: собери его по шагам слева (белый центр вверх, зелёный центр к себе) и сними чтение заново.",
          );
          appendDrop(runRef.current, conditionRef.current, "mis-scramble");
          bump();
          return;
        }
        // Совпадает ли чтение с эталоном С ТОЧНОСТЬЮ ДО ПОВОРОТА: 24 ориентации
        // кубика × поворот каждой грани. Это ДИАГНОСТИКА, в гейт она не идёт
        // никогда — выравнивание, подобранное под ответ, и есть тот самый
        // survivorship bias, ради запрета которого порядок захвата зафиксирован.
        const lenient = lenientVerify(r.rawFaceGrids, [...CAPTURE_ORDER], truth);
        setLastLenient(lenient);

        // Свободная хватка: грань опознаётся по центру, внутри грани цвета
        // сравниваются мультимножествами, центры из счёта исключены. Ориентация
        // тут не нарушение, а разрешённое условие, поэтому замок ниже не про неё.
        if (grip === "free") {
          // Выравнивание — из раскладки шести съёмок по шести цветам (сырые
          // центры), а не из одиночного argmin по центру: тот на тёплом свете
          // выдаёт один цвет дважды и топит чтение, в котором зрение не виновато.
          // Раскладка отказала — так и говорим, с её собственной причиной.
          if (!r.rawCenterFaces) {
            const o = r.rawCenterOffender;
            const spread = r.rawCenterSpread;
            const head = o
              ? centerAssignFailedRu(o.capture, o.face, o.de, config.CENTER_MAX_DELTA_E)
              : `Грани не опознаны по центрам: ${r.rawCenterReason ?? "раскладка не сошлась"}.`;
            setCaptureError(
              [
                head,
                spread ? centerSpreadRu(spread.faces, spread.des, spread.medianDE) : null,
                r.fitDiags.length ? fitSpreadRu(r.fitDiags) : null,
              ]
                .filter(Boolean)
                .join(" "),
            );
            appendDrop(runRef.current, conditionRef.current, "assign");
            bump();
            return;
          }
          const free = scoreFreeGrip(r.rawFaceGrids, truth, undefined, r.rawCenterFaces);
          if (free.kind === "assign-conflict") {
            setCaptureError(`Грани не опознаны по центрам: ${free.reason}.`);
            appendDrop(runRef.current, conditionRef.current, "assign");
            bump();
            return;
          }
          const freeProduct = scoreFreeGrip(r.productFaceGrids, truth, undefined, r.rawCenterFaces);
          appendRead(runRef.current, conditionRef.current, free.report);
          lastReadKeyRef.current = conditionRef.current;
          setLastReport(free.report);
          setLastProductReport(freeProduct.kind === "ok" ? freeProduct.report : null);
          setLastDiags(r.cellDiags);
          setLastFits(r.fitDiags);
          setCaptureError(r.drifted ? `Чтение готово${driftNote(r.drifted)}` : null);
          bump();
          return;
        }

        const strictWrong = 54 - scoreRead(assembleRawRead(r.rawFaceGrids), truth).correct;
        // Почти идеальное совпадение при развале по фиксированному выравниванию
        // значит одно: цвета прочитаны верно, а кубик держали иначе. Зрение тут
        // ни при чём, и записывать ему такое чтение нельзя. Порог держим жёстким
        // (≤2 расхождения из 54): при мягком сюда затекли бы настоящие ошибки
        // классификации, и гейт стало бы нечем провалить.
        if (lenient.mismatches <= 2 && strictWrong >= 6) {
          setCaptureError(
            `Цвета прочитаны верно (${54 - lenient.mismatches}/54 с точностью до поворота), но кубик был показан в другой ориентации, ` +
              "поэтому чтение не засчитано. Держи белый центр вверху и зелёный к себе, грани показывай по подсказкам, не переворачивая кубик между шагами.",
          );
          appendDrop(runRef.current, conditionRef.current, "orientation");
          bump();
          return;
        }
        const raw = assembleRawRead(r.rawFaceGrids);
        const report = scoreRead(raw, truth);
        const productReport = scoreRead(assembleRawRead(r.productFaceGrids), truth);
        appendRead(runRef.current, conditionRef.current, report);
        lastReadKeyRef.current = conditionRef.current;
        setLastReport(report);
        setLastProductReport(productReport);
        setLastDiags(r.cellDiags);
        setLastFits(r.fitDiags);
        setCaptureError(r.drifted ? `Чтение готово${driftNote(r.drifted)}` : null);
        bump();
        return;
      }
    }
  };

  const cancelCapture = (): void => {
    setLastProductReport(null);
    setCaptureError(null);
    reader.resetAccuracy();
  };

  // Tester saw the last read was a mis-scramble/bad capture: un-merge it (keeping
  // the condition's other reads) and book it as a mis-scramble drop.
  const excludeLast = (): void => {
    if (!lastReport || !lastReadKeyRef.current) return;
    undoRead(runRef.current, lastReadKeyRef.current, lastReport, "mis-scramble");
    lastReadKeyRef.current = null;
    setLastReport(null);
    setLastDiags(null);
    setLastFits(null);
    setLastLenient(null);
    bump();
  };

  const resetRun = (): void => {
    runRef.current = new Map();
    lastReadKeyRef.current = null;
    setLastReport(null);
    setLastProductReport(null);
    setLastDiags(null);
    setLastFits(null);
    setLastLenient(null);
    bump();
  };

  const buildExport = (): string => {
    const parts: string[] = [];
    if (lastReport) {
      parts.push("=== Последнее чтение (СЫРОЕ зрение — по нему гейт) ===");
      parts.push(formatReport(lastReport, lastDiags ?? undefined, lastFits ?? undefined));
      if (lastLenient) {
        // Одна строка отвечает на вопрос, который иначе решается гаданием:
        // ошибается зрение или расходится сам кубик. Совпало с точностью до
        // поворота — цвета прочитаны верно, разошлась ориентация или порядок
        // захвата. Не совпало ни в одной ориентации — на кубике не тот скрамбл,
        // ЛИБО зрение действительно врёт, и вот тогда цифры выше про зрение.
        parts.push(
          `С точностью до поворота кубика (24 ориентации × поворот граней): ` +
            `${54 - lastLenient.mismatches}/54, хуже всего грань ${lastLenient.worstFace} ` +
            `(${lastLenient.worstCount} из 9). В ГЕЙТ НЕ ИДЁТ — выравнивание под ответ запрещено протоколом.`,
        );
      }
      parts.push("");
    }
    if (lastProductReport) {
      const raw = lastReport ? lastReport.correct : 0;
      parts.push("=== То же чтение продуктовым путём (нормировка света + квоты 9×6) ===");
      parts.push(
        `Per-sticker: ${lastProductReport.correct}/${lastProductReport.total} = ` +
          `${(lastProductReport.fraction * 100).toFixed(1)}%` +
          (lastReport ? ` (сырое: ${raw}/${lastReport.total})` : ""),
      );
      parts.push("Гейт 0.3 считается по сырому чтению — эта строка справочная.");
      parts.push("");
    }
    parts.push("=== Сводка прогона ===");
    parts.push(formatRunSummary(runRef.current));

    const refs = reader.getProfile();
    if (refs) {
      const sep = minSeparation(refs);
      const anchors = anchorDistances(refs);
      const lines = ["", "=== Эталоны калибровки (что камера сняла как цвета) ==="];
      for (const n of COLOR_NAMES) {
        const lab = refs[n];
        const [r, g, b] = lab2rgb(lab);
        lines.push(
          `  ${n}: RGB(${r},${g},${b})  Lab(${lab.map((x) => x.toFixed(0)).join(",")})` +
            `  ΔE до анкора ${anchors[n].toFixed(1)}`,
        );
      }
      lines.push(
        `  min попарный ΔE: ${sep.de.toFixed(1)} (${sep.a}–${sep.b}) ` +
          `(если мало ~<20 — эталоны слиплись, камера не различает цвета)`,
      );
      // Расстояние до анкора само по себе НЕ повод отказать: на живой камере
      // рабочие синий/зелёный уходили от анкора дальше, чем испорченный белый.
      // Отказ даёт структурная проверка — её вердикт и печатаем.
      const problem = checkCalibration(refs);
      lines.push(
        problem
          ? `  ВЕРДИКТ: набор негоден — ${calibrationRejectedRu(problem)}`
          : `  ВЕРДИКТ: набор годен (белый самый светлый, цвета не слиплись)`,
      );
      parts.push(lines.join("\n"));
    }
    return parts.join("\n");
  };

  return {
    videoRef,
    overlayRef,
    workRef,
    cameraStarted,
    cameraError,
    startCamera,
    mode,
    setMode,
    grip,
    setGrip,
    scramble: scramble.scramble,
    moves: scramble.moves,
    scrambleLoading: scramble.loading,
    scrambleError: scramble.error,
    regenerateScramble: scramble.regenerate,
    groundTruthReady: groundTruth() !== null,
    condition,
    setCondition,
    calibrationStep: reader.calibrationStep,
    calibrated: reader.calibrated,
    calibratedRefs: reader.getProfile(),
    captureCalibration,
    recalibrate,
    collectingAccuracy: reader.collectingAccuracy,
    accFacesLength: reader.accFacesLength,
    captureError,
    captureFace,
    cancelCapture,
    excludeLast,
    lastReport,
    lastProductReport,
    run: runRef.current,
    runVersion,
    resetRun,
    buildExport,
  };
}
