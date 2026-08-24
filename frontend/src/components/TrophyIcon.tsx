// Кубок контуром вместо эмодзи 🏆: эмодзи тянуло свой цвет и рендерилось
// по-разному в системах. Тут — линия `currentColor` без заливки, значит
// кубок-силуэт берёт цвет текста и одинаково живёт в светлой и тёмной теме.
//
// Owner's brief («Кубок-чаша + кубик»): внутри чаши — маленькая грань кубика
// 3×3 (мотив §4 «мини-сетка-индикатор»). Дозировка по §1: не больше 2 ярких
// цветов кубика на компонент — здесь ровно два акцентных квадратика
// (`--warning`, `--primary`), остальные семь нейтральны (`currentColor` с
// низкой прозрачностью), так что грань читается как деталь, а не заливка.

// Координаты сетки 3×3 внутри чаши (viewBox 24×24, чаша ~ x 7–17, y 3.5–8).
const CELL = 1.5;
const GAP = 0.3;
const START_X = 9.15;
const START_Y = 4.1;

const ACCENTS: Record<number, string> = {
  0: "var(--warning)", // верхний левый — тёплый акцент
  8: "var(--primary)", // нижний правый — фирменный синий
};

const GRID = Array.from({ length: 9 }, (_, i) => {
  const col = i % 3;
  const row = Math.floor(i / 3);
  return {
    x: START_X + col * (CELL + GAP),
    y: START_Y + row * (CELL + GAP),
    fill: ACCENTS[i] ?? "currentColor",
    opacity: ACCENTS[i] ? 1 : 0.22,
  };
});

export default function TrophyIcon({
  className = "",
  size = 24,
}: {
  className?: string;
  /** Сторона иконки в px — кубок и грань масштабируются вместе (viewBox 24×24). */
  size?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className={className}
    >
      <path d="M7 3.5h10V8a5 5 0 0 1-10 0V3.5Z" />
      <path d="M7 5.2H5.1A2.4 2.4 0 0 0 5.1 10H6.2" />
      <path d="M17 5.2h1.9A2.4 2.4 0 0 1 18.9 10H17.8" />
      <path d="M12 13v3" />
      <path d="M9.6 20.5c.8-1 1.2-2.2 1.2-4.5h2.4c0 2.3.4 3.5 1.2 4.5" />
      <path d="M8.2 20.5h7.6" />
      <g strokeWidth={0}>
        {GRID.map((cell, i) => (
          <rect
            key={i}
            x={cell.x}
            y={cell.y}
            width={CELL}
            height={CELL}
            rx={0.3}
            fill={cell.fill}
            opacity={cell.opacity}
          />
        ))}
      </g>
    </svg>
  );
}
