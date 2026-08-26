// Pure-frontend solve-time progress chart for ProfilePage. Fed by History's
// existing listSolves(50,0) window — no fetch here, no new endpoint.
//
// Y = time_ms, inverted so a faster solve sits higher in the chart (smaller
// SVG y). X = evenly-spaced chronological index across the FULL sorted
// window (valid + non-valid), so a DNF/rejected solve occupies its real slot
// and the line visibly breaks around it instead of skipping over it.
//
// Y-domain is outlier-robust: the slow (worst) edge of the domain is capped
// at min(maxValid, p95(valid) * 1.1) so one huge fumble can't stretch the
// domain and squash every normal solve into a sliver near the fast edge. A
// valid solve slower than that cap is "pinned" — its rendered y is clamped
// to the domain's slow edge (the bottom of the plot, since faster is up) and
// drawn with a distinct marker + a <title> carrying its real time.

import type { SolveRead } from "../api/solves";
import { useSettingsStore } from "../store/settingsStore";
import { formatSolveMs, type TimeFormat } from "../lib/formatTime";
import EmptyState from "./EmptyState";
import { useT } from "../i18n/t";

export interface ChartValidPoint {
  id: string;
  index: number;
  x: number;
  y: number;
  timeMs: number;
  createdAt: string;
  isPB: boolean;
  pinned: boolean;
  title: string;
}

export interface ChartDnfMarker {
  id: string;
  index: number;
  x: number;
  createdAt: string;
  title: string;
}

export interface ChartModel {
  kind: "empty" | "ready";
  validPoints: ChartValidPoint[];
  segments: ChartValidPoint[][];
  dnfMarkers: ChartDnfMarker[];
  pb: ChartValidPoint | null;
  domain: { min: number; max: number };
  firstDate: string | null;
  lastDate: string | null;
}

const VIEW_W = 320;
const VIEW_H = 160;
const PAD = { top: 14, right: 12, bottom: 22, left: 40 };
const PLOT_W = VIEW_W - PAD.left - PAD.right;
const PLOT_H = VIEW_H - PAD.top - PAD.bottom;

function fmtMs(ms: number, format: TimeFormat): string {
  return formatSolveMs(ms, format);
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" });
}

function fmtAxisDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

