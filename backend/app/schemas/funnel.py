from datetime import datetime

from pydantic import BaseModel


class FunnelRead(BaseModel):
    """Aggregate funnel counters (Stage 6, "минимальная аналитика воронки").

    Counts ONLY — no email, handle, id or IP ever appears here (П10). Every
    number is derived from rows the product already writes; nothing is tracked
    for analytics' own sake, and there is no third-party tracker (the public
    landing page promises exactly that).

    This is a funnel of *states*, not *events*: it answers "did they ever do X",
    not "where did they drop off inside the ritual".
    """

    users_total: int
    users_verified: int
    users_with_cube: int
    users_with_solve: int
    users_with_tournament: int
    users_with_daily: int
    users_with_duel: int

    solves_total: int
    duels_finished: int

    signups_7d: int
    signups_30d: int
    active_7d: int

    generated_at: datetime
