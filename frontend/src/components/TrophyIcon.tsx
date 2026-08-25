// Значок кубков: аккуратный мультяшный кубок, весь жёлтый (var(--warning)) с
// чёрной обводкой 2px, симметричный относительно центра (x=12). На чаше —
// центрированная грань кубика Рубика 3×3, нарисованная чёрным контуром прямо
// по жёлтому (без белой плашки — «весь жёлтый»). Ручки — простые симметричные
// дуги позади чаши. Единственный 🏆-эквивалент продукта; буквального эмодзи
// в интерфейсе нет.
//
// Вся геометрия построена вокруг оси x=12, поэтому иконка выглядит ровной в
// любом размере (масштабируется целиком, viewBox 24×24).
const G0 = 8.7; // левый край грани
const G = 6.6; // сторона грани
const T = G / 3; // шаг сетки
const GY = 5.2; // верх грани

export default function TrophyIcon({
  className = "",
  size = 24,
}: {
  className?: string;
  /** Сторона иконки в px — вся форма масштабируется вместе (viewBox 24×24). */
  size?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden
      focusable="false"
      className={className}
    >
      {/* Ручки — позади чаши, симметричные дуги. */}
      <path
        d="M6 5.4 C2 5.4 2 11.4 6 11.4"
        fill="none"
        stroke="var(--ink)"
        strokeWidth={2}
        strokeLinecap="round"
      />
      <path
        d="M18 5.4 C22 5.4 22 11.4 18 11.4"
        fill="none"
        stroke="var(--ink)"
        strokeWidth={2}
        strokeLinecap="round"
      />

      {/* Чаша — симметрична относительно x=12, широкий ободок + округлое дно. */}
      <path
        d="M6.5 4 H17.5 A1 1 0 0 1 18.5 5 V8 A6.5 6.5 0 0 1 5.5 8 V5 A1 1 0 0 1 6.5 4 Z"
        fill="var(--warning)"
        stroke="var(--ink)"
        strokeWidth={2}
        strokeLinejoin="round"
      />

      {/* Ножка. */}
      <path
        d="M10.4 14.2 H13.6 L13.1 17 H10.9 Z"
        fill="var(--warning)"
        stroke="var(--ink)"
        strokeWidth={2}
        strokeLinejoin="round"
      />

      {/* Подставка. */}
      <rect
        x={8}
        y={17}
        width={8}
        height={2.6}
        rx={1.3}
        fill="var(--warning)"
        stroke="var(--ink)"
        strokeWidth={2}
      />

      {/* Грань кубика 3×3: контур + сетка, чёрным по жёлтому, ровно по центру чаши. */}
      <g stroke="var(--ink)" strokeLinecap="round">
        <rect
          x={G0}
          y={GY}
          width={G}
          height={G}
          rx={0.8}
          fill="none"
          strokeWidth={1.4}
          strokeLinejoin="round"
        />
        <path
          d={`M${G0 + T} ${GY} v${G} M${G0 + 2 * T} ${GY} v${G} M${G0} ${GY + T} h${G} M${G0} ${GY + 2 * T} h${G}`}
          strokeWidth={1.1}
        />
      </g>
    </svg>
  );
}
