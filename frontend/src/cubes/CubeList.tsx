// «Мои кубики» — the cube-profiles section on /profile. Loads the list from
// cubesStore, renders each cube (CubeRow), and gates registration at the 5-cube
// limit: the «Добавить» button is hidden once the limit is reached (the server
// still guards with 409 CUBE_LIMIT, surfaced as a toast if it ever slips through).

import { useEffect, useState } from "react";
import Button from "../components/Button";
import Spinner from "../components/Spinner";
import CubeRow from "./CubeRow";
import CubeRegisterWizard from "./CubeRegisterWizard";
import { useCubesStore } from "../store/cubesStore";
import { CUBE_LIMIT } from "../api/cubes";
import { toast } from "../components/Toast";

export default function CubeList() {
  const list = useCubesStore((s) => s.list);
  const status = useCubesStore((s) => s.status);
  const error = useCubesStore((s) => s.error);
  const load = useCubesStore((s) => s.load);

  const [adding, setAdding] = useState(false);

  // Load once on mount (external sync: a single fetch of the user's cubes).
  useEffect(() => {
    if (status === "idle") void load();
  }, [status, load]);

  const atLimit = list.length >= CUBE_LIMIT;

  return (
    <section className="flex flex-col gap-4" aria-labelledby="cubes-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="cubes-heading" className="font-sans text-h3 text-ink">
          Мои кубики
        </h2>
        {!adding && !atLimit ? (
          <Button onClick={() => setAdding(true)}>Добавить кубик</Button>
        ) : null}
      </div>

      {atLimit && !adding ? (
        <p className="font-sans text-small text-muted">
          Достигнут лимит в {CUBE_LIMIT} кубиков. Удали лишний, чтобы добавить новый.
        </p>
      ) : null}

      {adding ? (
        <div className="rounded-lg border-2 border-ink bg-surface-2 p-4">
          <CubeRegisterWizard
            defaultPrimary={list.length === 0}
            onDone={() => {
              setAdding(false);
              toast("Кубик добавлен.", "success");
            }}
            onCancel={() => setAdding(false)}
          />
        </div>
      ) : null}

      {status === "loading" ? <Spinner label="Загружаю кубики…" /> : null}

      {status === "error" ? (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p className="font-sans text-small text-danger">{error}</p>
          <Button onClick={() => void load()}>Повторить</Button>
        </div>
      ) : null}

      {status === "ready" && list.length === 0 && !adding ? (
        <p className="font-sans text-body text-muted">
          Пока нет кубиков. Зарегистрируй свой, чтобы Cubr узнавал его цвета.
        </p>
      ) : null}

      {list.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {list.map((cube) => (
            <CubeRow key={cube.id} cube={cube} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
