// Публичное имя (`public_handle`, П10) — единственное поле профиля, которое
// видят другие люди: в списке друзей и в таблицах турнира и скрамбла дня.
// Ярлык + подпись про публичность живут в одном месте, чтобы формулировка не
// разошлась между профилем (ProfilePage's EditForm) и онбордингом
// (OnboardingPage's PublicHandleStep) — оба переиспользуют этот компонент
// вместо копии текста.

import Input from "../components/Input";
import { useT } from "../i18n/t";

export default function PublicHandleField({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-1.5">
      <Input
        label={t("Публичное имя")}
        placeholder={t("Не задано — покажем как «Аноним»")}
        maxLength={64}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        error={error}
      />
      <p className="font-sans text-small text-muted">
        {t(
          "Это имя увидят другие: в списке друзей и в таблицах турнира и скрамбла дня. Остальной профиль виден только тебе.",
        )}
      </p>
    </div>
  );
}
