// Витрина профиля (V3): чем собираешь и с какого года. Видит только владелец —
// публичных профилей в Cubr нет, на бордах живёт лишь `public_handle` (П10),
// поэтому подпись про «это увидят другие» здесь была бы враньём.

import { useState, type FormEvent } from "react";
import Button from "../components/Button";
import Input from "../components/Input";
import { ApiError } from "../api/client";
import type { SolvingMethod, UserUpdate } from "../api/auth";
import { translate, useT } from "../i18n/t";

// Значения — ключи перевода (см. i18n): показываются через t() в форме.
export const METHOD_LABELS: Record<SolvingMethod, string> = {
  cfop: "CFOP (Fridrich)",
  roux: "Roux",
  zz: "ZZ",
  petrus: "Petrus",
  beginner: "Слоями (начинающий)",
  other: "Другой",
};

export const MIN_CUBING_YEAR = 1974;

/** Проверка года на клиенте — те же границы, что на сервере. */
export function yearError(raw: string, currentYear: number): string | null {
  if (raw.trim() === "") return null;
  const year = Number(raw);
  if (!Number.isInteger(year)) return "Год — это четыре цифры.";
  if (year < MIN_CUBING_YEAR) return `Кубик изобрели в ${MIN_CUBING_YEAR} году.`;
  if (year > currentYear) return "Год не может быть в будущем.";
  return null;
}

/** «с 2019 года · 7 лет» — стаж по календарным годам, без выдумок про месяцы.
 *  Переводчик передаётся снаружи: строка собирается из подстановок, а не
 *  склеивается, иначе английский вариант нельзя было бы построить. */
export function experienceLabel(
  year: number,
  currentYear: number,
  t: (key: string, params?: Record<string, string | number>) => string = (k, p) =>
    translate("ru", k, p),
): string {
  const years = Math.max(0, currentYear - year);
  if (years === 0) return t("с {year} года · первый год", { year });
  const mod10 = years % 10;
  const mod100 = years % 100;
  const word =
    mod10 === 1 && mod100 !== 11
      ? "год"
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? "года"
        : "лет";
  return t("с {year} года · {years} {word}", { year, years, word: t(word) });
}

export default function ShowcaseForm({
  initialMethod,
  initialYear,
  onSave,
}: {
  initialMethod: SolvingMethod | null;
  initialYear: number | null;
  onSave: (patch: UserUpdate) => Promise<unknown>;
}) {
  const t = useT();
  const currentYear = new Date().getFullYear();
  const [method, setMethod] = useState<SolvingMethod | "">(initialMethod ?? "");
  const [year, setYear] = useState(initialYear === null ? "" : String(initialYear));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const localError = yearError(year, currentYear);
    if (localError) {
      setError(localError);
      setSaved(false);
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await onSave({
        method: method === "" ? null : method,
        cubing_since_year: year.trim() === "" ? null : Number(year),
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить витрину.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border-2 border-ink bg-surface p-6">
      <div className="flex flex-col gap-1">
        <h2 className="font-sans text-h3 text-ink">{t("Витрина")}</h2>
        <p className="font-sans text-small text-muted">
          {initialMethod !== null && initialYear !== null
            ? `${t(METHOD_LABELS[initialMethod])} · ${experienceLabel(initialYear, currentYear, t)}`
            : t(
                "Метод и год начала — для себя: публичных профилей в Cubr нет, на таблицах видно только публичное имя.",
              )}
        </p>
      </div>

      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <label className="flex flex-col gap-1 font-sans text-small font-bold text-ink">
          {t("Метод сборки")}
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as SolvingMethod | "")}
            className="h-11 rounded-md border-2 border-ink bg-surface px-3 font-sans text-body font-normal text-ink"
          >
            <option value="">{t("Не указан")}</option>
            {(Object.keys(METHOD_LABELS) as SolvingMethod[]).map((key) => (
              <option key={key} value={key}>
                {t(METHOD_LABELS[key])}
              </option>
            ))}
          </select>
        </label>

        <Input
          label={t("Собираю с года")}
          inputMode="numeric"
          placeholder="2019"
          maxLength={4}
          value={year}
          onChange={(e) => setYear(e.target.value)}
        />

        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" disabled={busy}>
            {busy ? t("Сохраняю…") : t("Сохранить витрину")}
          </Button>
          {saved ? (
            <span className="font-sans text-small text-success">{t("Сохранено")}</span>
          ) : null}
          {error ? (
            <span role="alert" className="font-sans text-small text-danger">
              {t(error)}
            </span>
          ) : null}
        </div>
      </form>
    </section>
  );
}
