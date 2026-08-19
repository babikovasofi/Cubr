"""`POST /users/me/onboarded`: отметить, что человек прошёл онбординг.

Отдельная ручка, а не поле в `PATCH /users/me`, по двум причинам. Первая:
через `UserUpdate` клиент задавал бы произвольную дату, а это отметка о факте,
не редактируемое свойство профиля. Вторая: ручка идемпотентна — повторный вызов
не двигает уже проставленное время, поэтому фронт может звать её свободно (в
том числе при переносе старого локального флага) и не думать о гонках.

Признак жил в localStorage браузера и потому отвечал на вопрос «показывали ли
в ЭТОМ браузере». Последствия ловились живьём: новый аккаунт в уже
использованном браузере онбординг пропускал, а тот же человек со второго
устройства получал его заново.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import User
from app.schemas.user import UserRead
from app.services.auth import current_active_user
from app.services.friends import now_utc

router = APIRouter(prefix="/users/me", tags=["users"])


@router.post("/onboarded", response_model=UserRead)
async def mark_onboarded(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> User:
    # Идемпотентно: первая отметка выигрывает. Перезаписывать значило бы
    # сдвигать дату при каждом заходе и терять единственное, что она означает —
    # когда человек прошёл онбординг впервые.
    if user.onboarded_at is None:
        user.onboarded_at = now_utc()
        session.add(user)
        await session.commit()
        await session.refresh(user)
    return user
