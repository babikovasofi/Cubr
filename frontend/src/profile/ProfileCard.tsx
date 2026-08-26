// Shared card shell for /profile and /settings panels (plan: profile-settings
// split). One structural primitive repeated for every section — border-2
// ink, surface fill, radius-lg — instead of each section inventing its own
// wrapper. `accent` is a MiniGrid pattern next to the title: the cube-motif
// icon language from design-system.md §4/§8, not a decorative emoji.

import type { ReactNode } from "react";
import MiniGrid from "../components/MiniGrid";

// Nine-cell patterns, restrained per §1 (no more than 1-2 lit cells reads as
// deliberate rather than random). Each section gets its own silhouette so the
// row of cards isn't the same icon six times.
export const CARD_MOTIFS = {
  records: [false, true, false, true, true, true, false, true, false],
  badges: [true, false, true, false, true, false, true, false, true],
  progress: [false, false, true, false, true, false, true, false, false],
  history: [true, true, true, false, false, false, false, false, false],
  friends: [true, false, false, false, true, false, false, false, true],
  matchmaking: [false, false, false, true, true, true, false, false, false],
} as const;

export default function ProfileCard({
  title,
  motif,
  accent = "var(--primary)",
  className = "",
  children,
}: {
  title?: string;
  motif?: readonly boolean[];
  accent?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`flex flex-col gap-4 rounded-lg border-2 border-ink bg-surface p-5 sm:p-6 ${className}`}
    >
      {title ? (
        <div className="flex items-center gap-2.5">
          {motif ? <MiniGrid accent={accent} cells={[...motif]} /> : null}
          <h2 className="font-sans text-h3 text-ink">{title}</h2>
        </div>
      ) : null}
      {children}
    </section>
  );
}
