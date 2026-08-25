"""avatar_url String(512) -> Text — разрешить загруженное фото как data-URL

Revision ID: 0017_avatar_text
Revises: 0016_chat_email
Create Date: 2026-08-25

Владелец захотел загружать аватар ФАЙЛОМ с компьютера, а не только ссылкой.
Файл ужимается на клиенте в маленький data-URL (~несколько КБ), но даже он не
влезал в String(512). Расширяем колонку до Text; схема ограничивает размер
сверху (см. app.schemas.user.UserUpdate.avatar_url).

Одно изменение типа колонки, данные не трогаются (расширение, не сужение).
Проверить `alembic upgrade head` / `downgrade -1` / `upgrade head` на Postgres.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0017_avatar_text"
down_revision: str | None = "0016_chat_email"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "user",
        "avatar_url",
        existing_type=sa.String(length=512),
        type_=sa.Text(),
        existing_nullable=True,
    )


def downgrade() -> None:
    # Сужение: значения длиннее 512 усечёт Postgres — приемлемо для отката.
    op.alter_column(
        "user",
        "avatar_url",
        existing_type=sa.Text(),
        type_=sa.String(length=512),
        existing_nullable=True,
    )
