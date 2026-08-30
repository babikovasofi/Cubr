"""Server-side password policy — the ONLY thing enforcing password strength.

Before this, the registration form's HTML `minLength={8}` was a browser
hint any direct request skips; `UserManager.validate_password` was never
overridden, so fastapi-users' base implementation (a no-op) accepted
anything, including `"1"`.

Five rules, applied whenever a password is SET (register / reset-password /
`PATCH /users/me`) — never on login. Existing accounts with old weak
passwords must keep logging in; `BaseUserManager.authenticate` never calls
`validate_password` (only `create`/`_update` do), so that is already true
for free — see `tests/test_password_policy.py`.

1. Minimum length 10. Deliberately NOT "one uppercase, one digit, one
   symbol" — composition rules train people into predictable patterns like
   `Password1!`, and NIST SP 800-63B dropped them for exactly that reason.
2. Reject common passwords (`app.services.common_passwords`, data only).
3. Reject a password equal to the account's email, the email's local part,
   or its handle (case-insensitive) — trivial to guess from a leak.
4. Maximum length 128 — a server-cost control. Argon2 is configured
   m=64MB/t=3/p=4; a multi-megabyte password is a cheap way to burn
   memory+CPU on a 1-core/2GB box.
5. (Login attempts, not this module) — see `app.services.ratelimit`.

Error codes travel to the SPA the same way fastapi-users already does for
password errors: `UserManager.validate_password` raises
`InvalidPasswordException(reason=...)`, and the stock register/reset/update
routers catch that and answer `400 {"code": "<ENDPOINT>_INVALID_PASSWORD",
"reason": <this module's Russian text>}` — never a bare 422 for a password
problem. See `app.services.auth.UserManager.validate_password`.
"""

from dataclasses import dataclass

from app.services.common_passwords import COMMON_PASSWORDS

CODE_TOO_SHORT = "PASSWORD_TOO_SHORT"
CODE_TOO_LONG = "PASSWORD_TOO_LONG"
CODE_TOO_COMMON = "PASSWORD_TOO_COMMON"
CODE_MATCHES_IDENTITY = "PASSWORD_MATCHES_IDENTITY"

MIN_LENGTH = 10
MAX_LENGTH = 128


@dataclass(frozen=True)
class PasswordRejection:
    """Why a password was refused. ``reason`` is user-facing Russian copy."""

    code: str
    reason: str


def _identity_values(email: str | None, handle: str | None) -> list[str]:
    values: list[str] = []
    if email:
        email_lower = email.strip().casefold()
        if email_lower:
            values.append(email_lower)
            local_part = email_lower.split("@", 1)[0]
            if local_part:
                values.append(local_part)
    if handle:
        handle_lower = handle.strip().casefold()
        if handle_lower:
            values.append(handle_lower)
    return values


def check_password_policy(
    password: str,
    *,
    email: str | None = None,
    handle: str | None = None,
) -> PasswordRejection | None:
    """Return why ``password`` is unacceptable, or ``None`` if it is fine."""
    if len(password) < MIN_LENGTH:
        return PasswordRejection(
            CODE_TOO_SHORT,
            f"Такой пароль легко подобрать: он короче {MIN_LENGTH} символов. "
            "Возьми несколько случайных слов подряд.",
        )
    if len(password) > MAX_LENGTH:
        return PasswordRejection(
            CODE_TOO_LONG, f"Пароль слишком длинный: максимум {MAX_LENGTH} символов."
        )

    lowered = password.casefold()

    if lowered in COMMON_PASSWORDS:
        return PasswordRejection(
            CODE_TOO_COMMON,
            "Такой пароль легко подобрать: он входит в список самых частых "
            "паролей, которые перебирают первыми. Придумай другой.",
        )

    if lowered in _identity_values(email, handle):
        return PasswordRejection(
            CODE_MATCHES_IDENTITY,
            "Такой пароль легко подобрать: он совпадает с твоей почтой или "
            "ником, а их видно другим. Придумай другой.",
        )

    return None
