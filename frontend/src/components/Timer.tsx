// §3 Timer T1. The phase is shown ONLY by the colored decimal dot; the digits are
// Rubik 900, tabular-nums.
//
// PER-FRAME WRITES (plan #3/#4): while the solve is running the elapsed value must
// update ~60×/s WITHOUT a React re-render. The parent gets a `ref` to the value
// <span> and writes `node.textContent = fmt(nowTs - start)` straight to the DOM
// inside the rVFC loop. React owns only start/stop transitions (the `phase` prop)
// and the final frozen `value`. Size: timer-lg while running, timer-md when idle.

import type { Ref } from "react";

export type Phase = "ready" | "inspection" | "running" | "success" | "dnf";

const DOT_COLOR: Record<Phase, string> = {
  ready: "bg-warning",
  inspection: "bg-warning",
  running: "bg-faint",
  success: "bg-success",
  dnf: "bg-danger",
};

interface TimerProps {
  /** Frozen / initial value. During a running solve the DOM node is written via valueRef. */
  value?: string;
  phase?: Phase;
  /** Ref to the value <span> so the parent can write elapsed per-frame (no setState). */
  valueRef?: Ref<HTMLSpanElement>;
}

export default function Timer({ value = "0.00", phase = "ready", valueRef }: TimerProps) {
  const running = phase === "running";
  const sizeClass = running ? "text-timer-lg" : "text-timer-md";
  return (
    <div
      className={`inline-flex items-baseline gap-1 font-sans ${sizeClass} text-ink [font-variant-numeric:tabular-nums]`}
    >
      <span ref={valueRef}>{value}</span>
      <span
        aria-hidden
        className={`mb-2 inline-block h-2.5 w-2.5 rounded-full ${DOT_COLOR[phase]}`}
      />
    </div>
  );
}
