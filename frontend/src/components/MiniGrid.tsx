// Мини-сетка-индикатор §4: 3×3 квадратов 8×8px, gap 2, radius 2. Пустые ячейки —
// `line`, активные — цвет акцента. Это штатный «иконочный» язык дизайн-системы:
// цвет живёт в мелких деталях, а не в заливках панелей (§1, правило 90/8/2).

export default function MiniGrid({
  accent,
  cells,
  className = "",
}: {
  /** CSS-цвет активных ячеек — токен вида `var(--warning)`. */
  accent: string;
  /** 9 флагов, по строкам сверху вниз. */
  cells: boolean[];
  className?: string;
}) {
  return (
    <span
      aria-hidden
      data-testid="mini-grid"
      className={`grid shrink-0 grid-cols-3 gap-[2px] ${className}`}
    >
      {cells.map((on, i) => (
        <span
          key={i}
          className="h-2 w-2 rounded-[2px]"
          style={{ background: on ? accent : "var(--line)" }}
        />
      ))}
    </span>
  );
}
