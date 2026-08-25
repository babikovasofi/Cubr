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
import EmptyState from "../components/EmptyState";
import TrophyIcon from "../components/TrophyIcon";
import { RANKS } from "../components/CupsRoad";
import BadgeGrid from "../components/BadgeGrid";
import GoalCard from "../profile/GoalCard";
import SolveProgressChart from "../components/SolveProgressChart";
import { useIsHandheld } from "../lib/useIsHandheld";
import { useSolves } from "../lib/useSolves";
import { useT } from "../i18n/t";
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
  // Ring pattern (everything but the center) — reads as "the last layer",
  // the one thing this mode drills. danger/red is otherwise unclaimed among
  // the mode-card accents (solo/duel/week/daily already hold the other three
  // bright roles); there's no error context here to clash with.
  trainer: { accent: "var(--danger)", cells: [X, X, X, X, O, X, X, X, X] },
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
  const t = useT();
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
          {t("● идёт запись")}
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
  const t = useT();
  // Этап 6 (R8): с телефона предупреждаем ДО клика по CTA — иначе человек уйдёт
  // в ритуал и упрётся в заглушку уже после решения попробовать.
  const handheld = useIsHandheld();
  return (
    <div className="flex flex-col gap-12">
      {/* Герой: текст слева, живая грань кубика в пустоте справа — от sm
          (640px). На телефоне ширины на пару в ряд не хватает, поэтому грань
          не жмёт текст, а спускается под него уменьшенной копией
          (items-start вместо stretch: и текст, и грань размером в свой
          контент, а не в 100% ширины — так плитки не разъезжает по всей
          строке). */}
      <section className="flex flex-col items-start gap-6 sm:flex-row sm:items-center sm:justify-between sm:gap-8 lg:gap-10">
        <div className="flex min-w-0 flex-col gap-5">
          <h1 className="max-w-[18ch] font-sans text-h1 text-ink">
            {t("Дуэли по сборке кубика. Судит камера.")}
          </h1>
          <p className="max-w-prose font-sans text-body text-muted">
            {t(
              "Показываешь кубик в камеру — браузер сам проверяет скрамбл, ловит старт и стоп по рукам и подтверждает сборку. Ни живого судьи, ни «поверь на слово».",
            )}
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Link to="/register" className="no-underline">
              <Button>{t("Создать аккаунт")}</Button>
            </Link>
            <Link to="/solo" className="no-underline">
              <Button variant="secondary">{t("Попробовать соло без аккаунта")}</Button>
            </Link>
          </div>
          {handheld ? (
            <p className="font-sans text-small font-bold text-ink">
              {t(
                "Сборка идёт с компьютера: нужна камера, кубик и обе руки на столе. С телефона можно почитать правила и завести аккаунт.",
              )}
            </p>
          ) : (
            <p className="font-sans text-small text-faint">
              {t("Нужен компьютер с камерой и обычный комнатный свет. Видео не покидает браузер.")}
            </p>
          )}
        </div>
        <HeroStickers className="sm:pr-4 lg:pr-6" />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-sans text-h2 text-ink">{t("Как проходит сборка")}</h2>
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
              <span className="font-sans text-body font-bold text-ink">{t(step.title)}</span>
              <span className="font-sans text-small text-muted">{t(step.text)}</span>
            </li>
          ))}
        </ol>
        <Link to="/rules" className="font-sans text-small font-bold text-primary">
          {t("Правила целиком: что засчитывается, а что DNF")}
        </Link>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-sans text-h2 text-ink">{t("Где соревноваться")}</h2>
        <div className="flex flex-col gap-3">
          <ModeCard
            to="/solo"
            mode="solo"
            title={t("Соло-тренировка")}
            text={t("Весь ритуал целиком, без аккаунта. Сборки сохраняются, если войти.")}
          />
          <ModeCard
            to="/register"
            mode="duel"
            title={t("Дуэль по ссылке")}
            text={t(
              "Создаёшь комнату, кидаешь ссылку другу — старт синхронный, скрамбл один на двоих.",
            )}
          />
          <ModeCard
            to="/register"
            mode="week"
            title={t("Челлендж недели")}
            text={t("Общий скрамбл на неделю, одна попытка.")}
            live
          />
          <ModeCard
            to="/register"
            mode="daily"
            title={t("Скрамбл дня")}
            text={t("Общий скрамбл на сутки, одна попытка.")}
            live
          />
          {/* Практика без аккаунта: анониму — сразу на /trainer, не на
              /register (§П5: тренажёр не пишет попыток, гейтить его
              регистрацией было бы платой за то, чего нет). */}
          <ModeCard
            to="/trainer"
            mode="trainer"
            title={t("Тренажёр")}
            text={t("78 случаев OLL и PLL, скрамбл под конкретный случай — без аккаунта.")}
          />
        </div>
      </section>

      {/* Блок «Честно и без слежки» убран: два его пункта из трёх дословно
          повторяли шаги выше («Скрамбл выдаёт сервер») и строку под героем
          («Видео не покидает браузер»), а ссылки на правила и приватность и без
          него стоят в футере на каждой странице. Осталось единственное, чего
          нигде больше нет, — честное предупреждение про рейтинг; оно стоит
          ровно там, где человек только что прочитал про таблицы. */}
      <p className="max-w-prose font-sans text-small text-muted">
        {t(
          "Мест и рейтинга пока нет: времена заявляет клиент, поэтому таблицы показывают участников без номеров. Рейтинг появится, когда заработает серверная проверка.",
        )}
      </p>

      <section className="flex flex-col gap-4">
        <h2 className="font-sans text-h2 text-ink">{t("Готов?")}</h2>
        <p className="max-w-prose font-sans text-body text-muted">
          {t(
            "Аккаунт нужен для дуэлей, челленджа недели и истории сборок. Соло работает и без него.",
          )}
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <Link to="/register" className="no-underline">
            <Button>{t("Создать аккаунт")}</Button>
          </Link>
          <Link to="/login" className="font-sans text-small font-bold text-primary">
            {t("У меня уже есть аккаунт")}
          </Link>
        </div>
      </section>
    </div>
  );
}

