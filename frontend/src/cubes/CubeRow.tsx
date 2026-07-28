// One cube in «Мои кубики»: palette, name (inline-renamable), created date, the
// «основной» badge, and make-primary / delete actions. All mutations go through
// cubesStore so the single-primary invariant and selection stay consistent.

import { useState } from "react";
import Input from "../components/Input";
import ColorPalette from "./ColorPalette";
import { useCubesStore } from "../store/cubesStore";
import { ApiError } from "../api/client";
import { toast } from "../components/Toast";
import type { CubeRead } from "../api/cubes";
import { useT } from "../i18n/t";

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("ru-RU", { dateStyle: "medium" });
}

export default function CubeRow({ cube }: { cube: CubeRead }) {
  const t = useT();
  const update = useCubesStore((s) => s.update);
  const remove = useCubesStore((s) => s.remove);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(cube.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>, fallback: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : fallback;
      setError(msg);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveName() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t("Название не может быть пустым."));
      return;
    }
    if (trimmed === cube.name) {
      setEditing(false);
      return;
    }
    const ok = await run(() => update(cube.id, { name: trimmed }), t("Не удалось переименовать."));
    if (ok) setEditing(false);
  }

  async function makePrimary() {
    await run(() => update(cube.id, { is_primary: true }), t("Не удалось сделать основным."));
  }

  async function del() {
    if (
      !globalThis.confirm(
        t("Удалить кубик «{name}»? Сборки на нём сохранятся.", { name: cube.name }),
      )
    )
      return;
    const ok = await run(() => remove(cube.id), t("Не удалось удалить."));
    if (ok) toast(t("Кубик удалён."), "info");
  }

  return (
    <li className="flex flex-col gap-3 rounded-lg border-2 border-ink bg-surface p-4">
      <div className="flex flex-wrap items-center gap-3">
        <ColorPalette profile={cube.color_profile} />
        <div className="flex min-w-0 flex-1 flex-col">
          {editing ? (
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Input
                  label={t("Название")}
                  maxLength={64}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
              </div>
              <button
                type="button"
                onClick={saveName}
                disabled={busy}
                className="h-11 shrink-0 font-sans text-small font-bold text-primary disabled:text-faint"
              >
                {t("Сохранить")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setName(cube.name);
                  setEditing(false);
                  setError(null);
                }}
                className="h-11 shrink-0 font-sans text-small font-bold text-muted"
              >
                {t("Отмена")}
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate font-sans text-body font-bold text-ink">{cube.name}</span>
              {cube.is_primary ? (
                <span className="rounded-full border-2 border-success px-2 py-0.5 font-sans text-caption uppercase text-success">
                  {t("основной")}
                </span>
              ) : null}
            </div>
          )}
          {cube.note ? <span className="font-sans text-small text-muted">{cube.note}</span> : null}
          <span className="font-sans text-caption text-muted">
            Добавлен {fmtDate(cube.created_at)}
          </span>
        </div>
      </div>

      {error ? (
        <p role="alert" className="font-sans text-small text-danger">
          {error}
        </p>
      ) : null}

      {!editing ? (
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="font-sans text-small font-bold text-primary"
          >
            {t("Переименовать")}
          </button>
          {!cube.is_primary ? (
            <button
              type="button"
              onClick={makePrimary}
              disabled={busy}
              className="font-sans text-small font-bold text-ink disabled:text-faint"
            >
              {t("Сделать основным")}
            </button>
          ) : null}
          <button
            type="button"
            onClick={del}
            disabled={busy}
            className="font-sans text-small font-bold text-danger disabled:text-faint"
          >
            {t("Удалить")}
          </button>
        </div>
      ) : null}
    </li>
  );
}
