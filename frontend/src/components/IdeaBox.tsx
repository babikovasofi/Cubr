// Точка обратной связи «есть идея — напиши». Два входа, как принято в вебе:
//   • сквозная ссылка в футере (там её ищут осознанно, рядом с правилами);
//   • эта карточка внизу главной — там, где человек уже всё посмотрел.
// Почта, а не форма: формы у нас нет, а ложная форма без бэкенда хуже письма.
// Адрес показан текстом (его копируют, если почтовик не настроен), тема письма
// подставлена — письмо без темы теряется.
//
// §1 (90/8/2): блок служебный, поэтому цвет — только в мини-сетке и в кнопке;
// заливка нейтральная `surface`, обводка 2px ink + shadow-sticker, без поворота
// (поворот — только у стикеров-событий, §1 «никогда так» п.4).

import MiniGrid from "./MiniGrid";
import { useT } from "../i18n/t";

export const FEEDBACK_EMAIL = "babikovasofia51@gmail.com";

/** mailto с подставленной темой — письмо приходит уже помеченным. */
export function feedbackMailto(subject: string): string {
  return `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}`;
}

const O = false;
const X = true;
// «Лампочка» из сетки 3×3: верхний ряд + центр — идея.
const IDEA_CELLS = [X, X, X, O, X, O, O, X, O];

export default function IdeaBox() {
  const t = useT();
  return (
    <section
      aria-labelledby="ideabox-title"
      className="mt-12 flex flex-col gap-4 rounded-xl border-2 border-ink bg-surface p-5 shadow-sticker sm:flex-row sm:items-center sm:justify-between sm:gap-8 sm:p-6"
    >
      <div className="flex min-w-0 items-start gap-4">
        <MiniGrid accent="var(--warning)" cells={IDEA_CELLS} className="mt-1" />
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="ideabox-title" className="font-sans text-h3 text-ink">
            {t("Есть идея, как сделать лучше?")}
          </h2>
          <p className="font-sans text-small text-muted">
            {t("Напиши, что мешает или чего не хватает, — читаю все письма.")}{" "}
            <span className="select-all whitespace-nowrap font-mono text-small text-ink">
              {FEEDBACK_EMAIL}
            </span>
          </p>
        </div>
      </div>
      <a
        href={feedbackMailto(t("Cubr — идея или предложение"))}
        className="inline-flex h-11 shrink-0 items-center justify-center self-start rounded-full border-2 border-ink bg-primary px-4.5 font-sans text-small font-extrabold text-white no-underline transition-transform duration-150 ease-spring hover:-translate-x-0.5 hover:-translate-y-0.5 hover:bg-primary-press hover:shadow-sticker active:translate-x-0 active:translate-y-0 active:shadow-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:self-auto"
      >
        {t("Написать письмо")}
      </a>
    </section>
  );
}
