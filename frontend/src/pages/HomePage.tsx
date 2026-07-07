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

      <section className="flex flex-wrap items-center gap-4">
        <Link to="/solo">
          <Button>Соло-тренировка</Button>
        </Link>
        <Button onClick={toggleTheme}>
          Тема: {theme === "light" ? "светлая" : "тёмная"}
        </Button>
        <Button disabled>Недоступно</Button>
      </section>
    </div>
  );
}
