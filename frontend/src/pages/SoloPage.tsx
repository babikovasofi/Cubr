import { Link } from "react-router-dom";

// Stub for Stage 1.1. The full solo solve screen (live camera / hands / twisty)
// lands in 1.2 — no <twisty-player> is mounted here (StrictMode double-mount is a
// 1.2 concern).
export default function SoloPage() {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-sans text-h2 text-ink">Соло — экран сборки в 1.2</h2>
      <p className="font-sans text-body text-muted">
        Экран сборки с камерой, распознаванием рук и скрамблом появится на этапе 1.2.
      </p>
      <Link to="/" className="font-sans text-body font-bold text-primary no-underline">
        ← На главную
      </Link>
    </div>
  );
}
