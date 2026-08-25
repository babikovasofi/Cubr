// Онбординг-шаг «Как проходит сборка»: тот же ритуал из 4 шагов, что и на
// лендинге (HomePage §STEPS), той же самой копией — единый источник правды
// для пользователя, который увидит текст дважды (сначала тут, потом на
// главной), а не два разных описания одного процесса. Мотив — MiniGrid §4,
// не эмодзи: акцентный цвет живёт в детали (сетке), а не в заливке карточки.

import MiniGrid from "../components/MiniGrid";
import { useT } from "../i18n/t";

const O = false;
const X = true;

// Один узнаваемый рисунок сетки на шаг — не просто число, а деталь, которую
// потом видно и на самом экране дуэли (см. design-system §5.8: сетка =
// статус). Цвета — те же 4 роли, что STEP_ACCENTS на лендинге.
const RITUAL_ICONS = [
  { accent: "var(--success)", cells: [O, O, O, O, X, O, O, O, O] }, // готовый кубик — одна точка
  { accent: "var(--warning)", cells: [X, O, X, O, X, O, X, O, X] }, // скрамбл — шахматка
  { accent: "var(--primary)", cells: [O, O, O, X, X, X, O, O, O] }, // старт — средняя полоса «пошло»
  { accent: "var(--live)", cells: [X, X, X, X, X, X, X, X, X] }, // стоп — вся грань собрана
] as const;

const STEPS = [
  {
    title: "Показываешь собранный кубик",
    text: "Браузер запоминает цвета именно твоего кубика — до скрамбла.",
  },
  {
    title: "Скрамбл выдаёт компьютер",
    text: "Мешаешь по пошаговым картинкам или по нотации и показываешь результат — он сверяется с эталоном.",
  },
  {
    title: "Две руки на стол — старт",
    text: "Отпустил руки — время пошло. В дуэли старт синхронный, его даёт компьютер обоим.",
  },
  {
    title: "Руки на стол — стоп",
    text: "Показываешь кубик в камеру, сборка подтверждается, время записывается в историю.",
  },
] as const;

export default function RitualSteps() {
  const t = useT();
  return (
    <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {STEPS.map((step, i) => (
        <li
          key={step.title}
          className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4.5"
        >
          <div className="flex items-center gap-2">
            <span
              className="inline-flex h-7 w-7 items-center justify-center rounded-sm border-2 border-ink font-sans text-small font-black text-ink"
              style={{ background: RITUAL_ICONS[i].accent }}
            >
              {i + 1}
            </span>
            <MiniGrid accent={RITUAL_ICONS[i].accent} cells={[...RITUAL_ICONS[i].cells]} />
          </div>
          <span className="font-sans text-body font-bold text-ink">{t(step.title)}</span>
          <span className="font-sans text-small text-muted">{t(step.text)}</span>
        </li>
      ))}
    </ol>
  );
}