// Compact teaser (plan: cups-system) — the full ladder now lives on its own
// screen at /cups (owner: "отдельный красивый экран как в brawl stars").
// Reads `user` straight from the store, same as CupsRoad — no extra request.
function CupsTeaser() {
  const t = useT();
  const user = useAuthStore((s) => s.user);
  if (!user) return null;

  const rank = RANKS.find((r) => r.name === user.cups_rank);

  return (
    <Link to="/cups" className={CARD_LINK}>
      <div className="flex items-center gap-4">
        <TrophyIcon size={24} className="text-ink" />
        <div className="flex flex-col gap-1">
          <span className="font-sans text-body font-bold text-ink [font-variant-numeric:tabular-nums]">
            {user.cups.toLocaleString("ru-RU")}
          </span>
          {rank ? <span className="font-sans text-small text-muted">{t(rank.label)}</span> : null}
        </div>
      </div>
      <span className="whitespace-nowrap font-sans text-small font-bold text-primary">
        {t("Вся дорога →")}
      </span>
    </Link>
  );
}

function Dashboard() {
  const t = useT();
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
      setDuelError(t("Не удалось создать дуэль. Попробуй ещё раз."));
      setDuelBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-7">
      <section className="flex flex-col gap-2">
        <h1 className="font-sans text-h1 text-ink">{t("С чего начнём?")}</h1>
        <p className="max-w-prose font-sans text-body text-muted">
          {t(
            "Соло — на разогрев, дуэль — на соперника, челлендж и скрамбл дня — на общем скрамбле.",
          )}
        </p>
      </section>

      {/* §6.2 карточки-режимы: surface + 1px line, live-бейдж «идёт запись».
          Соло — первым: это разогрев и единственный режим без соперника. Карточка,
          как у всех режимов (раньше была голой кнопкой снизу — выбивалась). */}
      <ModeCard
        to="/solo"
        mode="solo"
        title={t("Соло-тренировка")}
        text={t("Весь ритуал целиком, без аккаунта. Сборки сохраняются, если войти.")}
      />
      <ModeCard
        to="/tournament"
        mode="week"
        title={t("Челлендж недели")}
        text={t("Общий скрамбл, одна попытка — без турнирной таблицы.")}
        live
      />
      <ModeCard
        to="/daily"
        mode="daily"
        title={t("Скрамбл дня")}
        text={t("Общий скрамбл на сутки, одна попытка — без турнирной таблицы.")}
        live
      />
      <ModeCard
        to="/trainer"
        mode="trainer"
        title={t("Тренажёр")}
        text={t("78 случаев OLL и PLL, скрамбл под конкретный случай — без аккаунта.")}
      />

      {/* Этап 4: дуэль по ссылке — create-room + invite, без матчмейкинга. */}
      <section className="flex flex-col gap-3 rounded-lg border-2 border-ink bg-surface p-4.5">
        <div className="flex items-center gap-4">
          <MiniGrid accent={MODE_ICON.duel.accent} cells={[...MODE_ICON.duel.cells]} />
          <div className="flex flex-col gap-1">
            <span className="font-sans text-body font-bold text-ink">{t("Дуэль по ссылке")}</span>
            <span className="font-sans text-small text-muted">
              {t(
                "Создай комнату и пришли ссылку сопернику — старт синхронный, один общий скрамбл.",
              )}
            </span>
          </div>
        </div>
        <Button onClick={() => void startDuel()} disabled={duelBusy} className="self-start">
          {duelBusy ? t("Создаю комнату…") : t("Дуэль по ссылке")}
        </Button>
        {duelError ? (
          <p role="alert" className="font-sans text-small text-danger">
            {duelError}
          </p>
        ) : null}
      </section>

      {import.meta.env.DEV ? (
        <section className="flex flex-wrap items-center gap-4">
          <Link to="/accuracy" className="no-underline">
            <Button variant="secondary">{t("Замер точности (dev)")}</Button>
          </Link>
          <Link to="/lab" className="no-underline">
            <Button variant="secondary">{t("Настройка таймера (dev)")}</Button>
          </Link>
        </section>
      ) : null}

      <CupsTeaser />

      <DashboardProgress />

      <BadgeGrid />
    </div>
  );
}

// Прогресс: цель + график по уже собранным сборкам. Пока сборок нет (или
// история ещё грузится/упала) — ОДНА компактная заглушка-нудж на /solo, а не
// три пустые карточки подряд (§AC2 плана design-fillers).
function DashboardProgress() {
  const t = useT();
  const { state } = useSolves();
  const hasSolves = state.kind === "ok" && state.solves.length > 0;

  if (!hasSolves) {
    return (
      <EmptyState
        title={t("Пока нет сборок")}
        description={t("Собери первый кубик — здесь появятся цель и прогресс.")}
        ctaLabel={t("Собери первый кубик →")}
        ctaTo="/solo"
      />
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <GoalCard solves={state.solves} />
      <div className="flex flex-col gap-1">
        <h2 className="font-sans text-h3 text-ink">{t("Прогресс времени")}</h2>
        <span className="font-sans text-small text-muted">{t("за последние сборки")}</span>
      </div>
      <SolveProgressChart solves={state.solves} />
    </section>
  );
}

export default function HomePage() {
  const authed = useAuthStore((s) => s.status === "authed");
  return authed ? <Dashboard /> : <Landing />;
}