function percentile(sortedAsc: number[], p: number): number {
  const len = sortedAsc.length;
  if (len === 0) return 0;
  if (len === 1) return sortedAsc[0];
  const idx = (p / 100) * (len - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}

function emptyModel(): ChartModel {
  return {
    kind: "empty",
    validPoints: [],
    segments: [],
    dnfMarkers: [],
    pb: null,
    domain: { min: 0, max: 0 },
    firstDate: null,
    lastDate: null,
  };
}

/** NaN-safe: unparseable created_at falls back to comparing original input index (never throws). */
function compareSolves(a: { s: SolveRead; i: number }, b: { s: SolveRead; i: number }): number {
  const ta = new Date(a.s.created_at).getTime();
  const tb = new Date(b.s.created_at).getTime();
  const aValid = !Number.isNaN(ta);
  const bValid = !Number.isNaN(tb);
  if (aValid && bValid) return ta - tb;
  return a.i - b.i;
}

export function buildChartModel(solves: SolveRead[], format: TimeFormat = "clock"): ChartModel {
  if (solves.length === 0) return emptyModel();

  const indexed = solves.map((s, i) => ({ s, i }));
  indexed.sort(compareSolves);
  const sorted = indexed.map((e) => e.s);
  const n = sorted.length;

  const validEntries = sorted
    .map((s, index) => ({ s, index }))
    .filter((e) => e.s.status === "valid");

  if (validEntries.length === 0) return emptyModel();

  const validTimesAsc = validEntries.map((e) => e.s.time_ms).sort((a, b) => a - b);
  const domainMinRaw = validTimesAsc[0];
  const domainMaxRaw = validTimesAsc[validTimesAsc.length - 1];
  const p95 = percentile(validTimesAsc, 95);

  let domainMin = domainMinRaw;
  let domainMax = Math.min(domainMaxRaw, p95 * 1.1);

  if (domainMax - domainMin < 1) {
    // Single point or all-equal times: small symmetric band so the dot sits mid-height.
    const band = Math.max(domainMin * 0.08, 500);
    domainMin = Math.max(0, domainMin - band);
    domainMax = domainMax + band;
  }

  const xFor = (index: number) =>
    n <= 1 ? PAD.left + PLOT_W / 2 : PAD.left + (index / (n - 1)) * PLOT_W;
  const yFor = (timeMs: number) => {
    const clamped = Math.min(timeMs, domainMax);
    const t = (clamped - domainMin) / (domainMax - domainMin);
    return PAD.top + t * PLOT_H;
  };

  let pbAssigned = false;
  const validPoints: ChartValidPoint[] = validEntries.map(({ s, index }) => {
    const isPB = !pbAssigned && s.time_ms === domainMinRaw;
    if (isPB) pbAssigned = true;
    return {
      id: s.id,
      index,
      x: xFor(index),
      y: yFor(s.time_ms),
      timeMs: s.time_ms,
      createdAt: s.created_at,
      isPB,
      pinned: s.time_ms > domainMax,
      title: `${fmtMs(s.time_ms, format)} · ${fmtDate(s.created_at)}`,
    };
  });

  const pb = validPoints.find((p) => p.isPB) ?? null;

  const validIndexSet = new Set(validEntries.map((e) => e.index));
  const segments: ChartValidPoint[][] = [];
  let current: ChartValidPoint[] = [];
  let vp = 0;
  for (let idx = 0; idx < n; idx++) {
    if (validIndexSet.has(idx)) {
      current.push(validPoints[vp]);
      vp++;
    } else if (current.length > 0) {
      segments.push(current);
      current = [];
    }
  }
  if (current.length > 0) segments.push(current);

  const dnfMarkers: ChartDnfMarker[] = sorted
    .map((s, index) => ({ s, index }))
    .filter((e) => e.s.status !== "valid")
    .map(({ s, index }) => ({
      id: s.id,
      index,
      x: xFor(index),
      createdAt: s.created_at,
      title: "DNF",
    }));

  return {
    kind: "ready",
    validPoints,
    segments,
    dnfMarkers,
    pb,
    domain: { min: domainMin, max: domainMax },
    firstDate: sorted[0]?.created_at ?? null,
    lastDate: sorted[n - 1]?.created_at ?? null,
  };
}

function EmptyCard() {
  const t = useT();
  return (
    <EmptyState
      title={t(
        "Пока недостаточно засчитанных сборок для графика. Собери кубик в соло-режиме — прогресс появится здесь.",
      )}
      ctaLabel={t("К соло-тренировке →")}
      ctaTo="/solo"
    />
  );
}

export default function SolveProgressChart({ solves }: { solves: SolveRead[] }) {
  const t = useT();
  const timeFormat = useSettingsStore((s) => s.timeFormat);
  const model = buildChartModel(solves, timeFormat);

  if (model.kind === "empty") return <EmptyCard />;

  // One solve can't be a "trend" — a lone dot on empty axes reads as noise
  // (owner). Show the time plainly instead; the line chart appears from the
  // second solve on, when there's actually a change to draw.
  if (model.validPoints.length <= 1) {
    const only = model.validPoints[0];
    return (
      <div className="flex flex-col gap-2 rounded-lg border-2 border-ink bg-surface p-5">
        <span className="font-sans text-caption uppercase tracking-wide text-muted">
          {t("Последняя сборка")}
        </span>
        <span className="font-sans text-h1 font-black text-ink [font-variant-numeric:tabular-nums]">
          {fmtMs(only.timeMs, timeFormat)}
        </span>
        <p className="font-sans text-small text-muted">
          {t("Собери ещё пару кубиков — здесь появится график, как меняется время.")}
        </p>
      </div>
    );
  }

  const baselineY = PAD.top + PLOT_H;

  return (
    <div className="rounded-lg border-2 border-ink bg-surface p-4">
      <div className="w-full" style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}` }}>
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="xMidYMid meet"
          className="h-full w-full"
          role="img"
          aria-label={t("График времени сборок за последние сборки")}
        >
          <line
            x1={PAD.left}
            y1={baselineY}
            x2={VIEW_W - PAD.right}
            y2={baselineY}
            stroke="var(--line)"
            strokeWidth={1}
          />

          <text
            x={PAD.left - 6}
            y={PAD.top + 3}
            textAnchor="end"
            fill="var(--muted)"
            className="font-mono [font-variant-numeric:tabular-nums]"
            style={{ fontSize: 8 }}
          >
            {fmtMs(model.domain.min, timeFormat)}
          </text>
          <text
            x={PAD.left - 6}
            y={baselineY}
            textAnchor="end"
            fill="var(--muted)"
            className="font-mono [font-variant-numeric:tabular-nums]"
            style={{ fontSize: 8 }}
          >
            {fmtMs(model.domain.max, timeFormat)}
          </text>

          {model.firstDate ? (
            <text
              x={PAD.left}
              y={VIEW_H - 4}
              textAnchor="start"
              fill="var(--muted)"
              className="font-mono"
              style={{ fontSize: 8 }}
            >
              {fmtAxisDate(model.firstDate)}
            </text>
          ) : null}
          {model.lastDate ? (
            <text
              x={VIEW_W - PAD.right}
              y={VIEW_H - 4}
              textAnchor="end"
              fill="var(--muted)"
              className="font-mono"
              style={{ fontSize: 8 }}
            >
              {fmtAxisDate(model.lastDate)}
            </text>
          ) : null}

          {model.dnfMarkers.map((m) => (
            <line
              key={m.id}
              x1={m.x}
              y1={baselineY - 5}
              x2={m.x}
              y2={baselineY + 5}
              stroke="var(--danger)"
              strokeWidth={2}
              strokeLinecap="round"
            >
              <title>{m.title}</title>
            </line>
          ))}

          {model.segments.map((seg, i) =>
            seg.length >= 2 ? (
              <polyline
                key={`seg-${i}`}
                points={seg.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none"
                stroke="var(--primary)"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null,
          )}

          {model.validPoints.map((p) => {
            if (p.pinned) {
              return (
                <polygon
                  key={p.id}
                  points={`${p.x - 4},${p.y + 6} ${p.x + 4},${p.y + 6} ${p.x},${p.y - 2}`}
                  fill="var(--danger)"
                  stroke="var(--surface)"
                  strokeWidth={1}
                >
                  <title>{p.title}</title>
                </polygon>
              );
            }
            if (p.isPB) {
              return (
                <circle
                  key={p.id}
                  cx={p.x}
                  cy={p.y}
                  r={5}
                  fill="var(--warning)"
                  stroke="var(--ink)"
                  strokeWidth={1.5}
                >
                  <title>{`Личный рекорд: ${fmtMs(p.timeMs, timeFormat)}`}</title>
                </circle>
              );
            }
            return (
              <circle
                key={p.id}
                cx={p.x}
                cy={p.y}
                r={2.5}
                fill="var(--surface)"
                stroke="var(--primary)"
                strokeWidth={1.5}
              >
                <title>{p.title}</title>
              </circle>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
