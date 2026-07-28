// De-ranked weekly participation board (plan: tournament-leaderboard, decision B1).
// Presentational only — all fetching lives in useTournamentStandings. Renders rows
// in the order the API returns them (submitted_at ASC); NEVER computes or shows a
// rank/position number — that is the point of "participation, not ranking".
//
// Privacy (П10): every row is built from `display_name` alone (already "Аноним"
// substituted server-side for an unset public_handle). This component never
// receives, and must never render, email or the account nickname.

import Button from "../components/Button";
import Spinner from "../components/Spinner";
import { useSettingsStore } from "../store/settingsStore";
import { formatSolveMs } from "../lib/formatTime";
import type { StandingEntry, TournamentStandingsRead } from "../api/tournament";

import { useT } from "../i18n/t";
export interface TournamentStandingsProps {
  data: TournamentStandingsRead | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

function Row({ entry }: { entry: StandingEntry }) {
  const t = useT();
  const timeFormat = useSettingsStore((s) => s.timeFormat);
  return (
    <div
      className={[
        "flex items-center justify-between gap-3 rounded-md px-3.5 py-2.5",
        entry.is_self ? "border-2 border-primary bg-surface" : "border border-line bg-surface",
      ].join(" ")}
    >
      <span
        className={["font-sans text-small text-ink", entry.is_self ? "font-bold" : ""].join(" ")}
      >
        {entry.display_name}
        {entry.is_self ? (
          <span className="ml-2 text-caption uppercase text-primary">{t("ты")}</span>
        ) : null}
      </span>
      <span className="font-sans text-small text-ink [font-variant-numeric:tabular-nums]">
        {formatSolveMs(entry.time_ms, timeFormat)}
      </span>
    </div>
  );
}

export default function TournamentStandings({
  data,
  loading,
  error,
  reload,
}: TournamentStandingsProps) {
  const t = useT();
  return (
    <section className="flex flex-col gap-4 rounded-lg border-2 border-ink bg-surface p-7">
      <div className="flex flex-col gap-1">
        <span className="font-sans text-overline uppercase text-muted">
          Челлендж недели{data ? ` · ${data.week_label}` : ""}
        </span>
        <h3 className="font-sans text-h3 text-ink">{t("Кто уже собрал")}</h3>
      </div>

      <p className="max-w-prose font-sans text-small text-muted">
        {t("Время участники засекают сами — дружеский зачёт, не рейтинг.")}
      </p>

      {loading ? <Spinner label={t("Загружаю таблицу…")} /> : null}

      {error ? (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p className="font-sans text-small text-danger">{error}</p>
          <Button onClick={reload} variant="secondary">
            {t("Повторить")}
          </Button>
        </div>
      ) : null}

      {!loading && !error && data ? (
        <>
          {data.entries.length === 0 ? (
            <p className="font-sans text-body text-muted">{t("Пока никто не закончил")}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {/* No stable id on the wire (locked contract, П10/de-ranked — see
                  api/tournament.ts StandingEntry): the whole list is replaced
                  atomically on each fetch, never reordered item-by-item client
                  side, so an index key is safe here. */}
              {data.entries.map((entry, i) => (
                <Row key={i} entry={entry} />
              ))}
            </div>
          )}

          {data.dnf_count > 0 ? (
            <p className="font-sans text-small text-muted">
              {data.dnf_count} {dnfWord(data.dnf_count)} не финишировали
            </p>
          ) : null}

          {data.your_entry ? (
            <div className="flex flex-col gap-2 border-t border-line pt-4">
              <span className="font-sans text-overline uppercase text-muted">
                {t("Твоё место")}
              </span>
              <Row entry={data.your_entry} />
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function dnfWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "участник";
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return "участника";
  return "участников";
}
