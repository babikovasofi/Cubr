// Badge grid (plan: achievements-badges). Presentational — fetches its own
// data via GET /badges and renders earned vs. locked badges. Mirrors
// ProfilePage's History section for loading/error/retry conventions so the
// profile page reads as one system.

import { useEffect, useState } from "react";
import Button from "./Button";
import Spinner from "./Spinner";
import MiniGrid from "./MiniGrid";
import { getBadges, type BadgeRead } from "../api/badges";
import { ApiError } from "../api/client";
import { useT } from "../i18n/t";

// Badge icons use the app's OWN cube-motif language (the 3×3 mini-grid from
// §4, same as the mode cards) instead of OS emoji, which read as cheap and
// off-brand (owner). Each badge gets a stable motif + accent derived from its
// `code`, so it's consistent across sessions and new badges get an icon for
// free — no per-badge art to maintain, no emoji.
const BADGE_ACCENTS = [
  "var(--success)",
  "var(--warning)",
  "var(--primary)",
  "var(--live)",
  "var(--danger)",
];
const O = false;
const X = true;
const BADGE_PATTERNS: boolean[][] = [
  [X, O, X, O, X, O, X, O, X],
  [O, X, O, X, X, X, O, X, O],
  [X, X, X, O, X, O, O, O, O],
  [O, O, X, O, X, O, X, O, O],
  [X, O, O, O, X, O, O, O, X],
  [O, X, O, X, O, X, O, X, O],
  [X, X, O, X, O, O, O, O, X],
  [O, X, X, O, X, O, X, X, O],
];
function hashCode(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return Math.abs(h);
}
function badgeMotif(code: string): { accent: string; cells: boolean[] } {
  const h = hashCode(code);
  return {
    cells: BADGE_PATTERNS[h % BADGE_PATTERNS.length],
    accent: BADGE_ACCENTS[(h >> 3) % BADGE_ACCENTS.length],
  };
}

function fmtEarnedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("ru-RU", { dateStyle: "medium" });
}

type BadgeGridState =
  { kind: "loading" } | { kind: "error"; message: string } | { kind: "ok"; badges: BadgeRead[] };

export default function BadgeGrid() {
  const t = useT();
  const [state, setState] = useState<BadgeGridState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    getBadges()
      .then((badges) => alive && setState({ kind: "ok", badges }))
      .catch((e) => {
        if (!alive) return;
        setState({
          kind: "error",
          message: e instanceof ApiError ? e.message : t("Не удалось загрузить бейджи."),
        });
      });
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-sans text-h3 text-ink">{t("Бейджи")}</h2>

      {state.kind === "loading" ? <Spinner label={t("Загружаю бейджи…")} /> : null}

      {state.kind === "error" ? (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p className="font-sans text-small text-danger">{state.message}</p>
          <Button onClick={() => setReloadKey((k) => k + 1)}>{t("Повторить")}</Button>
        </div>
      ) : null}

      {state.kind === "ok" ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label={t("Бейджи")}>
          {state.badges.map((b) => (
            <div
              key={b.code}
              className={`flex flex-col gap-2 rounded-lg border-2 border-ink bg-surface p-4 ${
                b.earned ? "" : "opacity-40"
              }`}
            >
              <div className="flex items-center gap-3">
                <span aria-hidden className="shrink-0">
                  <MiniGrid {...badgeMotif(b.code)} />
                </span>
                <span className="min-w-0 break-words font-sans text-body font-bold text-ink">
                  {b.title}
                </span>
              </div>
              <p className="break-words font-sans text-small text-muted">{b.description}</p>
              {b.earned && b.earned_at ? (
                <span className="font-sans text-caption uppercase text-muted">
                  Получен {fmtEarnedAt(b.earned_at)}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
