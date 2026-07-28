// Badge grid (plan: achievements-badges). Presentational — fetches its own
// data via GET /badges and renders earned vs. locked badges. Mirrors
// ProfilePage's History section for loading/error/retry conventions so the
// profile page reads as one system.

import { useEffect, useState } from "react";
import Button from "./Button";
import Spinner from "./Spinner";
import { getBadges, type BadgeRead } from "../api/badges";
import { ApiError } from "../api/client";
import { useT } from "../i18n/t";

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
                <span aria-hidden className="font-sans text-h2 text-ink">
                  {b.icon}
                </span>
                <span className="font-sans text-body font-bold text-ink">{b.title}</span>
              </div>
              <p className="font-sans text-small text-muted">{b.description}</p>
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
