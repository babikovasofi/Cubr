// Онбординг-шаг «Как поставить камеру и руки» — единственная НЕ-живая
// иллюстрация в онбординге: макет кадра камеры (16:9), а не реальное видео.
// Геометрия рамки кубика и зон рук взята буквально из vision/config.ts
// (GUIDE_RECT) и vision/overlay.ts (defaultZones) — это тот же кадр, что
// потом рисует useCameraCheck поверх настоящего видео, только без движения и
// без запроса доступа к камере на шаге, где человек ещё не готов его давать.
//
// Зеркалирование (см. overlay.ts): реальный <video> зеркалится CSS-ом, и
// «сырая» левая зона показывается на ПРАВОЙ половине экрана и подписана
// «Правая рука» (и наоборот). Макет ничего не зеркалит — он статичен и рисует
// сразу то, что человек увидит на экране: слева — «Левая рука», справа —
// «Правая рука». Так интуитивнее для шага, где ещё нет видео для сверки.

import { useT } from "../i18n/t";

// Доли кадра (0..1) — те же значения, что GUIDE_RECT в vision/config.ts.
const GUIDE = { x: 0.35, y: 0.08, w: 0.3, h: 0.42 };
// Те же значения, что defaultZones() в vision/overlay.ts (симметричные левая/
// правая половины кадра снизу).
const ZONE_LEFT = { x: 0.06, y: 0.71, w: 0.35, h: 0.22 };
const ZONE_RIGHT = { x: 0.59, y: 0.71, w: 0.35, h: 0.22 };

const pct = (n: number) => `${n * 100}%`;

function Callout({ accent, text }: { accent: string; text: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <span
        aria-hidden
        className="mt-1 h-3.5 w-3.5 shrink-0 rounded-[4px] border-2 border-ink"
        style={{ background: accent }}
      />
      <span className="font-sans text-small text-ink">{text}</span>
    </li>
  );
}

export default function CameraGuide() {
  const t = useT();

  return (
    <div className="flex flex-col gap-4">
      <div
        aria-hidden
        className="relative aspect-video w-full overflow-hidden rounded-lg border-2 border-ink bg-surface-2"
      >
        {/* Стол: спокойная горизонтальная граница нижней трети кадра. */}
        <div className="absolute inset-x-0 bottom-0 h-[30%] border-t border-line bg-bg" />

        {/* Предплечья: от нижнего края к каждой зоне рук — подсказывают, что в
            кадр попадают именно кисти на столе, а не человек целиком. */}
        <div
          className="absolute bottom-0 h-[38%] w-[14%] rounded-t-full bg-line"
          style={{ left: "14%", transform: "rotate(-8deg)", transformOrigin: "bottom" }}
        />
        <div
          className="absolute bottom-0 h-[38%] w-[14%] rounded-t-full bg-line"
          style={{ right: "14%", transform: "rotate(8deg)", transformOrigin: "bottom" }}
        />

        {/* Рамка-гид кубика — GUIDE_RECT, верх-центр кадра. */}
        <div
          className="absolute flex items-end justify-center rounded-md border-2 border-dashed border-warning"
          style={{
            left: pct(GUIDE.x),
            top: pct(GUIDE.y),
            width: pct(GUIDE.w),
            height: pct(GUIDE.h),
          }}
        >
          <span className="translate-y-[calc(100%+6px)] whitespace-nowrap rounded-full border-2 border-ink bg-surface px-2.5 py-1 font-sans text-caption font-black text-ink">
            {t("Кубик — сюда, в жёлтую рамку")}
          </span>
        </div>

        {/* Зона левой руки. */}
        <div
          className="absolute flex items-start justify-center rounded-md border-2 border-dashed border-success"
          style={{
            left: pct(ZONE_LEFT.x),
            top: pct(ZONE_LEFT.y),
            width: pct(ZONE_LEFT.w),
            height: pct(ZONE_LEFT.h),
          }}
        >
          <span className="-translate-y-[calc(100%+6px)] whitespace-nowrap rounded-full border-2 border-ink bg-surface px-2.5 py-1 font-sans text-caption font-black text-ink">
            {t("Левая рука")}
          </span>
        </div>

        {/* Зона правой руки. */}
        <div
          className="absolute flex items-start justify-center rounded-md border-2 border-dashed border-success"
          style={{
            left: pct(ZONE_RIGHT.x),
            top: pct(ZONE_RIGHT.y),
            width: pct(ZONE_RIGHT.w),
            height: pct(ZONE_RIGHT.h),
          }}
        >
          <span className="-translate-y-[calc(100%+6px)] whitespace-nowrap rounded-full border-2 border-ink bg-surface px-2.5 py-1 font-sans text-caption font-black text-ink">
            {t("Правая рука")}
          </span>
        </div>
      </div>

      <ul className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4.5">
        <Callout
          accent="var(--warning)"
          text={t("Руки видно только частично — это нормально, в кадр попадают кисти, не целиком.")}
        />
        <Callout
          accent="var(--success)"
          text={t("Видна часть стола — держи руки на столе, обе зоны должны быть в кадре.")}
        />
        <Callout
          accent="var(--primary)"
          text={t("Ставь ноутбук так, чтобы стол и кисти рук были в кадре целиком.")}
        />
        <Callout
          accent="var(--live)"
          text={t("Свет обычный комнатный, без контрового света в камеру.")}
        />
      </ul>
    </div>
  );
}
