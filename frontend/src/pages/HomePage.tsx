// Этап 6 — публичное лицо сайта. Один роут "/" с двумя лицами:
//   • аноним → лендинг (что это, ритуал, режимы, честность/приватность, CTA);
//   • авторизованный → дашборд режимов (то, что было тут раньше).
// Dev-заглушки (демо-таймер, disabled-кнопка "Недоступно") с главной убраны —
// на публичной странице им не место; dev-роут /accuracy остаётся под import.meta.env.DEV.

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Button from "../components/Button";
import HeroStickers from "../components/HeroStickers";
import MiniGrid from "../components/MiniGrid";
import { useIsHandheld } from "../lib/useIsHandheld";
import { useUiStore } from "../store/uiStore";
import { useAuthStore } from "../store/authStore";
import { createRoom, saveDuelSessionToken } from "../api/duel";

// §5.5 карточка-ссылка: 1px line, hover — граница 2px ink (паддинг компенсирован).
const CARD_LINK =
  "flex items-center justify-between gap-4 rounded-md border border-line bg-surface px-4.5 py-3.5 no-underline transition-[border] duration-150 ease-linear hover:border-2 hover:border-ink";

// У каждого режима своя мини-сетка §4 — цвет и рисунок ячеек. Это и есть
// «мелкие яркие детали» вместо цветных заливок панелей (§1: 90/8/2).
const O = false;
const X = true;
const MODE_ICON = {
  solo: { accent: "var(--success)", cells: [O, O, O, O, X, O, O, O, O] },
  duel: { accent: "var(--primary)", cells: [X, O, X, O, X, O, X, O, X] },
  week: { accent: "var(--warning)", cells: [X, X, X, O, X, O, O, X, O] },
  daily: { accent: "var(--live)", cells: [O, X, O, X, X, X, O, X, O] },
} as const;

type ModeKey = keyof typeof MODE_ICON;

function ModeCard({
  to,
  mode,
  title,
  text,
  live,
}: {
  to: string;
  mode: ModeKey;
  title: string;
  text: string;
  live?: boolean;
}) {
  const icon = MODE_ICON[mode];
  return (
    <Link to={to} className={CARD_LINK}>
      <div className="flex items-center gap-4">
        <MiniGrid accent={icon.accent} cells={[...icon.cells]} />
        <div className="flex flex-col gap-1">
          <span className="font-sans text-body font-bold text-ink">{title}</span>
          <span className="font-sans text-small text-muted">{text}</span>
        </div>
      </div>
      {live ? (
        <span className="whitespace-nowrap font-sans text-caption font-black uppercase text-live">
          ● идёт запись
        </span>
      ) : null}
    </Link>
  );
}

// Цвета наклеек-номеров шагов ритуала — по одному на шаг, в порядке ритуала.
const STEP_ACCENTS = ["var(--success)", "var(--warning)", "var(--primary)", "var(--live)"];

const STEPS: { title: string; text: string }[] = [
  {
    title: "Показываешь собранный кубик",
    text: "Браузер запоминает цвета именно твоего кубика — до скрамбла, чтобы таймер нельзя было взвести заранее.",
  },
  {
    title: "Скрамбл выдаёт сервер",
    text: "Мешаешь по пошаговым картинкам или по нотации и показываешь результат — он сверяется с эталоном.",
  },
  {
    title: "Две руки на стол — старт",
    text: "Отпустил руки — время пошло. В дуэли старт синхронный, его даёт сервер обоим.",
  },
  {
    title: "Руки на стол — стоп",
    text: "Показываешь кубик в камеру, сборка подтверждается, время записывается в историю.",
  },
];

