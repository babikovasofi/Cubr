// Этап 6 (R8): экран-заглушка для мобильных браузеров. Оборачивает РИТУАЛЬНЫЕ
// роуты (соло/челлендж/скрамбл дня/дуэль) — те, где нужны камера, кубик и обе руки.
// Лендинг, правила, приватность, вход/регистрация и профиль остаются открытыми:
// с телефона про Cubr читают и заводят аккаунт, а собирают уже за компьютером.
//
// Гейт монтируется ВМЕСТО детей, а не поверх них: иначе камера/WS ритуала успели бы
// подняться под заглушкой.

import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import Button from "./Button";
import { useIsHandheld } from "../lib/useIsHandheld";
import { useDeviceStore } from "../store/deviceStore";

// Копируем ИМЕННО текущий адрес, а не корень: приглашение в дуэль
// (`/duel/join/<token>`) без токена бесполезно — человек должен перенести на
// компьютер ту же ссылку, по которой пришёл.
function currentHref(): string {
  return typeof window === "undefined" ? "" : window.location.href;
}

/** Тот же адрес, но читаемый глазами: без схемы и без хвостового слэша. */
function readableUrl(): string {
  if (typeof window === "undefined") return "cubr";
  const { host, pathname } = window.location;
  return (host + (pathname === "/" ? "" : pathname)).replace(/\/$/, "");
}

function HandheldNotice() {
  const allowHandheld = useDeviceStore((s) => s.allowHandheld);
  const [copied, setCopied] = useState(false);
  const url = readableUrl();

  async function copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(currentHref());
      setCopied(true);
    } catch {
      // Нет clipboard-разрешения — адрес и так написан на экране, копировать можно руками.
      setCopied(false);
    }
  }

  return (
    <section className="flex max-w-prose flex-col gap-5 rounded-lg border-2 border-ink bg-surface p-4.5">
      <h1 className="font-sans text-h1 text-ink">Сборку судит камера компьютера</h1>
      <p className="font-sans text-body text-muted">
        Ритуал Cubr держится на камере: браузер смотрит, как ты мешаешь кубик, ловит старт и стоп по
        рукам на столе и подтверждает сборку. С телефона так не выйдет — руки заняты кубиком, а
        камера смотрит куда угодно, только не на стол.
      </p>
      <p className="font-sans text-body text-muted">
        Открой этот адрес на ноутбуке или компьютере с камерой:
      </p>
      <p className="break-all font-sans text-h2 text-ink">{url}</p>
      <div className="flex flex-wrap items-center gap-4">
        <Button onClick={() => void copyLink()}>
          {copied ? "Ссылка скопирована" : "Скопировать ссылку"}
        </Button>
        <Link to="/" className="font-sans text-small font-bold text-primary">
          На главную
        </Link>
        <Link to="/rules" className="font-sans text-small font-bold text-primary">
          Правила
        </Link>
      </div>
      {/* Ложные срабатывания (планшет с клавиатурой, экзотический браузер) не должны
          делать продукт недоступным — послабление на текущую сессию. */}
      <button
        type="button"
        onClick={allowHandheld}
        className="self-start font-sans text-small text-faint underline"
      >
        Всё равно открыть здесь
      </button>
    </section>
  );
}

export default function DesktopOnlyGate({ children }: { children: ReactNode }) {
  const handheld = useIsHandheld();
  const override = useDeviceStore((s) => s.handheldOverride);

  if (handheld && !override) return <HandheldNotice />;
  return <>{children}</>;
}
