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

// Кисть руки сверху, обрезанная у запястья нижним краем кадра — намеренно
// ПОЛОВИНА руки: в кадр попадают только кисти, не человек целиком (owner:
// «показать именно часть рук»). Без длинного предплечья: запястье уходит за
// нижнюю границу. Нейтральная заливка (var(--line)) + приглушённый контур —
// мягкий силуэт. Правая рука — та же форма, отражённая -scale-x-100.
function HandSilhouette({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 110"
      className={className}
      preserveAspectRatio="xMidYMax meet"
      aria-hidden
      fill="var(--line)"
      stroke="var(--muted)"
      strokeWidth={3}
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      {/* Ладонь + запястье (низ уходит за край кадра — рука видна частично). */}
      <path d="M34 110 V60 q-2 -18 8 -30 q18 -12 36 0 q10 12 8 30 v50 Z" />
      {/* Пальцы (4) — веером вверх. */}
      <path d="M40 44 q-3 -26 4 -34 q6 -5 10 2 q3 22 0 34 Z" />
      <path d="M55 38 q-2 -30 4 -38 q6 -5 10 2 q2 26 0 38 Z" />
      <path d="M70 40 q0 -30 6 -36 q6 -4 9 3 q0 24 -3 36 Z" />
      <path d="M83 48 q4 -22 10 -28 q6 -3 8 4 q-1 20 -8 30 Z" />
      {/* Большой палец — сбоку. */}
      <path d="M33 70 q-20 -6 -26 4 q-4 8 4 12 q16 4 26 -6 Z" />
    </svg>
  );
}

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
      {/* Главная мысль шага — наклон камеры и руки на столе. Вынесено
          акцентным баннером, а не рядовым пунктом: без этого человек ставит
          камеру на себя и не понимает, что не так. */}
      <div className="flex items-start gap-3 rounded-lg border-2 border-ink bg-warning/25 p-4 shadow-sticker">
        <span
          aria-hidden
          className="mt-0.5 h-5 w-5 shrink-0 rounded-[5px] border-2 border-ink bg-warning"
        />
        <p className="font-sans text-body font-bold text-ink">
          {t(
            "Главное: наклони камеру вниз, на стол, и держи обе кисти на столе — в зелёных зонах. Кубик собираешь над столом, в кадре видны только кисти рук.",
          )}
        </p>
      </div>

      <div
        aria-hidden
        className="relative aspect-video w-full overflow-hidden rounded-lg border-2 border-ink bg-surface-2"
      >
        {/* Стол: спокойная горизонтальная граница нижней трети кадра. */}
        <div className="absolute inset-x-0 bottom-0 h-[30%] border-t border-line bg-bg" />

        {/* Кисти рук — вид сверху (камера смотрит на стол): предплечье снизу,
            ладонь и пальцы тянутся вверх к кубику. Силуэт, а не блоб — чтобы
            сразу читалось «в кадре кисти на столе, не человек целиком». */}
        <HandSilhouette className="absolute bottom-0 left-[15%] h-[34%]" />
        <HandSilhouette className="absolute bottom-0 right-[15%] h-[34%] -scale-x-100" />

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
          text={t("Немного наклони камеру вниз, на стол — чтобы в кадр попали стол и кисти рук.")}
        />
        <Callout
          accent="var(--live)"
          text={t("Свет обычный комнатный, без контрового света в камеру.")}
        />
      </ul>
    </div>
  );
}
