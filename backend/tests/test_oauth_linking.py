"""Связывание Google-аккаунта с уже существующим локальным.

fastapi-users, найдя локального пользователя с тем же адресом, привязывает к
нему OAuth-аккаунт, не спрашивая, подтверждён ли тот. В связке с тем, что
подтверждение адреса в проде не работает (RESEND_API_KEY пуст) и `is_verified`
нигде не гейтит вход, это классический pre-hijack: злоумышленник заранее
регистрирует парольный аккаунт на чужой адрес, а когда владелец адреса позже
входит через Google, его вход приземляется в аккаунт злоумышленника.

Проверяем оба замка: сторону Google (`email_verified`) и НАШУ сторону
(подтверждён ли локальный аккаунт).
"""

import uuid
from typing import Any

import pytest
from fastapi_users.exceptions import UserAlreadyExists
from sqlalchemy.exc import IntegrityError

from app.services import auth as auth_service
from app.services.auth import UserManager, password_helper


class FakeUser:
    def __init__(self, *, is_verified: bool, oauth_names: tuple[str, ...] = ()) -> None:
        self.id = uuid.uuid4()
        self.email = "victim@example.com"
        self.is_verified = is_verified
        self.handle = "victim"
        self.oauth_accounts = [type("A", (), {"oauth_name": n})() for n in oauth_names]


class FakeSession:
    """Stub of the `AsyncSession` `UserManager` stashes for the race-guard —
    only `rollback()` is ever called on it from the paths these tests hit.
    """

    async def rollback(self) -> None:
        pass


class FakeUserDb:
    """Ровно та часть базы, которую трогает проверка.

    `session` менеджер забирает в конструкторе (для race-guard в `update()`);
    к OAuth-пути она отношения не имеет, поэтому достаточно заглушки.
    """

    def __init__(self, existing: FakeUser | None, *, fail_updates: int = 0) -> None:
        self.existing = existing
        self.session = FakeSession()
        # How many `update()` calls should raise `IntegrityError` (simulating
        # a `handle` collision) before succeeding — see
        # `test_oauth_handle_collision_falls_back_to_a_suffix`.
        self._fail_updates = fail_updates

    async def get_by_email(self, email: str) -> FakeUser | None:
        return self.existing

    async def update(self, user: FakeUser, data: dict[str, Any]) -> FakeUser:
        if self._fail_updates > 0:
            self._fail_updates -= 1
            raise IntegrityError("update", {}, Exception("uq_user_handle_lower"))
        for k, v in data.items():
            setattr(user, k, v)
        return user


def manager(existing: FakeUser | None, *, fail_updates: int = 0) -> UserManager:
    return UserManager(  # type: ignore[arg-type]
        FakeUserDb(existing, fail_updates=fail_updates), password_helper
    )


@pytest.fixture(autouse=True)
def google_says_verified(monkeypatch: pytest.MonkeyPatch) -> None:
    """По умолчанию Google подтверждает адрес — иначе проверялся бы первый замок."""

    async def _verified(access_token: str) -> bool:
        return True

    monkeypatch.setattr(auth_service, "google_email_verified", _verified)


async def call(mgr: UserManager) -> Any:
    return await mgr.oauth_callback(
        "google",
        "token",
        "google-account-id",
        "victim@example.com",
        associate_by_email=True,
        is_verified_by_default=True,
    )


async def test_refuses_to_link_to_an_unverified_local_account() -> None:
    """Тот самый захват: аккаунт заведён кем-то на чужой адрес и не подтверждён."""
    with pytest.raises(UserAlreadyExists):
        await call(manager(FakeUser(is_verified=False)))


async def test_links_to_a_verified_local_account(monkeypatch: pytest.MonkeyPatch) -> None:
    """Подтверждённый аккаунт — владение адресом уже доказано, связывать можно."""
    existing = FakeUser(is_verified=True)
    called: dict[str, Any] = {}

    async def fake_super(self: UserManager, *args: Any, **kwargs: Any) -> FakeUser:
        called.update(kwargs)
        return existing

    monkeypatch.setattr("fastapi_users.BaseUserManager.oauth_callback", fake_super)
    user = await call(manager(existing))
    assert user is existing
    assert called["associate_by_email"] is True


async def test_repeat_sign_in_of_an_already_linked_account_is_not_blocked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Повторный вход — не связывание.

    Аккаунт уже привязан к этому провайдеру, значит владение адресом доказано
    тем же способом, что и в прошлый раз. Блокировать его из-за неподтверждённого
    `is_verified` значило бы запереть человека снаружи его же аккаунта.
    """
    existing = FakeUser(is_verified=False, oauth_names=("google",))

    async def fake_super(self: UserManager, *args: Any, **kwargs: Any) -> FakeUser:
        return existing

    monkeypatch.setattr("fastapi_users.BaseUserManager.oauth_callback", fake_super)
    assert await call(manager(existing)) is existing


async def test_new_address_is_created_as_usual(monkeypatch: pytest.MonkeyPatch) -> None:
    """Никакого локального аккаунта нет — обычная регистрация через Google."""
    created = FakeUser(is_verified=True)
    created.handle = ""

    async def fake_super(self: UserManager, *args: Any, **kwargs: Any) -> FakeUser:
        return created

    monkeypatch.setattr("fastapi_users.BaseUserManager.oauth_callback", fake_super)
    user = await call(manager(None))
    # Хэндл выводится из адреса при первой регистрации через OAuth.
    assert user.handle == "victim"


async def test_google_saying_unverified_disables_association(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Первый замок: Google не подтвердил адрес — связывать нельзя вообще."""

    async def _unverified(access_token: str) -> bool:
        return False

    monkeypatch.setattr(auth_service, "google_email_verified", _unverified)
    existing = FakeUser(is_verified=True)
    called: dict[str, Any] = {}

    async def fake_super(self: UserManager, *args: Any, **kwargs: Any) -> FakeUser:
        called.update(kwargs)
        return existing

    monkeypatch.setattr("fastapi_users.BaseUserManager.oauth_callback", fake_super)
    await call(manager(existing))
    assert called["associate_by_email"] is False
    assert called["is_verified_by_default"] is False


async def test_oauth_handle_collision_falls_back_to_a_suffix(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`handle` is unique now — two OAuth sign-ups can derive the same
    local-part (e.g. "victim@gmail.com" and "victim@yahoo.com" both derive
    "victim"). The first `user_db.update()` losing that race must not fail
    the login: `oauth_callback` retries once with a suffix built from the
    row's own id, which can never collide with itself.
    """
    created = FakeUser(is_verified=True)
    created.handle = ""  # fresh OAuth row — handle not derived yet

    async def fake_super(self: UserManager, *args: Any, **kwargs: Any) -> FakeUser:
        return created

    monkeypatch.setattr("fastapi_users.BaseUserManager.oauth_callback", fake_super)
    mgr = manager(None, fail_updates=1)  # first update() call raises IntegrityError
    user = await call(mgr)

    assert user.handle is not None
    assert user.handle.startswith("victim-")
    assert user.handle.endswith(created.id.hex[:8])
