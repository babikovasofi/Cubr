// PROTOTYPE — изолированная эвристика «удачный кадр» для демо /proto/green-frame.
// Пур, без DOM и без React: юнит-тестируется напрямую, как vision/fsm.ts.
//
// НЕ используется ни на одном боевом экране. Сигналы для неё уже умеет считать
// vision/hooks/useCubeReader.readFace (read-only, вызывается с refs=null — без
// цветовой калибровки, см. proto/useGoodFrameCamera.ts): она отдаёт fit.gap,
// fit.edge и skin[] даже без эталонов цвета, потому что решётка щелей/границ и
// кожа пальца — структурные признаки, не цветовые.
//
// Почему не переиспользован vision/fsm.ts. Та FSM отвечает на другой вопрос —
// «где сейчас руки относительно зон старта/стопа» — и не знает о грани кубика
// вообще. Здесь предметная область другая («эта грань хорошо легла в рамку»), а
// нужный ПРИЁМ (задержка debounce на каждый переход) — тот же, поэтому логика
// удержания (heldSince/track) сознательно написана в том же стиле.

import { config } from "../vision/config";

/** Сырые сигналы одного кадра — то, что даёт readFace(refs=null) + guideRegionLuma. */
export interface FrameSignal {
  /** Средняя яркость области гайда, 0..255 (vision/hooks/useCubeReader.guideRegionLuma). */
  luma: number;
  /** Контраст щелей на ФИКСИРОВАННОЙ площади гайда (FaceSample.fit.gap). */
  gap: number;
  /** Контраст внутренних границ там же, для stickerless (FaceSample.fit.edge). */
  edge: number;
  /** Максимальная доля «кожи» по 9 ячейкам (FaceSample.skin) — палец на грани. */
  skinMax: number;
}

export type BadReason = "dark" | "bright" | "finger" | "no-lattice";

export interface FrameVerdict {
  ok: boolean;
  reason: BadReason | null;
}

export interface GoodFrameThresholds {
  /** Яркость гайда должна лежать в [lumaMin, lumaMax] — те же ворота, что и в продукте. */
  lumaMin: number;
  lumaMax: number;
  /**
   * «Есть решётка» на ФИКСИРОВАННОЙ площади гайда: щели ИЛИ границы дают
   * заметный контраст. Порог не абсолютный «в вакууме», а часть демо-эвристики
   * (в продукте latticeVerdict сравнивает с соседними гранями ТОГО ЖЕ чтения,
   * здесь сравнивать не с чем — одна съёмка, поэтому берём долю от
   * FACE_FIT_GAP_TARGET/EDGE_TARGET). ЛИБО gap, ЛИБО edge — как и в продукте
   * (latticeVerdict), это разные признаки для стикерного и stickerless кубика.
   */
  gapMin: number;
  edgeMin: number;
  /** Доля кожи в самой закрытой ячейке — выше значит палец лежит на грани. */
  skinMax: number;
  /** Сколько мс подряд кадр должен быть «ok», чтобы уверенность дошла до 1. */
  holdMs: number;
  /** За сколько мс уверенность падает с 1 до 0 после того, как кадр стал «не ok». */
  decayMs: number;
}

/**
 * Дефолты. gapMin/edgeMin — треть от продуктовых FACE_FIT_GAP_TARGET/EDGE_TARGET:
 * те калиброваны как «штраф ниже этого = решётки нет вовсе», подгонка сетки при
 * этом уже перепробовала ~70 положений и взяла лучшее. Здесь кандидат один
 * (ровно геометрия гайда, без перебора), поэтому требовать полный target —
 * значит требовать точного попадания рамка-в-рамку, которого от живой руки не
 * бывает. Треть — сознательно мягкий порог для прототипа, а не число из замера;
 * см. README демо-страницы про то, что осталось на потом.
 */
export function defaultThresholds(): GoodFrameThresholds {
  return {
    lumaMin: config.MIN_FRAME_LUMA,
    lumaMax: config.MAX_FRAME_LUMA,
    gapMin: config.FACE_FIT_GAP_TARGET / 3,
    edgeMin: config.FACE_FIT_EDGE_TARGET / 3,
    skinMax: config.CELL_SKIN_FRAC_MAX,
    holdMs: 450,
    decayMs: 350,
  };
}

/** Один кадр -> вердикт. Порядок проверок — от «нечего смотреть» к «спорный кадр». */
export function classifyFrame(
  signal: FrameSignal,
  cfg: GoodFrameThresholds = defaultThresholds(),
): FrameVerdict {
  if (signal.luma < cfg.lumaMin) return { ok: false, reason: "dark" };
  if (signal.luma > cfg.lumaMax) return { ok: false, reason: "bright" };
  if (signal.skinMax > cfg.skinMax) return { ok: false, reason: "finger" };
  if (signal.gap < cfg.gapMin && signal.edge < cfg.edgeMin) return { ok: false, reason: "no-lattice" };
  return { ok: true, reason: null };
}

export type FrameStatus = "seeking" | "aligning" | "good";

export interface FrameQuality {
  /** 0..1, плавно — драйвит цвет рамки (жёлтый→зелёный) и её толщину. */
  confidence: number;
  status: FrameStatus;
  reason: BadReason | null;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * Гистерезис/дебаунс поверх classifyFrame — то, ради чего эвристика вообще
 * существует как отдельный модуль, а не один if в компоненте.
 *
 * Приём — как в паре найденных на ресёрче практик (KYC/скан-SDK): не мигать
 * состоянием на каждом кадре, а (а) требовать HOLD_MS подряд хороших кадров,
 * прежде чем сказать «готово», и (б) не обнулять уверенность на первом же
 * плохом кадре, а гасить её плавно за DECAY_MS — одиночный шум (блик,
 * мгновенная дрожь руки) не должен дёргать рамку туда-обратно.
 */
export class GoodFrameTracker {
  private heldSince: number | null = null;
  private lastConfidence = 0;
  private lastT: number | null = null;

  constructor(private cfg: GoodFrameThresholds = defaultThresholds()) {}

  reset(): void {
    this.heldSince = null;
    this.lastConfidence = 0;
    this.lastT = null;
  }

  /** Подать один кадр (t — общий монотонный домен, как performance.now()). */
  push(verdict: FrameVerdict, t: number): FrameQuality {
    let confidence: number;
    if (verdict.ok) {
      if (this.heldSince === null) this.heldSince = t;
      const heldMs = t - this.heldSince;
      confidence = this.cfg.holdMs > 0 ? clamp01(heldMs / this.cfg.holdMs) : 1;
    } else {
      this.heldSince = null;
      const dt = this.lastT === null ? 0 : Math.max(0, t - this.lastT);
      const decay = this.cfg.decayMs > 0 ? dt / this.cfg.decayMs : 1;
      confidence = clamp01(this.lastConfidence - decay);
    }
    this.lastConfidence = confidence;
    this.lastT = t;

    const status: FrameStatus = confidence >= 1 ? "good" : confidence > 0 ? "aligning" : "seeking";
    return { confidence, status, reason: verdict.reason };
  }
}
