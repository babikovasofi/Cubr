"""Unit tests for `app.services.password_policy.check_password_policy`.

Pure function, no app/DB needed — integration coverage (register/reset wired
through fastapi-users, plus the per-account login limiter) lives in
`tests/test_auth.py`.
"""

from app.services.password_policy import (
    CODE_MATCHES_IDENTITY,
    CODE_TOO_COMMON,
    CODE_TOO_LONG,
    CODE_TOO_SHORT,
    MAX_LENGTH,
    MIN_LENGTH,
    check_password_policy,
)

# A password that passes every rule, used as the "everything else is fine"
# baseline in tests that only care about one specific rule.
_OK_PASSWORD = "correct-horse-battery-staple"


# --- rule 1: minimum length --------------------------------------------------


def test_password_below_min_length_rejected() -> None:
    rejection = check_password_policy("a" * (MIN_LENGTH - 1))
    assert rejection is not None
    assert rejection.code == CODE_TOO_SHORT


def test_password_at_min_length_boundary_accepted() -> None:
    assert MIN_LENGTH == 10
    assert check_password_policy("a" * MIN_LENGTH) is None


def test_password_one_below_min_length_boundary_rejected() -> None:
    assert check_password_policy("a" * (MIN_LENGTH - 1)) is not None


def test_password_does_not_require_composition_rules() -> None:
    # No "must contain uppercase/digit/symbol" — NIST 800-63B, see module
    # docstring. A long lowercase-only phrase must pass.
    assert check_password_policy("allsimplewordsnoupper") is None


# --- rule 2: reject common passwords ----------------------------------------


def test_common_password_examples_all_rejected() -> None:
    # The exact repro from the bug report ('password' among them) — some of
    # these are also short enough to be caught by the length rule first, but
    # every one of them must come back rejected either way.
    for candidate in ("password", "qwerty123", "12345678", "letmein", "йцукен", "parol"):
        assert check_password_policy(candidate) is not None, candidate


def test_common_password_rejected_even_when_long_enough_to_pass_length() -> None:
    # >= MIN_LENGTH on their own, so this isolates the common-password rule
    # from the length rule (order-of-checks: length would otherwise mask it).
    for candidate in ("1234567890", "qwertyuiop", "парольпароль", "parolparol"):
        assert len(candidate) >= MIN_LENGTH, candidate
        rejection = check_password_policy(candidate)
        assert rejection is not None, candidate
        assert rejection.code == CODE_TOO_COMMON, candidate


def test_common_password_check_is_case_insensitive() -> None:
    rejection = check_password_policy("QwErTyUiOp")
    assert rejection is not None
    assert rejection.code == CODE_TOO_COMMON


def test_uncommon_password_accepted() -> None:
    assert check_password_policy(_OK_PASSWORD) is None


# --- rule 3: reject password == email / local-part / handle --------------


def test_password_equal_to_email_rejected() -> None:
    rejection = check_password_policy("cuber@example.com", email="cuber@example.com", handle=None)
    assert rejection is not None
    assert rejection.code == CODE_MATCHES_IDENTITY


def test_password_equal_to_email_local_part_rejected() -> None:
    rejection = check_password_policy("cuberperson", email="cuberperson@example.com")
    assert rejection is not None
    assert rejection.code == CODE_MATCHES_IDENTITY


def test_password_equal_to_handle_rejected() -> None:
    rejection = check_password_policy(
        "SpeedCuber", email="unrelated@example.com", handle="speedcuber"
    )
    assert rejection is not None
    assert rejection.code == CODE_MATCHES_IDENTITY


def test_password_matching_identity_check_is_case_insensitive() -> None:
    rejection = check_password_policy("CUBER@EXAMPLE.COM", email="cuber@example.com")
    assert rejection is not None
    assert rejection.code == CODE_MATCHES_IDENTITY


def test_password_different_from_identity_accepted() -> None:
    assert (
        check_password_policy(_OK_PASSWORD, email="cuber@example.com", handle="speedcuber") is None
    )


# --- rule 4: maximum length --------------------------------------------------


def test_password_above_max_length_rejected() -> None:
    rejection = check_password_policy("a" * (MAX_LENGTH + 1))
    assert rejection is not None
    assert rejection.code == CODE_TOO_LONG


def test_password_at_max_length_boundary_accepted() -> None:
    assert MAX_LENGTH == 128
    assert check_password_policy("a" * MAX_LENGTH) is None


def test_password_one_above_max_length_boundary_rejected() -> None:
    assert check_password_policy("a" * (MAX_LENGTH + 1)) is not None


# --- reason text is human-readable Russian, never blank ---------------------


def test_every_rejection_carries_a_russian_reason() -> None:
    cases = [
        check_password_policy("short"),
        check_password_policy("a" * (MAX_LENGTH + 1)),
        check_password_policy("password"),
        check_password_policy("cuber@example.com", email="cuber@example.com"),
    ]
    for rejection in cases:
        assert rejection is not None
        assert rejection.reason
        assert rejection.reason[0].isupper()
