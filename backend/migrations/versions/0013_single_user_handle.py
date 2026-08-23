"""merge user.nickname + user.public_handle into a single user.handle

Revision ID: 0013_single_user_handle
Revises: 0012_onboarded_at
Create Date: 2026-08-24

HAND-WRITTEN (mirrors 0011_friendships/0012_onboarded_at's style; Docker/
Postgres unavailable to `alembic revision --autogenerate` at authoring
time). Product decision: a user had TWO names — a private ``nickname`` and
a separate opt-in-public ``public_handle`` used for "add a friend by
handle" and the tournament/daily boards — and people found this confusing
("Хэндл друга" read as something unrelated to their own name). From now on
there is exactly ONE name, ``user.handle``, unique case-insensitively, used
everywhere (own header, friends, tournament/daily boards). Shown with a
leading "@" — a frontend rendering concern; the stored value carries no "@".

THIS RUNS AGAINST A LIVE DATABASE WITH EXISTING USERS (cubr-game.ru), so the
data carry-over is the point of this migration, not an afterthought:

* ``public_handle`` set -> becomes ``handle`` as-is (character-sanitised
  defensively, though it was already validated at write time).
* ``public_handle`` unset, ``nickname`` set -> ``handle`` is derived from
  ``nickname``, stripped down to the characters a handle is allowed to
  contain (see ``app.services.handle_backfill.sanitize_handle_chars`` — the
  same character class ``app.services.moderation`` enforces on new writes).
* Neither set, or both sanitise to nothing (e.g. an emoji-only nickname) ->
  ``handle`` stays ``NULL``. A migration must not invent an identity for
  someone who never chose a name; this is the same "no handle yet" state a
  fresh password sign-up already has, and the app already renders it as
  "Аноним" on boards (``app.services.tournament.display_name_for``).
* A resulting collision (two rows landing on the same handle
  case-insensitively — e.g. one had ``public_handle="Cube"``, another had
  no handle but ``nickname="cube"``) gets a numeric suffix
  (``app.services.handle_backfill.dedupe_handle``) so the new UNIQUE index
  below can always be created; it never fails or drops data.
* An EMPTY `user` table (fresh dev DB) is a no-op backfill loop, not a
  special case — this migration does not crash on it.

The backfill/dedupe LOGIC lives in ``app.services.handle_backfill`` (unit
tested in ``tests/test_handle_backfill.py``) — this file only wires it to
the rows. See that module's docstring for why it deliberately does NOT run
the profanity/reserved-name filter over legacy data.

Downgrade is HONEST, not a full inverse: the split between "was it
`nickname`" and "was it `public_handle`" is gone the moment they merge, so
downgrading writes the SAME merged value back into both old columns rather
than pretending to recover which was which.

Verify with `alembic upgrade head` against Postgres before deploy. Applying
this to prod is a manual step — see the deploy checklist in the PR/report.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from app.services.handle_backfill import dedupe_handle, derive_handle

# revision identifiers, used by Alembic.
revision: str = "0013_single_user_handle"
down_revision: str | None = "0012_onboarded_at"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("user", sa.Column("handle", sa.String(length=64), nullable=True))

    bind = op.get_bind()
    rows = bind.execute(
        sa.text('SELECT id, nickname, public_handle FROM "user" ORDER BY created_at, id')
    ).fetchall()

    # Case-insensitive dedupe set, built up as rows are assigned — an empty
    # table just means this loop runs zero times.
    taken_lower: set[str] = set()
    for row in rows:
        candidate = derive_handle(row.nickname, row.public_handle)
        if candidate is None:
            continue  # neither field survived -> handle stays NULL
        final = dedupe_handle(candidate, taken_lower)
        taken_lower.add(final.lower())
        bind.execute(
            sa.text('UPDATE "user" SET handle = :handle WHERE id = :id'),
            {"handle": final, "id": row.id},
        )

    # The old partial unique index named public_handle explicitly — drop it
    # before the column it indexes goes away.
    op.drop_index("uq_user_public_handle_lower", table_name="user")
    op.drop_column("user", "nickname")
    op.drop_column("user", "public_handle")

    # Same shape as the index it replaces: partial (`WHERE handle IS NOT
    # NULL`) so any number of handle-less users coexist with no conflict —
    # see `app.models.user`'s docstring.
    op.create_index(
        "uq_user_handle_lower",
        "user",
        [sa.text("lower(handle)")],
        unique=True,
        postgresql_where=sa.text("handle IS NOT NULL"),
    )


def downgrade() -> None:
    op.add_column("user", sa.Column("nickname", sa.String(length=64), nullable=True))
    op.add_column("user", sa.Column("public_handle", sa.String(length=64), nullable=True))

    # Honest, not a true inverse — see module docstring: the merge is lossy,
    # so both old columns get back the SAME value `handle` already held.
    bind = op.get_bind()
    bind.execute(sa.text('UPDATE "user" SET nickname = handle, public_handle = handle'))

    op.drop_index("uq_user_handle_lower", table_name="user")
    op.drop_column("user", "handle")

    op.create_index(
        "uq_user_public_handle_lower",
        "user",
        [sa.text("lower(public_handle)")],
        unique=True,
        postgresql_where=sa.text("public_handle IS NOT NULL"),
    )
