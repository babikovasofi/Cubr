"""user.onboarded_at — признак «онбординг пройден» переезжает на сервер

Revision ID: 0012_onboarded_at
Revises: 0011_friendships
Create Date: 2026-08-20

HAND-WRITTEN (Docker/Postgres недоступны для `alembic revision --autogenerate`
на момент написания). Одна nullable-колонка на `user`, больше ничего.

Признак жил в localStorage браузера (`cubr_onboarded`), то есть отвечал на
вопрос «показывали ли в ЭТОМ браузере», а не «проходил ли ЭТОТ человек».
Живые последствия: первый вход нового аккаунта в браузере, где онбординг уже
проходили, молча уезжал на главную; тот же человек со второго устройства
получал онбординг заново.

БЕЗ backfill намеренно. Проставить всем существующим «пройдено» значило бы
соврать про тех, кто не проходил; проставить NULL всем — прогнать по шагам
тех, кто прошёл. Существующие переносятся мягко, на стороне клиента: у кого
локальный флаг стоит, а серверный пуст, фронт один раз зовёт
`POST /users/me/onboarded` и переносит признак сам (см. auth/onboarding.ts).

Verify with `alembic upgrade head` against Postgres before deploy.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0012_onboarded_at"
down_revision: str | None = "0011_friendships"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("user", sa.Column("onboarded_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("user", "onboarded_at")
