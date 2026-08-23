// Last-layer case trainer (plan: ll-trainer, extended for OLL). Public, no
// auth, no camera — a text scramble, a diagram, and two buttons. §6.2
// lobby-style column (≤720px).
//
// П5: practice writes zero rows anywhere — no import from src/api/, no
// network call at all. Verified by TrainerPage.test.tsx mounting with a
// mocked fetch and asserting 0 calls.

import { useEffect } from "react";
import Button from "../components/Button";
import LastLayerDiagram from "../components/LastLayerDiagram";
import OllDiagram from "../components/OllDiagram";
import SegmentedToggle from "../components/SegmentedToggle";
import { useT } from "../i18n/t";
import { PLL_GROUPS, casesByGroup, type PllCaseId, type PllGroup } from "../trainer/pll";
import {
  OLL_GROUPS,
  ollCasesByGroup,
  getOllCase,
  type OllCaseId,
  type OllGroup,
} from "../trainer/oll";
import {
  getAnyCase,
  isOllId,
  useTrainer,
  type TrainerCaseId,
  type TrainerSet,
} from "../trainer/useTrainer";

const PLL_GROUP_LABEL: Record<PllGroup, string> = {
  "edges-only": "Только рёбра",
  "corners-only": "Только углы",
  "adjacent-swap": "Соседняя пара",
  "diagonal-swap": "По диагонали",
  "g-perm": "G-перестановки",
};

const OLL_GROUP_LABEL: Record<OllGroup, string> = {
  "corners-only": "Только углы",
  "edges-only": "Только рёбра",
  mixed: "Смешанные",
};

type GripMode = "fixed" | "any";