function Landing() {
  // Этап 6 (R8): с телефона предупреждаем ДО клика по CTA — иначе человек уйдёт
  // в ритуал и упрётся в заглушку уже после решения попробовать.
  const handheld = useIsHandheld();
  return (
    <div className="flex flex-col gap-12">
      {/* Герой: текст слева, живая грань кубика в пустоте справа. Декор —
          на узких экранах просто снимается, ничего не теряется. */}
      <section className="flex items-center justify-between gap-10">
        <div className="flex flex-col gap-5">
          <h1 className="max-w-[18ch] font-sans text-h1 text-ink">
            Дуэли по сборке кубика. Судит камера.
          </h1>
          <p className="max-w-prose font-sans text-body text-muted">
            Показываешь кубик в камеру — браузер сам проверяет скрамбл, ловит старт и стоп по рукам
            и подтверждает сборку. Ни живого судьи, ни «поверь на слово».
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Link to="/register" className="no-underline">
              <Button>Создать аккаунт</Button>
            </Link>
            <Link to="/solo" className="no-underline">
              <Button variant="secondary">Попробовать соло без аккаунта</Button>
            </Link>
          </div>
          {handheld ? (
            <p className="font-sans text-small font-bold text-ink">
              Сборка идёт с компьютера: нужна камера, кубик и обе руки на столе. С телефона можно
              почитать правила и завести аккаунт.
            </p>
          ) : (
            <p className="font-sans text-small text-faint">
              Нужен компьютер с камерой и обычный комнатный свет. Видео не покидает браузер.
            </p>
          )}
        </div>
        <HeroStickers className="hidden shrink-0 pr-6 lg:grid" />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-sans text-h2 text-ink">Как проходит сборка</h2>
        <ol className="grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2">
          {STEPS.map((step, i) => (
            <li
              key={step.title}
              className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4.5"
            >
              {/* Номер шага — наклейка в цвете кубика: 4 мелких ярких пятна
                  вместо серых плашек. Текст всегда `ink` (§1: никакого цветного
                  текста на цветной заливке). */}
              <span
                className="inline-flex h-7 w-7 items-center justify-center rounded-sm border-2 border-ink font-sans text-small font-black text-ink"
                style={{ background: STEP_ACCENTS[i] }}
              >
                {i + 1}
              </span>
              <span className="font-sans text-body font-bold text-ink">{step.title}</span>
              <span className="font-sans text-small text-muted">{step.text}</span>
            </li>
          ))}
        </ol>
        <Link to="/rules" className="font-sans text-small font-bold text-primary">
          Правила целиком: что засчитывается, а что DNF
        </Link>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-sans text-h2 text-ink">Где соревноваться</h2>
        <div className="flex flex-col gap-3">
          <ModeCard
            to="/solo"
            mode="solo"
            title="Соло-тренировка"
            text="Весь ритуал целиком, без аккаунта. Сборки сохраняются, если войти."
          />
          <ModeCard
            to="/register"
            mode="duel"
            title="Дуэль по ссылке"
            text="Создаёшь комнату, кидаешь ссылку другу — старт синхронный, скрамбл один на двоих."
          />
          <ModeCard
            to="/register"
            mode="week"
            title="Челлендж недели"
            text="Общий скрамбл на неделю, одна попытка."
            live
          />
          <ModeCard
            to="/register"
            mode="daily"
            title="Скрамбл дня"
            text="Общий скрамбл на сутки, одна попытка."
            live
          />
        </div>
      </section>

      <section className="flex flex-col gap-4 rounded-lg border-2 border-ink bg-surface p-4.5">
        <h2 className="font-sans text-h2 text-ink">Честно и без слежки</h2>
        <ul className="flex list-none flex-col gap-2 p-0">
          <li className="font-sans text-body text-muted">
            <span className="font-bold text-ink">Скрамбл генерит сервер</span> — не браузер, так что
            подсмотреть его заранее нельзя.
          </li>
          <li className="font-sans text-body text-muted">
            <span className="font-bold text-ink">Видео остаётся у тебя</span> — кадры с камеры
            обрабатываются прямо в браузере и никуда не отправляются.
          </li>
          <li className="font-sans text-body text-muted">
            <span className="font-bold text-ink">Мест и рейтинга пока нет</span> — времена сейчас
            заявляет клиент, поэтому таблицы показывают участников без номеров. Рейтинг появится,
            когда заработает серверная проверка.
          </li>
        </ul>
        <div className="flex flex-wrap gap-4">
          <Link to="/rules" className="font-sans text-small font-bold text-primary">
            Правила
          </Link>
          <Link to="/privacy" className="font-sans text-small font-bold text-primary">
            Данные и приватность
          </Link>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-sans text-h2 text-ink">Готов?</h2>
        <p className="max-w-prose font-sans text-body text-muted">
          Аккаунт нужен для дуэлей, челленджа недели и истории сборок. Соло работает и без него.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <Link to="/register" className="no-underline">
            <Button>Создать аккаунт</Button>
          </Link>
          <Link to="/login" className="font-sans text-small font-bold text-primary">
            У меня уже есть аккаунт
          </Link>
        </div>
      </section>
    </div>
  );
}

