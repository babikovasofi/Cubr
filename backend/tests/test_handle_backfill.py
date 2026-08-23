"""Unit tests for `app.services.handle_backfill` — the LOGIC behind the
`0013_single_user_handle` data migration (merging `nickname` +
`public_handle` into one `handle`). Pure functions, no DB needed; the full
`alembic upgrade head` / `downgrade -1` / `upgrade head` round-trip against
a real Postgres (including on an EMPTY database) is covered separately by
`tests/test_migrations.py` (opt-in via `MIGRATION_TEST_DATABASE_URL`).
"""

from app.services.handle_backfill import (
    MAX_LENGTH,
    dedupe_handle,
    derive_handle,
    sanitize_handle_chars,
)


class TestSanitizeHandleChars:
    def test_strips_disallowed_characters(self) -> None:
        assert sanitize_handle_chars("Cube🔥Master") == "CubeMaster"

    def test_collapses_whitespace_and_trims(self) -> None:
        assert sanitize_handle_chars("  Speed   Cuber  ") == "Speed Cuber"

    def test_keeps_allowed_punctuation(self) -> None:
        assert sanitize_handle_chars("cube_master-99.pro") == "cube_master-99.pro"

    def test_all_disallowed_yields_empty(self) -> None:
        assert sanitize_handle_chars("🔥🔥🔥") == ""


class TestDeriveHandle:
    def test_prefers_public_handle_when_set(self) -> None:
        assert derive_handle("SomeNickname", "MyPublicHandle") == "MyPublicHandle"

    def test_falls_back_to_nickname_sanitised(self) -> None:
        # "приводя к допустимым символам": emoji dropped, whitespace collapsed.
        assert derive_handle("Cube 🔥 Master", None) == "Cube Master"

    def test_public_handle_itself_sanitised_defensively(self) -> None:
        assert derive_handle(None, "Weird🔥Handle") == "WeirdHandle"

    def test_neither_set_returns_none(self) -> None:
        assert derive_handle(None, None) is None

    def test_both_sanitise_to_nothing_returns_none(self) -> None:
        assert derive_handle("🔥🔥", "🎉🎉") is None

    def test_nickname_too_short_after_sanitising_returns_none(self) -> None:
        # A single surviving character is below MIN_LENGTH (2).
        assert derive_handle("🔥x🔥", None) is None

    def test_truncates_to_max_length(self) -> None:
        long_handle = "a" * 100
        result = derive_handle(None, long_handle)
        assert result is not None
        assert len(result) == MAX_LENGTH


class TestDedupeHandle:
    def test_returns_candidate_unchanged_when_free(self) -> None:
        assert dedupe_handle("cube", set()) == "cube"

    def test_appends_suffix_on_collision(self) -> None:
        assert dedupe_handle("cube", {"cube"}) == "cube2"

    def test_collision_is_case_insensitive(self) -> None:
        assert dedupe_handle("Cube", {"cube"}) == "Cube2"

    def test_walks_past_multiple_collisions(self) -> None:
        taken = {"cube", "cube2", "cube3"}
        assert dedupe_handle("cube", taken) == "cube4"

    def test_does_not_mutate_taken_set(self) -> None:
        taken = {"cube"}
        dedupe_handle("cube", taken)
        assert taken == {"cube"}

    def test_respects_max_length_with_suffix(self) -> None:
        candidate = "a" * MAX_LENGTH
        result = dedupe_handle(candidate, {candidate.lower()})
        assert len(result) <= MAX_LENGTH
        assert result.lower() == ("a" * (MAX_LENGTH - 1)) + "2"
