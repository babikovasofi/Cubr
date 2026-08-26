// Presence dot for a friend row (friends-hub plan, Этап A). Design: a small
// square badge built from the design system's own 3×3 mini-grid motif
// (`components/MiniGrid`, §4/§5.8) sits on the corner of a round letter-
// avatar — same primitive as the duel-opponent status row, scaled down,
// instead of a plain colored dot. `success` = online (within the server's
// presence window), `faint` = offline — never a red/green traffic-light
// pairing (this app reserves `danger` for destructive actions, §5.3).

import MiniGrid from "../components/MiniGrid";
import { useT } from "../i18n/t";

const BADGE_CELLS = new Array(9).fill(true);

export default function PresenceAvatar({
  displayName,
  online,
  size = 40,
}: {
  displayName: string;
  online: boolean;
  size?: number;
}) {
  const t = useT();
  const letter = displayName.trim().charAt(0).toUpperCase() || "?";

  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <span
        aria-hidden
        className="flex h-full w-full items-center justify-center rounded-full border-2 border-ink bg-surface-2 font-sans text-small font-black text-ink"
      >
        {letter}
      </span>
      <span
        className="absolute -bottom-0.5 -right-0.5 rounded-[3px] border border-ink bg-surface p-px"
        style={{ transform: "scale(0.55)", transformOrigin: "bottom right" }}
      >
        <MiniGrid accent={online ? "var(--success)" : "var(--faint)"} cells={BADGE_CELLS} />
      </span>
      <span className="sr-only">{online ? t("В сети") : t("Не в сети")}</span>
    </span>
  );
}
