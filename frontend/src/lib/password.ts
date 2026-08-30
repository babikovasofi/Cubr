// Правила пароля на стороне фронта — ровно те же, что у сервера в
// `backend/app/services/password_policy.py`, и в ОДНОМ месте.
//
// Зачем дублировать серверную политику: человек должен видеть требования и
// свой прогресс по ним ПОКА ПЕЧАТАЕТ, а не узнавать их по одной ошибке за
// отправку. Сервер остаётся единственным, кто решает: этот модуль ничего не
// разрешает, он только подсказывает. Список частых паролей сюда намеренно не
// тянется (~250 строк данных ради подсказки) — эту проверку делает только
// сервер, и её нет в чек-листе, чтобы не обещать того, что фронт не знает.
//
// `PASSWORD_MIN_LENGTH` обязан совпадать с `MIN_LENGTH` бэкенда; сторожит
// `tests/lib/password.test.ts`, читающий число прямо из python-файла.

export const PASSWORD_MIN_LENGTH = 10;

export interface PasswordRule {
  /** Стабильный ключ для React-списка и тестов. */
  id: string;
  /** Текст правила — короткий, в утвердительной форме. */
  label: string;
  /** Выполнено ли правило для введённого пароля. */
  met: (password: string, identity: PasswordIdentity) => boolean;
  /**
   * Правило проверяемо только когда известны почта/ник. Там, где их нет
   * (сброс пароля по ссылке из письма — сессии ещё нет), правило скрывается:
   * вечная зелёная галочка на непроверенном условии врёт сильнее, чем её
   * отсутствие. Сервер проверит его в любом случае.
   */
  requiresIdentity?: boolean;
}

export interface PasswordIdentity {
  email?: string;
  handle?: string;
}

function identityValues({ email, handle }: PasswordIdentity): string[] {
  const values: string[] = [];
  const emailLower = email?.trim().toLowerCase();
  if (emailLower) {
    values.push(emailLower);
    const local = emailLower.split("@")[0];
    if (local) values.push(local);
  }
  const handleLower = handle?.trim().toLowerCase();
  if (handleLower) values.push(handleLower);
  return values;
}

export function hasIdentity({ email, handle }: PasswordIdentity): boolean {
  return Boolean(email?.trim() || handle?.trim());
}

export const PASSWORD_RULES: readonly PasswordRule[] = [
  {
    id: "length",
    label: `Не короче ${PASSWORD_MIN_LENGTH} символов`,
    met: (password) => password.length >= PASSWORD_MIN_LENGTH,
  },
  {
    id: "identity",
    label: "Не повторяет почту или ник",
    requiresIdentity: true,
    met: (password, identity) => {
      // Пустой пароль не выполняет ни одного правила: на нетронутой форме
      // чек-лист весь серый, а не наполовину пройденный.
      if (!password) return false;
      return !identityValues(identity).includes(password.toLowerCase());
    },
  },
];

/** Одна строка над чек-листом: что вообще считается хорошим паролем. */
export const PASSWORD_HINT =
  "Проще всего — несколько случайных слов подряд: «синий чайник шагает». Заглавные, цифры и знаки не обязательны.";
