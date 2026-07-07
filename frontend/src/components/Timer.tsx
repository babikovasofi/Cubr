// §3 Timer T1 — STATIC variant only (count-drop / phase machine / confetti are 1.2).
// Rubik 900, tabular-nums, ink digits "0.00"; the phase is shown ONLY by the
// colored decimal dot. Default phase = idle/ready -> warning-colored dot.

type Phase = "ready" | "inspection" | "running" | "success" | "dnf";

const DOT_COLOR: Record<Phase, string> = {
  ready: "bg-warning",
  inspection: "bg-warning",
  running: "bg-faint",
  success: "bg-success",
  dnf: "bg-danger",
};

export default function Timer({
  value = "0.00",
  phase = "ready",
}: {
  value?: string;
  phase?: Phase;
}) {
  return (
    <div className="inline-flex items-baseline gap-1 font-sans text-timer-md text-ink [font-variant-numeric:tabular-nums]">
      <span>{value}</span>
      <span
        aria-hidden
        className={`mb-2 inline-block h-2.5 w-2.5 rounded-full ${DOT_COLOR[phase]}`}
      />
    </div>
  );
}
