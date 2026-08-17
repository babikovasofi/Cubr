// DEV-only accuracy panel: mode toggle, condition tag, calibration, fixed-order
// capture, live per-condition table + min-over-conditions PASS/FAIL, drop counter,
// red↔orange / white↔yellow hotspots, and a clipboard export. Presentational —
// all state + scoring lives in useAccuracySession / accuracyRun.

import { useState } from "react";
import Button from "../components/Button";
import Input from "../components/Input";
import {
  MIN_READS,
  conditionVerdict,
  condKeyString,
  gatePass,
  hotspots,
  runHotspots,
} from "../vision/accuracyRun";
import { CAPTURE_HINTS } from "./captureHints";

export { CAPTURE_HINTS };
import type { AccuracySession } from "./useAccuracySession";

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

interface AccuracyControlsProps {
  session: AccuracySession;
}

export default function AccuracyControls({ session }: AccuracyControlsProps) {
  const [copied, setCopied] = useState(false);
  const gate = gatePass(session.run);
  const totalDrops = gate.conditions.reduce((s, c) => s + c.nDropped, 0);
  const runHs = runHotspots(session.run);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(session.buildExport());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Mode */}
      <section className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4">
        <span className="font-sans text-overline uppercase text-muted">Режим эталона</span>
        <div className="flex gap-2" role="radiogroup" aria-label="Режим эталона">
          {(["scramble", "solved"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={session.mode === m}
              onClick={() => session.setMode(m)}
              className={[
                "h-9 rounded-full border-2 border-ink px-3.5 font-sans text-small font-bold",
                session.mode === m ? "bg-primary text-white" : "bg-surface-2 text-ink",
              ].join(" ")}
            >
              {m === "scramble" ? "Известный скрамбл" : "Собранный (санити)"}
            </button>
          ))}
        </div>
        {session.mode === "scramble" ? (
          <div className="flex flex-col gap-1">
            {session.scrambleLoading ? (
              <p className="font-sans text-small text-muted">Готовлю скрамбл…</p>
            ) : session.scrambleError ? (
              <p role="alert" className="font-sans text-small text-danger">
                Скрамбл не загрузился: {session.scrambleError}
              </p>
            ) : (
              <code className="break-words font-mono text-caption text-ink">
                {session.scramble}
              </code>
            )}
            <button
              type="button"
              onClick={session.regenerateScramble}
              className="self-start font-sans text-small font-bold text-primary underline"
            >
              Новый скрамбл
            </button>
          </div>
        ) : (
          <p className="font-sans text-small text-muted">
            Эталон — собранный кубик (SOLVED). Санити-проверка, адъяцентности не тестит.
          </p>
        )}
      </section>

      {/* Grip */}
      <section className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4">
        <span className="font-sans text-overline uppercase text-muted">Хватка</span>
        <div className="flex gap-2" role="radiogroup" aria-label="Хватка">
          {(["fixed", "free", "picture"] as const).map((g) => (
            <button
              key={g}
              type="button"
              role="radio"
              aria-checked={session.grip === g}
              onClick={() => session.setGrip(g)}
              className={[
                "h-9 rounded-full border-2 border-ink px-3.5 font-sans text-small font-bold",
                session.grip === g ? "bg-primary text-white" : "bg-surface-2 text-ink",
              ].join(" ")}
            >
              {g === "fixed"
                ? "Строгая (ориентация фиксирована)"
                : g === "free"
                  ? "Свободная (мешок цветов)"
                  : "По картинке (верти как удобно)"}
            </button>
          ))}
        </div>
        <p className="font-sans text-small text-muted">
          {session.grip === "fixed"
            ? "Порядок и ориентация заданы протоколом; счёт позиционный по всем 54 наклейкам."
            : session.grip === "free"
              ? "Грань опознаётся по центру, центры из счёта исключены, внутри грани сравниваются цвета без учёта поворота (48 наклеек). Цена: перестановка наклеек ВНУТРИ грани не видна — это ошибка геометрии, её ловит строгая хватка."
              : "Грань опознаётся по центру, кубик держи как удобно. Внутри грани сравниваются ПОЗИЦИИ с точностью до поворота грани (48 наклеек), поэтому перестановка наклеек видна — в отличие от свободной хватки. Поворот выводится из физики кубика, а не из совпадения с ответом; не определился — чтение уходит в дроп."}
        </p>
      </section>

      {/* Condition tag */}
      <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
        <span className="font-sans text-overline uppercase text-muted">Тег условия</span>
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Свет"
            placeholder="день / тёплый ЛН / LED"
            value={session.condition.light}
            onChange={(e) => session.setCondition({ light: e.target.value })}
          />
          <Input
            label="Кубик"
            placeholder="стикерный / stickerless"
            value={session.condition.cube}
            onChange={(e) => session.setCondition({ cube: e.target.value })}
          />
          <Input
            label="Человек"
            placeholder="кто держит"
            value={session.condition.person}
            onChange={(e) => session.setCondition({ person: e.target.value })}
          />
          <Input
            label="Калибровка"
            placeholder="fresh / drift-checked"
            value={session.condition.calib}
            onChange={(e) => session.setCondition({ calib: e.target.value })}
          />
        </div>
      </section>

      {/* Gate */}
      <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
        <div className="flex items-center justify-between">
          <span className="font-sans text-overline uppercase text-muted">
            Гейт 0.3 — min по условиям, Wilson-LB ≥ {pct(gate.passFrac)}
          </span>
          <span
            className={[
              "rounded-full border-2 border-ink px-3 py-0.5 font-sans text-small font-black",
              gate.pass ? "bg-success text-white" : "bg-danger text-white",
            ].join(" ")}
          >
            {gate.conditions.length === 0 ? "НЕТ ДАННЫХ" : gate.pass ? "PASS" : "FAIL"}
          </span>
        </div>

        {gate.conditions.length === 0 ? (
          <p className="font-sans text-small text-muted">
            Пока ни одного условия. Заполни тег и сними чтения (≥{MIN_READS}/условие).
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse font-mono text-caption">
              <thead>
                <tr className="text-left text-muted">
                  <th className="p-1">Условие</th>
                  <th className="p-1">Точность</th>
                  <th className="p-1">Wilson-LB</th>
                  <th className="p-1">n</th>
                  <th className="p-1">drop</th>
                  <th className="p-1">вердикт</th>
                </tr>
              </thead>
              <tbody>
                {gate.conditions.map((c) => {
                  const id = condKeyString(c.key);
                  return (
                    <tr key={id} className="border-t border-line">
                      <td className="p-1 text-ink">
                        {c.key.mode || "?"}/{c.key.grip || "?"}/{c.key.light || "?"}/
                        {c.key.cube || "?"}/{c.key.person || "?"}
                      </td>
                      <td className="p-1 text-ink">{pct(c.fraction)}</td>
                      <td className="p-1 text-ink">{pct(c.wilsonLower)}</td>
                      <td className="p-1 text-ink">
                        {c.nScored}
                        {c.enoughReads ? "" : ` <${MIN_READS}`}
                      </td>
                      <td className="p-1 text-ink">
                        {c.nDropped} ({pct(c.dropRate)})
                      </td>
                      <td
                        className={["p-1 font-bold", c.pass ? "text-success" : "text-danger"].join(
                          " ",
                        )}
                      >
                        {c.pass ? "PASS" : "FAIL"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {gate.min ? (
          <p className="font-sans text-small text-muted">
            Худшее условие: {gate.min.key.mode || "?"}/{gate.min.key.grip || "?"}/
            {gate.min.key.light || "?"}/{gate.min.key.cube || "?"} — Wilson-LB{" "}
            {pct(gate.min.wilsonLower)}. Всего дропов: {totalDrops}.
          </p>
        ) : null}

        {/* Hotspots (run-wide) */}
        <div className="flex flex-col gap-1 rounded border border-line bg-surface-2 p-2">
          <span className="font-sans text-caption font-bold text-muted">
            Hotspots (весь прогон)
          </span>
          <p className="font-mono text-caption text-ink">
            {runHs.redOrange.label}: {runHs.redOrange.total} из N={runHs.redOrange.n} (R→L{" "}
            {runHs.redOrange.aToB}, L→R {runHs.redOrange.bToA})
          </p>
          <p className="font-mono text-caption text-ink">
            {runHs.whiteYellow.label}: {runHs.whiteYellow.total} из N={runHs.whiteYellow.n} (U→D{" "}
            {runHs.whiteYellow.aToB}, D→U {runHs.whiteYellow.bToA})
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={onCopy} disabled={gate.conditions.length === 0 && !session.lastReport}>
            {copied ? "Скопировано ✓" : "Копировать отчёт"}
          </Button>
          <Button onClick={session.resetRun} className="bg-surface-2 text-ink">
            Сбросить прогон
          </Button>
        </div>
      </section>

      {/* Last read */}
      {session.lastReport ? (
        <section className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4">
          <span className="font-sans text-overline uppercase text-muted">Последнее чтение</span>
          <pre className="overflow-x-auto whitespace-pre font-mono text-caption text-ink">
            {reportPreview(session)}
          </pre>
          <Button onClick={session.excludeLast} className="self-start bg-surface-2 text-ink">
            Исключить (не тот скрамбл)
          </Button>
        </section>
      ) : null}
    </div>
  );
}

// A compact preview: fraction + the two hotspot lines for the latest read's
// condition (full detail is in the clipboard export).
function reportPreview(session: AccuracySession): string {
  const rep = session.lastReport;
  if (!rep) return "";
  const lines = [
    `Сырое зрение (гейт): ${rep.correct}/${rep.total} = ${pct(rep.fraction)} → ${rep.pass ? "PASS" : "FAIL"}`,
  ];
  // Вторая строка — то же чтение продуктовым путём. Разрыв между строками и есть
  // вклад нормировки света и квот: видно, чинит ли зрение или подпорки.
  const prod = session.lastProductReport;
  if (prod) {
    lines.push(
      `Как в продукте (свет+квоты): ${prod.correct}/${prod.total} = ${pct(prod.fraction)}`,
    );
  }
  const gate = gatePass(session.run);
  for (const c of gate.conditions) {
    const acc = session.run.get(condKeyString(c.key));
    if (!acc) continue;
    const v = conditionVerdict(acc);
    const hs = hotspots(acc);
    lines.push(
      `  ${c.key.mode}/${c.key.grip}/${c.key.light}/${c.key.cube}: Wilson-LB ${pct(v.wilsonLower)} · ` +
        `R↔L ${hs.redOrange.total}/N${hs.redOrange.n} · U↔D ${hs.whiteYellow.total}/N${hs.whiteYellow.n}`,
    );
  }
  return lines.join("\n");
}
