import { useId } from "react";
// Значок кубков: аккуратный мультяшный кубок, весь жёлтый (var(--warning)) с
// чёрной обводкой, симметричный относительно оси x=12. На чаше — центрированная
// грань кубика Рубика 3×3 чёрным контуром. Для объёма добавлены блик (светлый)
// и мягкая тень внизу чаши — оба обрезаны формой чаши (clipPath), поэтому не
// выходят за контур. Единственный 🏆-эквивалент продукта; эмодзи в интерфейсе нет.
//
// Вся геометрия вокруг оси x=12 — иконка ровная в любом размере (viewBox 24×24).
const G0 = 8.7; // левый край грани
const G = 6.6; // сторона грани
const T = G / 3; // шаг сетки
const GY = 5.2; // верх грани

const BOWL = "M6.5 4 H17.5 A1 1 0 0 1 18.5 5 V8 A6.5 6.5 0 0 1 5.5 8 V5 A1 1 0 0 1 6.5 4 Z";

export default function TrophyIcon({
  className = "",
  size = 24,
}: {
  className?: string;
  /** Сторона иконки в px — вся форма масштабируется вместе (viewBox 24×24). */
  size?: number;
}) {
  // Уникальный id клипа на инстанс — иначе несколько иконок на странице делят
  // один <clipPath>, и он ломается при удалении первой из DOM.
  const clip = `cup-bowl-${useId()}`;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden
      focusable="false"
      className={className}
    >
      <defs>
        <clipPath id={clip}>
          <path d={BOWL} />
        </clipPath>
      </defs>

      {/* Ручки — позади чаши, симметричные дуги. */}
      <path
        d="M6 5.4 C1.9 5.4 1.9 11.5 6 11.5"
        fill="none"
        stroke="var(--ink)"
        strokeWidth={2.2}
        strokeLinecap="round"
      />
      <path
        d="M18 5.4 C22.1 5.4 22.1 11.5 18 11.5"
        fill="none"
        stroke="var(--ink)"
        strokeWidth={2.2}
        strokeLinecap="round"
      />

      {/* Чаша — заливка. */}
      <path d={BOWL} fill="var(--warning)" />

      {/* Объём внутри чаши: мягкая тень снизу + блик сверху-слева (обрезаны чашей). */}
      <g clipPath={`url(#${clip})`}>
        <ellipse cx={12} cy={12.6} rx={6.6} ry={3} fill="var(--ink)" opacity={0.12} />
        <ellipse
          cx={7.3}
          cy={6.9}
          rx={1.3}
          ry={2.5}
          fill="#ffffff"
          opacity={0.5}
          transform="rotate(-18 7.3 6.9)"
        />
      </g>

      {/* Контур чаши поверх заливки/бликов — чёткая обводка. */}
      <path d={BOWL} fill="none" stroke="var(--ink)" strokeWidth={2} strokeLinejoin="round" />

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

      {/* Грань кубика 3×3: контур + сетка, чёрным по жёлтому, по центру чаши. */}
      <g stroke="var(--ink)" strokeLinecap="round">
        <rect
          x={G0}
          y={GY}
          width={G}
          height={G}
          rx={0.9}
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
