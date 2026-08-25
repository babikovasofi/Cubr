// Фоновый декор «везде понемногу»: очень бледный кубик-мотив (мини-грани 3×3),
// затилен по всему экрану и лежит ПОЗАДИ контента. Держит правило 90/8/2 —
// это нейтральная текстура «бумаги с кубиком», не акцент: прозрачность ~4.5%,
// pointer-events выключены. Цвет — currentColor (ink), поэтому и в светлой, и в
// тёмной теме это мягкие точки в тон текста, без отдельной палитры.
//
// Кладётся первым ребёнком корня приложения (там снят непрозрачный bg-bg —
// фон даёт <body>), поэтому `-z-10` рисует слой перед фоном body, но под
// шапкой и контентом.
export default function DecorBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden text-ink">
      <svg className="h-full w-full" style={{ opacity: 0.045 }}>
        <defs>
          <pattern
            id="cubr-cube-motif"
            width={104}
            height={104}
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(8)"
          >
            {[0, 1, 2].map((r) =>
              [0, 1, 2].map((c) => (
                <rect
                  key={`${r}-${c}`}
                  x={40 + c * 9}
                  y={40 + r * 9}
                  width={6.5}
                  height={6.5}
                  rx={1.4}
                  fill="currentColor"
                />
              )),
            )}
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#cubr-cube-motif)" />
      </svg>
    </div>
  );
}
