// Живой чек-лист правил пароля под полем ввода.
//
// Существует потому, что политика сервера (10 символов, не почта, не частый
// пароль) неочевидна, а узнавать её по одной ошибке за отправку формы —
// тупик: человек правит длину, получает следующий отказ, и так по кругу.
// Правила видны сразу и загораются по мере ввода.
//
// `aria-live="polite"`: список меняется, пока фокус в поле пароля, и
// скринридер должен сообщать выполненное правило, не перебивая набор.

import { hasIdentity, PASSWORD_RULES, type PasswordIdentity } from "../lib/password";
import { useT } from "../i18n/t";

interface PasswordChecklistProps {
  password: string;
  identity?: PasswordIdentity;
}

export default function PasswordChecklist({ password, identity = {} }: PasswordChecklistProps) {
  const t = useT();

  return (
    <ul className="flex flex-col gap-1" aria-live="polite">
      {PASSWORD_RULES.filter((rule) => !rule.requiresIdentity || hasIdentity(identity)).map(
        (rule) => {
          const met = rule.met(password, identity);
          return (
            <li
              key={rule.id}
              data-testid={`password-rule-${rule.id}`}
              data-met={met ? "true" : "false"}
              className={[
                "flex items-center gap-2 font-sans text-small",
                met ? "text-success" : "text-muted",
              ].join(" ")}
            >
              <span aria-hidden="true" className="font-bold">
                {met ? "✓" : "•"}
              </span>
              {t(rule.label)}
              {/* Состояние правила словом, а не только цветом и значком: цвет
                сам по себе не доступен, а "✓" читается вслух как попало. */}
              <span className="sr-only">{met ? t(" — выполнено") : t(" — пока нет")}</span>
            </li>
          );
        },
      )}
    </ul>
  );
}
