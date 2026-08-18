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
  scorePictureGrip,
  formatReport,
  type AccuracyReport,
  formatRawGrids,
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
  type DropReason,
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
  nearestNeighbours,
  checkCalibration,
} from "../vision/colors";

export type AccuracyMode = "scramble" | "solved";
/**
 * Хватка — ось условия, а не пометка: числа разных хваток не смешиваются.
 *
 * "fixed" — протокольная: фиксированный порядок захвата И фиксированная
 * ориентация, строгий позиционный счёт по 54.
 *
 * "free" — кубик разрешено вертеть: грань опознаётся по центру, внутри грани
 * сравниваются МУЛЬТИМНОЖЕСТВА цветов (48). Цена — слепота к перестановке
 * наклеек внутри грани. Подробности в accuracy.scoreFreeGrip.
 *
 * "picture" — кубик так же разрешено вертеть, но грань сравнивается с эталонной
 * ПОЗИЦИОННО, с точностью до её поворота в кадре (48). Поворот выводится из
 * физики кубика, а не из совпадения с ответом. Ловит перестановку внутри грани,
 * которую "free" не видит, и не мерит руки, как "fixed". Подробности и замки —
 * в accuracy.scorePictureGrip.
 */
export type AccuracyGrip = "fixed" | "free" | "picture";

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
  /**
   * Текст последнего брака — им же управляется доступность «Копировать отчёт».
   *
   * Кнопка гасла, когда в прогоне не было ни одного СЧИТАННОГО чтения, — то
   * есть ровно в том случае, ради которого брак и начали запоминать: три дропа
   * подряд, копировать нечего, отчёт недоступен. Диагностика, до которой нельзя
   * дотянуться, не диагностика.
   */
  lastDropText: string | null;
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
  // Текст последнего БРАКА, слово в слово как его увидел человек.
  //
  // До этого «Копировать отчёт» отдавал только успешные чтения, а дроп жил одной
  // строкой на экране и умирал со следующей съёмкой. Прогон, где в дроп ушло
  // ВСЁ (stickerless/LED, 2026-08-19), копировался как пустая сводка: 0 чтений,
  // drop 100% — и ни одного числа о том, что именно развалилось. Диагностика
  // обязана уезжать в буфер вместе с гейтом, иначе её пересказывают руками.
  const [lastDropText, setLastDropText] = useState<string | null>(null);
  // Сколько раз съёмку отклонили пересъёмкой, а не дропом (не та грань, не
  // кубик, нет решётки).
  //
  // ЧЕСТНОСТЬ. Пересъёмка не попадает ни в числитель, ни в знаменатель гейта —
  // и это ровно тот механизм, которым замер можно незаметно улучшить: если
  // зрение стабильно путает центр красной грани с оранжевым, отказ «покажи
  // нужную грань» будет молча выбрасывать неудобные съёмки, а точность полезет
  // вверх. Поэтому счётчик печатается в отчёте: одна-две пересъёмки за прогон —
  // человек ошибся гранью, двадцать — врёт зрение, и цифре гейта верить нельзя.
  const retakesRef = useRef<Map<string, number>>(new Map());
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

  /**
   * Забраковать чтение: показать причину, запомнить её для отчёта, записать дроп.
   *
   * Один путь на все причины — иначе следующая ветка отказа снова забудет
   * положить текст в отчёт, как забыли все шесть предыдущих. `grids` передаётся
   * там, где чтение дошло до 54 ячеек: тогда к причине прикладывается сама
   * грань, а не только вывод о ней.
   */
  const dropRead = (
    text: string,
    reason: DropReason,
    capture?: {
      grids: readonly (readonly string[])[];
      diags: readonly CellDiag[];
      fits: readonly FaceFitDiag[];
    },
  ): void => {
    const full = capture
      ? `${text}\n${formatRawGrids(capture.grids, capture.diags, capture.fits)}`
      : text;
    setCaptureError(full);
    setLastDropText(full);
    appendDrop(runRef.current, conditionRef.current, reason);
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
      // Порядок граней требуется только строгой хваткой — она на нём и стоит.
      reader.beginAccuracy(grip === "fixed");
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
        // «Не кубик» и «нет решётки» лечатся одинаково — пересъёмкой ОДНОЙ
        // грани, поэтому и обходятся одинаково: остальные снятые грани целы,
        // дроп не пишется. Отличаются они только текстом причины, и он приходит
        // готовым из пайплайна.
        // «Показана не та грань» — дроп со своей причиной, а не пересъёмка:
        // проверка не отличает человеческую ошибку от промаха зрения по центру,
        // см. `DropReason` в accuracyRun.ts. Остальные два отказа смотрят на
        // структуру кадра, а не на цвет, и потому пересъёмку заслуживают.
        if (r.reason === "wrong-face") {
          dropRead(r.diag ?? faceUnreadableRu(), "wrong-face");
          reader.resetAccuracy();
          bump();
          return;
        }
        if (r.reason === "not-a-face" || r.reason === "no-lattice") {
          retakesRef.current.set(r.reason, (retakesRef.current.get(r.reason) ?? 0) + 1);
          setCaptureError(r.diag ?? faceUnreadableRu());
          bump();
          return;
        }
        // Отказ, который сам себя объясняет, печатается ОДИН. Общая присказка
        // «повтори грань, держи её в жёлтой рамке» поверх «сними чтение заново»
        // — прямое противоречие в одном абзаце, и человек делает то, что
        // прочитал первым.
        dropRead(
          r.reason === "no-lattice-late" && r.diag
            ? r.diag
            : r.diag
              ? `${faceUnreadableRu()} (${r.diag})`
              : faceUnreadableRu(),
          "unreadable",
        );
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
          dropRead(
            "Кубик прочитан как СОБРАННЫЙ, а эталон — скрамбл. Похоже, скрамбл не собран на кубике: собери его по шагам слева (белый центр вверх, зелёный центр к себе) и сними чтение заново.",
            "mis-scramble",
            { grids: r.rawFaceGrids, diags: r.cellDiags, fits: r.fitDiags },
          );
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
        if (grip === "free" || grip === "picture") {
          // Выравнивание — из раскладки шести съёмок по шести цветам (сырые
          // центры), а не из одиночного argmin по центру: тот на тёплом свете
          // выдаёт один цвет дважды и топит чтение, в котором зрение не виновато.
          // Раскладка отказала — так и говорим, с её собственной причиной.
          if (!r.rawCenterFaces) {
            const offenders =
              r.rawCenterOffenders ?? (r.rawCenterOffender ? [r.rawCenterOffender] : []);
            const spread = r.rawCenterSpread;
            const head = offenders.length
              ? centerAssignFailedRu(
                  offenders,
                  spread?.medianDE ?? 0,
                  config.CENTER_MAX_DELTA_E,
                  config.CENTER_OUTLIER_DE,
                )
              : `Грани не опознаны по центрам: ${r.rawCenterReason ?? "раскладка не сошлась"}.`;
            dropRead(
              [
                head,
                spread
                  ? centerSpreadRu(
                      spread.faces,
                      spread.des,
                      spread.medianDE,
                      spread.own,
                      spread.ownDes,
                      spread.rgb,
                    )
                  : null,
                r.fitDiags.length ? fitSpreadRu(r.fitDiags) : null,
              ]
                .filter(Boolean)
                .join(" "),
              "assign",
              { grids: r.rawFaceGrids, diags: r.cellDiags, fits: r.fitDiags },
            );
            bump();
            return;
          }
          if (grip === "picture") {
            // Счёт по картинке: позиции сравниваются, поворот грани выведен из
            // физики кубика. Неопределённый физикой поворот — честный дроп со
            // своей причиной, а НЕ подбор поворота под ответ.
            const pic = scorePictureGrip(r.rawFaceGrids, truth, r.rawCenterFaces);
            if (pic.kind === "assign-conflict") {
              dropRead(`Грани не опознаны по центрам: ${pic.reason}.`, "assign", {
                grids: r.rawFaceGrids,
                diags: r.cellDiags,
                fits: r.fitDiags,
              });
              bump();
              return;
            }
            if (pic.kind === "rotation-ambiguous") {
              dropRead(
                `Поворот граней не определился по физике кубика (${pic.reason}). ` +
                  "Чтение не засчитано: подбирать поворот под ответ протокол запрещает. Переснимай грани.",
                "ambiguous",
                { grids: r.rawFaceGrids, diags: r.cellDiags, fits: r.fitDiags },
              );
              bump();
              return;
            }
            const picProduct = scorePictureGrip(r.productFaceGrids, truth, r.rawCenterFaces);
            appendRead(runRef.current, conditionRef.current, pic.report);
            lastReadKeyRef.current = conditionRef.current;
            setLastReport(pic.report);
            setLastProductReport(picProduct.kind === "ok" ? picProduct.report : null);
            setLastDiags(r.cellDiags);
            setLastFits(r.fitDiags);
            setCaptureError(r.drifted ? `Чтение готово${driftNote(r.drifted)}` : null);
            bump();
            return;
          }
          const free = scoreFreeGrip(r.rawFaceGrids, truth, undefined, r.rawCenterFaces);
          if (free.kind === "assign-conflict") {
            dropRead(`Грани не опознаны по центрам: ${free.reason}.`, "assign", {
              grids: r.rawFaceGrids,
              diags: r.cellDiags,
              fits: r.fitDiags,
            });
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
          dropRead(
            `Цвета прочитаны верно (${54 - lenient.mismatches}/54 с точностью до поворота), но кубик был показан в другой ориентации, ` +
              "поэтому чтение не засчитано. Держи белый центр вверху и зелёный к себе, грани показывай по подсказкам, не переворачивая кубик между шагами.",
            "orientation",
            { grids: r.rawFaceGrids, diags: r.cellDiags, fits: r.fitDiags },
          );
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
    retakesRef.current = new Map();
    lastReadKeyRef.current = null;
    setLastDropText(null);
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
    // Брак печатается ПЕРЕД сводкой: в прогоне, где всё ушло в дроп, сводка —
    // это шесть нулей, и без причины над ними отчёт бесполезен.
    if (lastDropText) {
      parts.push("=== Последний брак (дроп) ===");
      parts.push(lastDropText);
      parts.push("");
    }
    parts.push("=== Сводка прогона ===");
    if (retakesRef.current.size > 0) {
      const names: Record<string, string> = {
        "wrong-face": "показана не та грань",
        "not-a-face": "в рамке не кубик",
        "no-lattice": "нет решётки",
      };
      const list = [...retakesRef.current.entries()]
        .map(([k, n]) => `${names[k] ?? k}: ${n}`)
        .join(", ");
      parts.push(
        `Пересъёмок (в гейт не идут — ни в числитель, ни в знаменатель): ${list}. ` +
          "Много пересъёмок одного вида = замер искажён отказами инструмента, а не измерен.",
      );
    }
    parts.push(formatRunSummary(runRef.current));

    const refs = reader.getProfile();
    if (refs) {
      const sep = minSeparation(refs);
      const anchors = anchorDistances(refs);
      const near = nearestNeighbours(refs);
      const lines = ["", "=== Эталоны калибровки (что камера сняла как цвета) ==="];
      for (const n of COLOR_NAMES) {
        const lab = refs[n];
        const [r, g, b] = lab2rgb(lab);
        lines.push(
          `  ${n}: RGB(${r},${g},${b})  Lab(${lab.map((x) => x.toFixed(0)).join(",")})` +
            `  ΔE до анкора ${anchors[n].toFixed(1)}` +
            `  ближайший сосед ${near[n].name} ${near[n].de.toFixed(1)}`,
        );
      }
      // Порог берётся из конфига, а не пишется числом в текст: подпись «~<20»
      // расходилась с вердиктом (CALIB_MIN_SEPARATION_DE=10) — на 12.7 текст
      // пугал, вердикт пропускал, и человек не знал, какому числу верить.
      lines.push(
        `  min попарный ΔE: ${sep.de.toFixed(1)} (${sep.a}–${sep.b}) ` +
          `(порог вердикта ${config.CALIB_MIN_SEPARATION_DE} — ниже него эталоны слиплись, ` +
          `камера не различает цвета)`,
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
    lastDropText,
    lastProductReport,
    run: runRef.current,
    runVersion,
    resetRun,
    buildExport,
  };
}