function SetToggle({
  sets,
  onToggle,
}: {
  sets: readonly TrainerSet[];
  onToggle: (s: TrainerSet) => void;
}) {
  const t = useT();
  const options: { set: TrainerSet; label: string }[] = [
    { set: "pll", label: t("PLL (перестановка)") },
    { set: "oll", label: t("OLL (ориентация)") },
  ];
  return (
    <div role="group" aria-label={t("Набор случаев")} className="flex flex-wrap gap-2">
      {options.map(({ set, label }) => {
        const active = sets.includes(set);
        return (
          <button
            key={set}
            type="button"
            aria-pressed={active}
            onClick={() => onToggle(set)}
            className={[
              "inline-flex h-9 items-center rounded-full border-2 border-ink px-3.5 font-sans text-small font-extrabold transition-colors",
              active ? "bg-primary text-white" : "bg-surface text-ink hover:bg-surface-2",
            ].join(" ")}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function GroupChips<G extends string>({
  groups,
  groupLabel,
  onPick,
  onAll,
  allLabel,
}: {
  groups: readonly G[];
  groupLabel: Record<G, string>;
  onPick: (group: G) => void;
  onAll: () => void;
  allLabel: string;
}) {
  const t = useT();
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={onAll}
        className="inline-flex h-8 items-center rounded-full border-2 border-ink bg-surface px-3 font-sans text-small font-bold text-ink"
      >
        {allLabel}
      </button>
      {groups.map((group) => (
        <button
          key={group}
          type="button"
          onClick={() => onPick(group)}
          className="inline-flex h-8 items-center rounded-full border-2 border-ink bg-surface px-3 font-sans text-small font-bold text-ink"
        >
          {t(groupLabel[group])}
        </button>
      ))}
    </div>
  );
}

function CaseCheckboxGroup<Id extends TrainerCaseId>({
  legend,
  ids,
  labelFor,
  selectedIds,
  onToggle,
}: {
  legend: string;
  ids: readonly Id[];
  labelFor: (id: Id) => string;
  selectedIds: readonly TrainerCaseId[];
  onToggle: (id: Id) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-1.5 rounded-md border border-line p-3">
      <legend className="px-1 font-sans text-caption font-bold uppercase text-muted">
        {legend}
      </legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {ids.map((id) => (
          <label
            key={id}
            className="inline-flex cursor-pointer items-center gap-1.5 font-sans text-small text-ink"
          >
            <input
              type="checkbox"
              checked={selectedIds.includes(id)}
              onChange={() => onToggle(id)}
              className="h-4 w-4 accent-primary"
            />
            {labelFor(id)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "BUTTON" || el.tagName === "INPUT" || el.isContentEditable);
}

/** "T" for a PLL case; "27 · Sune" for an OLL case — both self-explanatory
 * without needing to already know whether the current draw is PLL or OLL. */
function caseLabel(id: TrainerCaseId): string {
  if (!isOllId(id)) return id;
  const c = getOllCase(id);
  return `${c.number} · ${c.name}`;
}

export default function TrainerPage() {
  const t = useT();
  const trainer = useTrainer();
  const current = getAnyCase(trainer.caseId);
  const currentIsOll = isOllId(trainer.caseId);

  // Space = next case, Enter = reveal answer — ignored while an interactive
  // element (a checkbox, a chip button) has focus, so the shortcuts don't
  // double-fire a click the user is already making. External sync
  // (keyboard), matches the guard used in solo/ScrambleWalkthrough.tsx.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isInteractiveTarget(e.target)) return;
      if (e.key === " ") {
        e.preventDefault();
        trainer.next();
      } else if (e.key === "Enter") {
        e.preventDefault();
        trainer.reveal();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [trainer]);

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-sans text-h1 text-ink">{t("Тренажёр")}</h1>
        <p className="max-w-prose font-sans text-body text-muted">
          {t(
            "Выбери один или несколько случаев — получишь скрамбл, который гарантированно ставит кубик именно в этот случай. Без сборки, без камеры: собери скрамбл руками и сверься с ответом.",
          )}
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <SetToggle sets={trainer.sets} onToggle={trainer.toggleSet} />

        {trainer.sets.includes("pll") ? (
          <section className="flex flex-col gap-3">
            <h2 className="font-sans text-h3 text-ink">{t("PLL (перестановка)")}</h2>
            <GroupChips
              groups={PLL_GROUPS}
              groupLabel={PLL_GROUP_LABEL}
              onPick={trainer.selectPllGroup}
              onAll={trainer.selectAll}
              allLabel={t("Все 21")}
            />
            <div className="flex flex-col gap-2">
              {PLL_GROUPS.map((group) => (
                <CaseCheckboxGroup<PllCaseId>
                  key={group}
                  legend={t(PLL_GROUP_LABEL[group])}
                  ids={casesByGroup(group).map((c) => c.id)}
                  labelFor={(id) => id}
                  selectedIds={trainer.selectedIds}
                  onToggle={trainer.toggleCase}
                />
              ))}
            </div>
          </section>
        ) : null}

        {trainer.sets.includes("oll") ? (
          <section className="flex flex-col gap-3">
            <h2 className="font-sans text-h3 text-ink">{t("OLL (ориентация)")}</h2>
            <GroupChips
              groups={OLL_GROUPS}
              groupLabel={OLL_GROUP_LABEL}
              onPick={trainer.selectOllGroup}
              onAll={trainer.selectAll}
              allLabel={t("Все 57")}
            />
            <div className="flex flex-col gap-2">
              {OLL_GROUPS.map((group) => (
                <CaseCheckboxGroup<OllCaseId>
                  key={group}
                  legend={t(OLL_GROUP_LABEL[group])}
                  ids={ollCasesByGroup(group).map((c) => c.id)}
                  labelFor={(id) => caseLabel(id)}
                  selectedIds={trainer.selectedIds}
                  onToggle={trainer.toggleCase}
                />
              ))}
            </div>
          </section>
        ) : null}
      </section>

      <section className="flex flex-wrap items-center gap-3">
        <SegmentedToggle<GripMode>
          value={trainer.anyGrip ? "any" : "fixed"}
          onChange={(v) => {
            if ((v === "any") !== trainer.anyGrip) trainer.toggleAnyGrip();
          }}
          label={t("Хват кубика")}
          options={[
            { value: "fixed", label: t("Обычный хват") },
            { value: "any", label: t("Любой хват") },
          ]}
        />
      </section>

      <section className="flex flex-col gap-3">
        <p
          className="rounded-[10px] bg-surface px-3.5 py-3 font-mono text-small text-ink"
          aria-label={t("Скрамбл")}
        >
          {trainer.scramble}
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={trainer.next}>{t("Следующий случай")}</Button>
          {!trainer.revealed ? (
            <Button variant="secondary" onClick={trainer.reveal}>
              {t("Показать ответ")}
            </Button>
          ) : null}
        </div>

        {trainer.revealed ? (
          <div className="flex flex-col items-start gap-3 rounded-lg border-2 border-ink bg-surface p-4.5">
            <span className="font-sans text-h3 text-ink">{caseLabel(trainer.caseId)}</span>
            <p className="font-mono text-small text-ink">{current.alg}</p>
            {currentIsOll ? (
              <OllDiagram
                facelets={current.facelets}
                caption={t("Случай {id}", { id: caseLabel(trainer.caseId) })}
              />
            ) : (
              <LastLayerDiagram
                facelets={current.facelets}
                caption={t("Случай {id}", { id: caseLabel(trainer.caseId) })}
              />
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}
