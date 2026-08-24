// Единственное имя аккаунта (`handle`, П10). Раньше это были два разных поля —
// приватный никнейм для себя и опциональный `public_handle` для чужих глаз —
// теперь одно: свой заголовок в профиле И то, что видят другие (список друзей,
// таблицы турнира и скрамбла дня). Ярлык + подпись живут в одном месте, чтобы
// формулировка не разошлась между профилем (ProfilePage's EditForm) и
// онбордингом (OnboardingPage's HandleStep) — оба переиспользуют этот
// компонент вместо копии текста.
//
// "@" — только оформление показа (см. lib/handle.ts): сюда и на сервер всегда
// уезжает голый ник, а если человек всё же набрал «@ник» — ведущую собаку
// молча срезаем по вводу.

import Input from "../components/Input";
import { useT } from "../i18n/t";
import { stripHandlePrefix } from "../lib/handle";

export default function HandleField({
  value,
  onChange,
  error,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  id?: string;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-1.5">
      <Input
        id={id}
        label={t("Ник")}
        placeholder={t("Не задано — покажем как «Аноним»")}
        maxLength={64}
        value={value}
        onChange={(e) => onChange(stripHandlePrefix(e.target.value))}
        error={error}
      />
      <p className="font-sans text-small text-muted">
        {t(
          "Это имя видно тебе и другим: в шапке профиля, списке друзей и таблицах турнира и скрамбла дня.",
        )}
      </p>
    </div>
  );
}
