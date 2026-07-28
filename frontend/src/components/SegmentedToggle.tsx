// Переключатель на 2–3 варианта в языке продукта (§5: обводка `ink`, скругление
// «таблетка», активный сегмент — заливка `primary`). Ставится вместо системного
// <select>: тот рисуется движком браузера и выпадает из стиля сайта.
//
// Доступность: это радиогруппа, а не набор кнопок — стрелки и скринридер
// работают как ожидается, потому что под капотом честные <input type="radio">.

import { useId } from "react";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export default function SegmentedToggle<T extends string>({
  value,
  options,
  onChange,
  label,
  className = "",
}: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (next: T) => void;
  /** Подпись группы для скринридера (визуально может быть рядом). */
  label: string;
  className?: string;
}) {
  const name = useId();

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`inline-flex items-center gap-0.5 rounded-full border-2 border-ink bg-surface p-0.5 ${className}`}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <label
            key={o.value}
            className={[
              "cursor-pointer select-none rounded-full px-3 py-1 font-sans text-small font-extrabold transition-colors",
              active ? "bg-primary text-white" : "text-muted hover:text-ink",
            ].join(" ")}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={active}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            {o.label}
          </label>
        );
      })}
    </div>
  );
}
