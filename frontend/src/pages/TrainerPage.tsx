// PLL case trainer (plan: ll-trainer). Public, no auth, no camera — a text
// scramble, a diagram, and two buttons. §6.2 lobby-style column (≤720px).
//
// П5: practice writes zero rows anywhere — no import from src/api/, no
// network call at all. Verified by TrainerPage.test.tsx mounting with a
// mocked fetch and asserting 0 calls.

import { useEffect } from "react";
import Button from "../components/Button";
import LastLayerDiagram from "../components/LastLayerDiagram";
import SegmentedToggle from "../components/SegmentedToggle";
import { useT } from "../i18n/t";
import { PLL_GROUPS, casesByGroup, getCase, type PllCaseId, type PllGroup } from "../trainer/pll";
import { useTrainer } from "../trainer/useTrainer";

const GROUP_LABEL: Record<PllGroup, string> = {
  "edges-only": "Только рёбра",
  "corners-only": "Только углы",
  "adjacent-swap": "Соседняя пара",
  "diagonal-swap": "По диагонали",
  "g-perm": "G-перестановки",
};

type GripMode = "fixed" | "any";

function GroupChips({ onPick, onAll }: { onPick: (group: PllGroup) => void; onAll: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={onAll}
        className="inline-flex h-8 items-center rounded-full border-2 border-ink bg-surface px-3 font-sans text-small font-bold text-ink"
      >
        {t("Все 21")}
      </button>
      {PLL_GROUPS.map((group) => (
        <button
          key={group}
          type="button"
          onClick={() => onPick(group)}
          className="inline-flex h-8 items-center rounded-full border-2 border-ink bg-surface px-3 font-sans text-small font-bold text-ink"
        >
          {t(GROUP_LABEL[group])}
        </button>
      ))}
    </div>
  );
}

function CaseCheckboxGroup({
  group,
  selectedIds,
  onToggle,
}: {
  group: PllGroup;
  selectedIds: readonly PllCaseId[];
  onToggle: (id: PllCaseId) => void;
}) {
  const t = useT();
  return (
    <fieldset className="flex flex-col gap-1.5 rounded-md border border-line p-3">
      <legend className="px-1 font-sans text-caption font-bold uppercase text-muted">
        {t(GROUP_LABEL[group])}
      </legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {casesByGroup(group).map((c) => (
          <label
            key={c.id}
            className="inline-flex cursor-pointer items-center gap-1.5 font-sans text-small text-ink"
          >
            <input
              type="checkbox"
              checked={selectedIds.includes(c.id)}
              onChange={() => onToggle(c.id)}
              className="h-4 w-4 accent-primary"
            />
            {c.id}
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

export default function TrainerPage() {
  const t = useT();
  const trainer = useTrainer();
  const current = getCase(trainer.caseId);

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
        <h1 className="font-sans text-h1 text-ink">{t("Тренажёр PLL")}</h1>
        <p className="max-w-prose font-sans text-body text-muted">
          {t(
            "Выбери один или несколько случаев — получишь скрамбл, который гарантированно ставит кубик именно в этот случай. Без сборки, без камеры: собери скрамбл руками и сверься с ответом.",
          )}
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <GroupChips onPick={trainer.selectGroup} onAll={trainer.selectAll} />
        <div className="flex flex-col gap-2">
          {PLL_GROUPS.map((group) => (
            <CaseCheckboxGroup
              key={group}
              group={group}
              selectedIds={trainer.selectedIds}
              onToggle={trainer.toggleCase}
            />
          ))}
        </div>
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
            <span className="font-sans text-h3 text-ink">{current.id}</span>
            <p className="font-mono text-small text-ink">{current.alg}</p>
            <LastLayerDiagram
              facelets={current.facelets}
              caption={t("Случай {id}", { id: current.id })}
            />
          </div>
        ) : null}
      </section>
    </div>
  );
}
