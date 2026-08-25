// Значок кубков: чанковый мультяшный кубок, весь залит жёлтым (owner:
// «сделай значок кубков крупнее, полностью ЖЁЛТЫМ, мультяшным»), с чёрной
// обводкой 2px и схематичной гранью кубика Рубика внутри чаши. Заливка —
// var(--warning) у ВСЕЙ формы (чаша, ручки, ножка, подставка) — не только у
// чаши, как раньше. Обводка и грань кубика — var(--ink), поэтому в тёмной
// теме контур остаётся читаемым. Ручки нарисованы «двойным штрихом» (толстая
// чернильная линия снизу + жёлтая поверх), чтобы получить объёмную трубку без
// булевых операций над путями. Единственный 🏆-эквивалент продукта — этот SVG,
// нигде в интерфейсе нет буквального эмодзи-кубка.
export default function TrophyIcon({
  className = "",
  size = 24,
}: {
  className?: string;
  /** Сторона иконки в px — вся форма масштабируется вместе (viewBox 24×24). */
  size?: number;
}) {
  const leftHandle = "M6.6 5.8 A3 3.6 0 0 0 6.6 12.2";
  const rightHandle = "M17.4 5.8 A3 3.6 0 0 1 17.4 12.2";

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden
      focusable="false"
      className={className}
    >
      {/* Ручки — чернильная труба снизу, жёлтая поверх: объёмный мультяшный вид. */}
      <path
        d={leftHandle}
        fill="none"
        stroke="var(--ink)"
        strokeWidth={5.4}
        strokeLinecap="round"
      />
      <path
        d={leftHandle}
        fill="none"
        stroke="var(--warning)"
        strokeWidth={3}
        strokeLinecap="round"
      />
      <path
        d={rightHandle}
        fill="none"
        stroke="var(--ink)"
        strokeWidth={5.4}
        strokeLinecap="round"
      />
      <path
        d={rightHandle}
        fill="none"
        stroke="var(--warning)"
        strokeWidth={3}
        strokeLinecap="round"
      />

      {/* Чаша кубка — скруглённая, вся жёлтая, чёрный контур 2px. */}
      <path
        d="M7.2 3.6h9.6a1 1 0 0 1 1 1v3.3a6.8 6.8 0 0 1-13.6 0V4.6a1 1 0 0 1 1-1Z"
        fill="var(--warning)"
        stroke="var(--ink)"
        strokeWidth={2}
        strokeLinejoin="round"
      />

      {/* Перемычка от чаши к ножке. */}
      <path
        d="M10.7 14.9c-.1 2.1-.5 3.2-1.5 4.4h5.6c-1-1.2-1.4-2.3-1.5-4.4Z"
        fill="var(--warning)"
        stroke="var(--ink)"
        strokeWidth={2}
        strokeLinejoin="round"
      />

      {/* Подставка — скруглённая пилюля. */}
      <rect
        x={7.6}
        y={19}
        width={8.8}
        height={2.6}
        rx={1.3}
        fill="var(--warning)"
        stroke="var(--ink)"
        strokeWidth={2}
      />

      {/* Схематичная грань кубика Рубика на теле чаши: белая плашка, чёрная
          сетка 3×3 — «схематично, чёрным контуром», как и раньше. */}
      <rect
        x={9}
        y={4.6}
        width={6}
        height={6}
        rx={0.8}
        fill="var(--surface)"
        stroke="var(--ink)"
        strokeWidth={1.6}
      />
      <path d="M11 4.6v6M13 4.6v6M9 6.6h6M9 8.6h6" stroke="var(--ink)" strokeWidth={1} />
    </svg>
  );
}
