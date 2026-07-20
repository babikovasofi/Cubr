import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Button from "../components/Button";
import Timer from "../components/Timer";
import { useUiStore } from "../store/uiStore";
import { useAuthStore } from "../store/authStore";
import { createRoom, saveDuelSessionToken } from "../api/duel";

export default function HomePage() {
  const theme = useUiStore((s) => s.theme);
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  const authed = useAuthStore((s) => s.status === "authed");
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
      <section className="flex flex-col gap-4">
        <h1 className="font-sans text-h1 text-ink">Cubr</h1>
        <p className="max-w-prose font-sans text-body text-muted">
          Дуэли по скоростной сборке кубика Рубика. Камера — судья.
        </p>
      </section>

      <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4.5">
        <span className="font-sans text-overline uppercase text-muted">Таймер</span>
        <Timer value="0.00" phase="ready" />
      </section>

      {/* §6.2 "Турнир недели" card — surface + 1px line, live "идёт запись" badge. */}
      <Link
        to="/tournament"
        className="flex items-center justify-between rounded-md border border-line bg-surface px-4.5 py-3.5 no-underline transition-[border] duration-150 ease-linear hover:border-2 hover:border-ink"
      >
        <div className="flex flex-col gap-1">
          <span className="font-sans text-body font-bold text-ink">Челлендж недели</span>
          <span className="font-sans text-small text-muted">
            Общий скрамбл, одна попытка — без турнирной таблицы.
          </span>
        </div>
        <span className="font-sans text-caption font-black uppercase text-live">● идёт запись</span>
      </Link>

      {/* daily-scramble: same card treatment as "Челлендж недели" above — one
          shared scramble a day instead of a week. */}
      <Link
        to="/daily"
        className="flex items-center justify-between rounded-md border border-line bg-surface px-4.5 py-3.5 no-underline transition-[border] duration-150 ease-linear hover:border-2 hover:border-ink"
      >
        <div className="flex flex-col gap-1">
          <span className="font-sans text-body font-bold text-ink">Скрамбл дня</span>
          <span className="font-sans text-small text-muted">
            Общий скрамбл на сутки, одна попытка — без турнирной таблицы.
          </span>
        </div>
        <span className="font-sans text-caption font-black uppercase text-live">● идёт запись</span>
      </Link>

      {/* Этап 4: дуэль по ссылке — create-room + invite, no matchmaking yet. */}
      <section className="flex flex-col gap-3 rounded-lg border-2 border-ink bg-surface p-4.5">
        <div className="flex flex-col gap-1">
          <span className="font-sans text-body font-bold text-ink">Дуэль по ссылке</span>
          <span className="font-sans text-small text-muted">
            Создай комнату и пришли ссылку сопернику — старт синхронный, один общий скрамбл.
          </span>
        </div>
        {authed ? (
          <Button onClick={() => void startDuel()} disabled={duelBusy} className="self-start">
            {duelBusy ? "Создаю комнату…" : "Дуэль по ссылке"}
          </Button>
        ) : (
          <Link to="/login" className="self-start">
            <Button variant="secondary">Войти, чтобы начать дуэль</Button>
          </Link>
        )}
        {duelError ? (
          <p role="alert" className="font-sans text-small text-danger">
            {duelError}
          </p>
        ) : null}
      </section>

      <section className="flex flex-wrap items-center gap-4">
        <Link to="/solo">
          <Button>Соло-тренировка</Button>
        </Link>
        <Button onClick={toggleTheme}>
          Тема: {theme === "light" ? "светлая" : "тёмная"}
        </Button>
        <Button disabled>Недоступно</Button>
        {import.meta.env.DEV ? (
          <Link to="/accuracy">
            <Button className="bg-surface-2 text-ink">Замер точности (dev)</Button>
          </Link>
        ) : null}
      </section>
    </div>
  );
}
