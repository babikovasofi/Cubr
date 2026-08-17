"""Name filter (Stage 6). Two failure modes matter equally: a slur that slips
through onto a public board, and a false positive that bans "Александр"."""

import pytest

from app.services.moderation import (
    CODE_INVALID_CHARS,
    CODE_NOT_ALLOWED,
    CODE_RESERVED,
    CODE_TOO_SHORT,
    check_display_name,
    sanitize_derived_nickname,
)

CLEAN = [
    "Александр",
    "Ребята",
    "скипидар",
    "мандарин",
    "суккуб",
    "Херсон",
    "Мандельштам",
    "барсуки",
    "застрахуй",
    "night",
    "Nigeria",
    "Nigerian",
    "Nightingale",
    "grape",
    "Dickens",
    "Assassin",
    "жидкость",
    "хачапури",
    "Нигерия",
    "speedcuber",
    "Феликс Зимдарс",
    "cube-master_99",
    "Ю",  # одна буква — отсекается длиной, не фильтром (см. отдельный тест)
    "Ан",
    "j.perm",
    "Тимур 3x3",
]


@pytest.mark.parametrize("name", [n for n in CLEAN if len(n) >= 2])
def test_clean_names_pass(name: str) -> None:
    assert check_display_name(name) is None


@pytest.mark.parametrize(
    "name",
    [
        "хуйло",
        "пиздец",
        "мудак",
        "ЕбАнУтЫй",
        "бляди",
        "пидорас",
        "сука",
        "гандон",
        "залупа",
        "дрочер",
        "fuck you",
        "shithead",
        "bitchy",
        "niggers",
        "faggot",
        "Adolf Hitler",
    ],
)
def test_profanity_is_rejected(name: str) -> None:
    rejection = check_display_name(name)
    assert rejection is not None and rejection.code == CODE_NOT_ALLOWED


@pytest.mark.parametrize(
    "name",
    [
        "xyilo",  # латиница вместо кириллицы (x→х, y→у, i… ) — «хуйло»
        "п1здец",  # leet-цифра вместо буквы
        "п.и.з.д.е.ц",  # разделители
        "пииииздец",  # растянутые буквы
        "f_u_c_k",
        "fuсk",  # смешанный алфавит: латиница + кириллическая «с»
        "sh1t",
        "pizdec",  # русский мат латиницей
        "blyad",
        "SUKA blyat",
    ],
)
def test_obfuscated_profanity_is_rejected(name: str) -> None:
    rejection = check_display_name(name)
    assert rejection is not None and rejection.code == CODE_NOT_ALLOWED


@pytest.mark.parametrize(
    "name",
    ["жид", "хач", "Хер", "rape", "dick", "нигер"],
)
def test_word_roots_rejected_as_standalone_tokens(name: str) -> None:
    rejection = check_display_name(name)
    assert rejection is not None and rejection.code == CODE_NOT_ALLOWED


@pytest.mark.parametrize(
    "name",
    ["admin", "ADMIN", "Администратор", "поддержка", "cubr", "судья", "moderator"],
)
def test_reserved_names_rejected(name: str) -> None:
    rejection = check_display_name(name)
    assert rejection is not None and rejection.code == CODE_RESERVED


@pytest.mark.parametrize(
    "name",
    [
        "куб🔥",  # эмодзи
        "cub​er",  # zero-width space — типовой обход
        "‮cuber",  # RTL override — impersonation
        "1234",  # ни одной буквы
        "$$$$",
        "😀😀",  # только эмодзи
        "​​​",  # только zero-width space (не whitespace для str.strip — не отсекается длиной)
        "...",  # только пунктуация — точки разрешены символьно, но без единой буквы
        "---",  # только дефисы
        "___",  # только подчёркивания
    ],
)
def test_charset_rejected(name: str) -> None:
    rejection = check_display_name(name)
    assert rejection is not None and rejection.code == CODE_INVALID_CHARS


def test_too_short() -> None:
    rejection = check_display_name("я")
    assert rejection is not None and rejection.code == CODE_TOO_SHORT


@pytest.mark.parametrize("name", [None, ""])
def test_empty_is_allowed(name: str | None) -> None:
    # Ник и публичное имя необязательны; очистка поля — легальное действие.
    assert check_display_name(name) is None


@pytest.mark.parametrize(
    "name",
    [
        "   ",  # обычные пробелы
        " ",
        "\t\t",  # табы
        "\n\n",  # переводы строк
        "\xa0\xa0\xa0",  # неразрывный пробел (NBSP) — тоже whitespace для str.strip()
        "  \t \xa0 ",  # смесь
    ],
)
def test_whitespace_only_name_rejected(name: str) -> None:
    # В отличие от "" (явная очистка поля), непустая строка, состоящая
    # только из пробельных символов, — это ввод пользователя, а не очистка:
    # после normalize она короче MIN_LENGTH, так что код тот же, что и у
    # любого другого слишком короткого имени.
    rejection = check_display_name(name)
    assert rejection is not None and rejection.code == CODE_TOO_SHORT


def test_sanitize_derived_nickname_falls_back_instead_of_failing() -> None:
    # OAuth-редирект нельзя ронять 400-кой из-за грубого локалпарта почты.
    assert sanitize_derived_nickname("pizdec") == "cuber"
    assert sanitize_derived_nickname("admin") == "cuber"
    assert sanitize_derived_nickname("feliks") == "feliks"
