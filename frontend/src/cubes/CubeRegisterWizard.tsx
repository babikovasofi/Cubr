// Register a cube profile: enable camera → capture 6 faces (reuses the reader's
// calibrate flow via useCubeRegister) → name + optional note + primary toggle →
// preview the 6 swatches → POST /cubes through cubesStore (keeps the list and the
// single-primary invariant in sync). The captured profile is persisted verbatim
// (calibrate() output, keys U/R/F/D/L/B) — no remapping.

import { useState, type FormEvent } from "react";
import Button from "../components/Button";
import Input from "../components/Input";
import CameraStage from "../solo/CameraStage";
import ColorPalette from "./ColorPalette";
import { useCubeRegister, REGISTER_FACES } from "./useCubeRegister";
import { useCubesStore } from "../store/cubesStore";
import { ApiError } from "../api/client";
import type { CubeRead } from "../api/cubes";

interface Props {
  defaultPrimary?: boolean;
  onDone: (cube: CubeRead) => void;
  onCancel: () => void;
}

export default function CubeRegisterWizard({ defaultPrimary = false, onDone, onCancel }: Props) {
  const reg = useCubeRegister();
  const createCube = useCubesStore((s) => s.create);

  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [primary, setPrimary] = useState(defaultPrimary);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setFormError("Придумай название — так проще отличать кубики.");
      return;
    }
    if (!reg.profile) {
      setFormError("Сначала сними все 6 граней.");
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const cube = await createCube({
        name: trimmed,
        note: note.trim() || null,
        is_primary: primary,
        color_profile: reg.profile,
      });
      onDone(cube);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Не удалось сохранить кубик.");
    } finally {
      setBusy(false);
    }
  }

  // Stage 1: camera not yet enabled.
  if (!reg.started) {
    return (
      <div className="flex flex-col gap-4">
        <p className="font-sans text-body text-muted">
          Поднеси собранный кубик к камере: снимем цвет каждой из 6 граней, чтобы
          Cubr узнавал именно твой кубик.
        </p>
        {reg.error ? (
          <p role="alert" className="font-sans text-small text-danger">
            {reg.error}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={reg.start}>Включить камеру</Button>
          <button
            type="button"
            onClick={onCancel}
            className="font-sans text-small font-bold text-muted"
          >
            Отмена
          </button>
        </div>
      </div>
    );
  }

  const done = reg.calibrated;
  const nextFace = Math.min(reg.calibrationStep + 1, REGISTER_FACES);

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_20rem]">
      <CameraStage
        videoRef={reg.videoRef}
        overlayRef={reg.overlayRef}
        workRef={reg.workRef}
        error={reg.error}
        onRetry={reg.start}
      />

      <aside className="flex flex-col gap-4">
        {!done ? (
          <div className="flex flex-col gap-3 rounded-lg border-2 border-ink bg-surface p-4.5">
            <h3 className="font-sans text-h3 text-ink">Снимаем грани</h3>
            <p className="font-sans text-small text-muted">
              Держи одну грань в жёлтой рамке и снимай по очереди — снято{" "}
              {reg.calibrationStep}/{REGISTER_FACES}.
            </p>
            <Button onClick={reg.capture}>
              Снять грань {nextFace}/{REGISTER_FACES}
            </Button>
            <button
              type="button"
              onClick={onCancel}
              className="self-start font-sans text-small font-bold text-muted"
            >
              Отмена
            </button>
          </div>
        ) : (
          <form
            className="flex flex-col gap-4 rounded-lg border-2 border-ink bg-surface p-4.5"
            onSubmit={onSubmit}
            noValidate
          >
            <h3 className="font-sans text-h3 text-ink">Сохранить кубик</h3>

            <div className="flex flex-col gap-1.5">
              <span className="font-sans text-small font-bold text-ink">Цвет-профиль</span>
              {reg.profile ? <ColorPalette profile={reg.profile} size="md" /> : null}
            </div>

            <Input
              label="Название"
              maxLength={64}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например, MoYu основной"
              required
            />
            <Input
              label="Заметка (необязательно)"
              maxLength={255}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="магнитный, для соревнований…"
            />

            <label className="flex items-center gap-2 font-sans text-small text-ink">
              <input
                type="checkbox"
                checked={primary}
                onChange={(e) => setPrimary(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              Сделать основным кубиком
            </label>

            {formError ? (
              <p role="alert" className="font-sans text-small text-danger">
                {formError}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={busy}>
                {busy ? "Сохраняю…" : "Сохранить кубик"}
              </Button>
              <button
                type="button"
                onClick={reg.reset}
                className="font-sans text-small font-bold text-muted"
              >
                Снять заново
              </button>
              <button
                type="button"
                onClick={onCancel}
                className="font-sans text-small font-bold text-muted"
              >
                Отмена
              </button>
            </div>
          </form>
        )}
      </aside>
    </div>
  );
}
