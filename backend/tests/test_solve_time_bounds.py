"""The solve-time ceiling, on every path that writes one.

`time_ms` lands in a signed 32-bit INTEGER column in all four tables, so a
value above 2 147 483 647 cannot be stored. Without an upper bound in the
schema, pydantic waves it through and the failure surfaces in the driver:
a 500 on the REST endpoints, and — far worse — an exception inside the duel
room's `_finalize`, thrown after the phase has already flipped to finished,
which used to leave the room and both participants `active` forever.

The bound is therefore asserted here for every schema at once: a ceiling that
holds in three places out of four is not a ceiling.
"""

import pytest
from pydantic import ValidationError

from app.schemas.daily import DailyAttemptSubmit
from app.schemas.duel import WsFinishIn
from app.schemas.limits import MAX_SOLVE_MS
from app.schemas.solve import SolveCreate
from app.schemas.tournament import TournamentAttemptSubmit

# Обязано остаться внутри знакового INTEGER — иначе граница не защищает
# ничего, а только сдвигает место падения.
INT32_MAX = 2**31 - 1


def test_ceiling_fits_in_a_signed_integer_column() -> None:
    assert MAX_SOLVE_MS < INT32_MAX


@pytest.mark.parametrize(
    "build",
    [
        pytest.param(
            lambda ms: SolveCreate(scramble="R U R'", time_ms=ms),
            id="solve",
        ),
        pytest.param(lambda ms: WsFinishIn(type="finish", time_ms=ms), id="duel-ws-finish"),
        pytest.param(lambda ms: TournamentAttemptSubmit(time_ms=ms), id="tournament"),
        pytest.param(lambda ms: DailyAttemptSubmit(time_ms=ms), id="daily"),
    ],
)
class TestSolveTimeBounds:
    def test_rejects_a_value_that_would_overflow_the_column(self, build) -> None:  # type: ignore[no-untyped-def]
        # Ровно тот кадр из ревью: 3 000 000 000 мс проходит `gt=0` и валит запись.
        with pytest.raises(ValidationError):
            build(3_000_000_000)

    def test_rejects_just_above_the_ceiling(self, build) -> None:  # type: ignore[no-untyped-def]
        with pytest.raises(ValidationError):
            build(MAX_SOLVE_MS + 1)

    def test_accepts_the_ceiling_itself(self, build) -> None:  # type: ignore[no-untyped-def]
        assert build(MAX_SOLVE_MS).time_ms == MAX_SOLVE_MS

    def test_still_rejects_zero_and_negative(self, build) -> None:  # type: ignore[no-untyped-def]
        with pytest.raises(ValidationError):
            build(0)
        with pytest.raises(ValidationError):
            build(-1)

    def test_accepts_an_ordinary_solve(self, build) -> None:  # type: ignore[no-untyped-def]
        assert build(12_345).time_ms == 12_345