function Dashboard() {
  const theme = useUiStore((s) => s.theme);
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  const navigate = useNavigate();
  const [duelBusy, setDuelBusy] = useState(false);
  const [duelError, setDuelError] = useState<string | null>(null);

  async function startDuel(): Promise<void> {
    setDuelBusy(true);
    setDuelError(null);
    try {
      const room = await createRoom();
      saveDuelSessionToken(room.room_id, room.session_token);
      navigate(`/duel/${room.room_id}`, { state: { joinUrl: room.join_url } });
    } catch {
      setDuelError("Не удалось создать дуэль. Попробуй ещё раз.");
      setDuelBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-7">
      <section className="flex flex-col gap-2">
        <h1 className="font-sans text-h1 text-ink">С чего начнём?</h1>
        <p className="max-w-prose font-sans text-body text-muted">
          Соло — на разогрев, дуэль — на соперника, челлендж и скрамбл дня — на общем скрамбле.
        </p>
      </section>

      {/* §6.2 карточки-режимы: surface + 1px line, live-бейдж «идёт запись». */}
      <ModeCard
        to="/tournament"
        mode="week"
        title="Челлендж недели"
        text="Общий скрамбл, одна попытка — без турнирной таблицы."
        live
      />
      <ModeCard
        to="/daily"
        mode="daily"
        title="Скрамбл дня"
        text="Общий скрамбл на сутки, одна попытка — без турнирной таблицы."
        live
      />

      {/* Этап 4: дуэль по ссылке — create-room + invite, без матчмейкинга. */}
      <section className="flex flex-col gap-3 rounded-lg border-2 border-ink bg-surface p-4.5">
        <div className="flex items-center gap-4">
          <MiniGrid accent={MODE_ICON.duel.accent} cells={[...MODE_ICON.duel.cells]} />
          <div className="flex flex-col gap-1">
            <span className="font-sans text-body font-bold text-ink">Дуэль по ссылке</span>
            <span className="font-sans text-small text-muted">
              Создай комнату и пришли ссылку сопернику — старт синхронный, один общий скрамбл.
            </span>
          </div>
        </div>
        <Button onClick={() => void startDuel()} disabled={duelBusy} className="self-start">
          {duelBusy ? "Создаю комнату…" : "Дуэль по ссылке"}
        </Button>
        {duelError ? (
          <p role="alert" className="font-sans text-small text-danger">
            {duelError}
          </p>
        ) : null}
      </section>

      <section className="flex flex-wrap items-center gap-4">
        <Link to="/solo" className="no-underline">
          <Button>Соло-тренировка</Button>
        </Link>
        <Button variant="secondary" onClick={toggleTheme}>
          Тема: {theme === "light" ? "светлая" : "тёмная"}
        </Button>
        {import.meta.env.DEV ? (
          <Link to="/accuracy" className="no-underline">
            <Button variant="secondary">Замер точности (dev)</Button>
          </Link>
        ) : null}
      </section>
    </div>
  );
}

export default function HomePage() {
  const authed = useAuthStore((s) => s.status === "authed");
  return authed ? <Dashboard /> : <Landing />;
}
