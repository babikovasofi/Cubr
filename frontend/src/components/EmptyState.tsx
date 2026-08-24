// Reusable SECTION-level empty state (plan: design-fillers). Replaces the
// three near-duplicate hand-rolled "nothing here yet" blocks that used to
// live in ProfilePage (history, records) and SolveProgressChart.
//
// Deliberately NOT for inline "—" cells (a missing ao5, an unplayed round) —
// those mean "not applicable", not "no data", and stay untouched. This is
// only for a whole section that has nothing to show.
//
// Canon (.memory-bank/tech-details/design-system.md §1/§5.5/§8): quiet by
// default — 1px `line` border, no shadow, no rotation; "пустота тихая". The
// default illustration mirrors §8 illustration 3 ("Пустой список дуэлей" —
// одинокая плитка primary в сетке `line`), not a literal cube-face grid.

import type { ReactNode } from "react";
import { Link } from "react-router-dom";

function DefaultIllustration() {
  // 3×3 §4 pattern-разделитель: 10px cells, gap 2, one lone accent cell — the
  // rest neutral `line`. Center cell carries the accent so it reads as "one
  // thing missing from the middle", not a random pixel.
  const cells = [false, false, false, false, true, false, false, false, false];
  return (
    <span aria-hidden className="grid shrink-0 grid-cols-3 gap-[2px]">
      {cells.map((accent, i) => (
        <span
          key={i}
          className="h-2.5 w-2.5 rounded-[2px]"
          style={{ background: accent ? "var(--primary)" : "var(--line)" }}
        />
      ))}
    </span>
  );
}

export default function EmptyState({
  title,
  description,
  ctaLabel,
  ctaTo,
  illustration,
  className = "",
}: {
  title: string;
  description?: string;
  ctaLabel?: string;
  ctaTo?: string;
  illustration?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-start gap-3 rounded-lg border border-line bg-surface p-6 ${className}`}
    >
      {illustration ?? <DefaultIllustration />}
      <div className="flex flex-col gap-1">
        <p className="font-sans text-body font-bold text-ink">{title}</p>
        {description ? <p className="font-sans text-small text-muted">{description}</p> : null}
      </div>
      {ctaLabel && ctaTo ? (
        <Link to={ctaTo} className="font-sans text-small font-bold text-primary">
          {ctaLabel}
        </Link>
      ) : null}
    </div>
  );
}
