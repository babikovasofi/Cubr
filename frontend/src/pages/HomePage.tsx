import { Link } from "react-router-dom";
import Button from "../components/Button";
import Timer from "../components/Timer";
import { useUiStore } from "../store/uiStore";

export default function HomePage() {
  const theme = useUiStore((s) => s.theme);
  const toggleTheme = useUiStore((s) => s.toggleTheme);

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
