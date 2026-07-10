// Single entry point for every backend call (plan §B). All requests go to the
// relative `/api` base with `credentials:"include"` so the httpOnly `cubr_auth`
// cookie rides along (JS can never read it — see authStore.bootstrap).
//
// Error shape (skeptic MED): fastapi-users returns `detail` as EITHER a bare
// string code ("LOGIN_BAD_CREDENTIALS") OR an object `{code, reason}`
// (REGISTER_INVALID_PASSWORD). We normalise both into ApiError and NEVER let an
// object reach the UI as "[object Object]".

const BASE = "/api";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, code: string | null, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

// Russian copy per fastapi-users error code + rate-limit (429).
const RU_BY_CODE: Record<string, string> = {
  LOGIN_BAD_CREDENTIALS: "Неверная почта или пароль.",
  LOGIN_USER_NOT_VERIFIED: "Почта не подтверждена. Проверь письмо или запроси новое.",
  REGISTER_USER_ALREADY_EXISTS: "Пользователь с такой почтой уже зарегистрирован.",
  REGISTER_INVALID_PASSWORD: "Пароль слишком простой. Минимум 8 символов.",
  RESET_PASSWORD_BAD_TOKEN: "Ссылка сброса недействительна или устарела. Запроси новую.",
  VERIFY_USER_BAD_TOKEN: "Ссылка подтверждения недействительна или устарела.",
  VERIFY_USER_ALREADY_VERIFIED: "Почта уже подтверждена. Можно входить.",
  CUBE_LIMIT: "Достигнут лимит: можно хранить не больше 5 кубиков. Удали лишний, чтобы добавить новый.",
};

const RU_BY_STATUS: Record<number, string> = {
  429: "Слишком много попыток. Подожди немного и попробуй снова.",
  0: "Не удалось связаться с сервером. Проверь интернет.",
};

const RU_FALLBACK = "Что-то пошло не так. Попробуй ещё раз.";

interface RawDetail {
  code?: unknown;
  reason?: unknown;
}

// Pull a { code, humanMessage } pair out of an already-parsed error body.
export function parseErrorBody(
  status: number,
  body: unknown,
): { code: string | null; message: string } {
  let code: string | null = null;
  let reason: string | null = null;

  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") {
    code = detail;
  } else if (detail && typeof detail === "object") {
    const d = detail as RawDetail;
    if (typeof d.code === "string") code = d.code;
    if (typeof d.reason === "string") reason = d.reason;
  }

  const message =
    (code && RU_BY_CODE[code]) ??
    RU_BY_STATUS[status] ??
    reason ??
    RU_FALLBACK;

  return { code, message };
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  /** JSON body — serialised and sent as application/json. */
  json?: unknown;
  /** Form body — sent as application/x-www-form-urlencoded (login only). */
  form?: Record<string, string>;
  signal?: AbortSignal;
}

// Returns parsed JSON, or `undefined` for 204/empty bodies. Throws ApiError on
// any non-2xx (or network failure).
export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;

  if (opts.form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(opts.form).toString();
  } else if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.json);
  }

  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method: opts.method ?? (body ? "POST" : "GET"),
      credentials: "include",
      headers,
      body,
      signal: opts.signal,
    });
  } catch {
    throw new ApiError(0, null, RU_BY_STATUS[0]);
  }

  if (!res.ok) {
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      // no/invalid JSON body (e.g. 429 from the rate limiter) — status wins
    }
    const { code, message } = parseErrorBody(res.status, parsed);
    throw new ApiError(res.status, code, message);
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}
