// Живая грань кубика для героя лендинга.
//
// Это НЕ модель кубика и не twisty-плеер: изометрический рендер выпадал из
// графического языка сайта (§1 «Чистая сетка» + стикеры). Здесь ровно язык
// дизайн-системы — 3×3 стикеров с обводкой 2px `ink` и жёсткой тенью
// `shadow-sticker`, лёгкий наклон в пределах ±6°.
//
// Цикл: несколько тиков «мешаем» (часть плиток перекрашивается с пружинным
// подскоком) → грань «сходится» в один цвет и держится → снова. Ровно то, что
// делает продукт: скрамбл, потом собранная грань.
//
// Отступление от §1 («не более 2 ярких цветов кубика в компоненте») сознательное:
// это знак-иллюстрация, тот же класс, что логотип.
//
// prefers-reduced-motion: таймеры не заводятся вовсе, остаётся статичная грань.
//
// Размер плитки отзывчивый (мобильный/sm/lg), а не фиксированный: грань видна
// на любой ширине, но на телефоне — уменьшенной копией. При уменьшении тени и
// радиус в 3px/14px «на телефоне» выглядят чугунно (несоразмерно 36px-плитке),
// поэтому оба масштабируются вместе с плиткой — §4 держит только требование
// «≈22% стороны» для радиуса, жёсткая тень 2px на мобильной плитке держит тот
// же характер, что 3px `shadow-sticker` на больших. lg-уровень (64px, 14px,
// `shadow-sticker`) byte-for-byte тот же, что был раньше, — на десктопе
// ничего не меняется.

import { useEffect, useState } from "react";

// Белый — литералом, а не токеном: `--surface` в тёмной теме почти чёрный, и
// белая наклейка превращалась бы в пустую ячейку. Остальные — токены, они сами
// светлеют в тёмной теме.
const PALETTE = [
  "var(--primary)",
  "var(--warning)",
  "var(--danger)",
  "var(--success)",
  "var(--live)",
  "#FFFFFF",
];

// Наклон каждой наклейки фиксирован по индексу: «клеили руками», но не пляшет
// от кадра к кадру.
const TILT = [-3, 2, -1, 1, -2, 3, 2, -3, 1];

const SCRAMBLE_TICKS = 7;
const TICK_MS = 430;
const SOLVED_HOLD_MS = 2400;
const START_DELAY_MS = 700;

const STATIC_FRAME = [0, 1, 2, 3, 5, 4, 1, 0, 2];

type Frame = { colors: number[]; solved: boolean };

// step внутри цикла: 0..SCRAMBLE_TICKS-1 — мешаем, последний — грань собрана.
function frameFor(step: number, prev: number[]): Frame {
  const inCycle = step % (SCRAMBLE_TICKS + 1);
  if (inCycle === SCRAMBLE_TICKS) {
    const solvedColor = Math.floor(step / (SCRAMBLE_TICKS + 1)) % PALETTE.length;
    return { colors: Array(9).fill(solvedColor), solved: true };
  }
  // Перекрашиваем три случайные наклейки — грань «мешается», а не мигает целиком.
  const next = [...prev];
  for (let n = 0; n < 3; n += 1) {
    const i = Math.floor(Math.random() * 9);
    next[i] = (next[i] + 1 + Math.floor(Math.random() * (PALETTE.length - 1))) % PALETTE.length;
  }
  return { colors: next, solved: false };
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

export default function HeroStickers({ className = "" }: { className?: string }) {
  const [frame, setFrame] = useState<Frame>({ colors: STATIC_FRAME, solved: false });

  useEffect(() => {
    if (prefersReducedMotion()) return;

    let step = 0;
    let colors = STATIC_FRAME;
    let timer: ReturnType<typeof setTimeout>;

    // Кадр считается ДО setState: внутри updater'а React волен вызвать функцию
    // отложенно или дважды (StrictMode) — тогда и пауза, и случайность поехали бы.
    const run = () => {
      const next = frameFor(step, colors);
      colors = next.colors;
      setFrame(next);
      step += 1;
      timer = setTimeout(run, next.solved ? SOLVED_HOLD_MS : TICK_MS);
    };

    timer = setTimeout(run, START_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      aria-hidden
      className={`grid shrink-0 grid-cols-3 items-start gap-1.5 sm:gap-2 lg:gap-2.5 ${className}`}
      style={{ transform: "rotate(-4deg)" }}
      data-solved={frame.solved ? "true" : "false"}
    >
      {frame.colors.map((color, i) => (
        <span
          key={i}
          data-testid="hero-sticker"
          className={[
            // 36px на телефоне → 48px от sm (640px) → 64px (исходный размер) от lg (1024px).
            "h-9 w-9 rounded-sm border-2 border-ink shadow-[2px_2px_0_var(--ink)]",
            "sm:h-12 sm:w-12 sm:rounded-md sm:shadow-sticker",
            "lg:h-16 lg:w-16 lg:rounded-tile",
            "transition-[background-color,transform] duration-300 ease-spring",
          ].join(" ")}
          // Наклон и подскок — одним inline-transform: класс-скейл Tailwind тут
          // не сработал бы, inline-transform его перекрывает.
          style={{
            background: PALETTE[color],
            transform: `rotate(${TILT[i]}deg) scale(${frame.solved ? 1.06 : 1})`,
            transitionDelay: `${i * 25}ms`,
          }}
        />
      ))}
    </div>
  );
}
