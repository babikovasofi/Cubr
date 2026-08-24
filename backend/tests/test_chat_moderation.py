"""`moderation.check_message_text` — token-based obscenity filter for chat
message bodies (plan §6). See `app.services.moderation.check_message_text`'s
docstring for why this is NOT `check_display_name` reused wholesale.
"""

import pytest

from app.services.moderation import CODE_MESSAGE_NOT_ALLOWED, check_message_text

CLEAN_SENTENCES = [
    "Привет! Как твои дела сегодня?",
    "Го дуэль через 5 минут, го?",
    "Купил себе новую скипидарную мазь для рук.",
    "Оформил страховку на машину, дорого вышло.",
    "На даче живут барсуки, представляешь.",
    "Съездили в Херсон на выходных.",
    "Читал Мандельштама вчера весь вечер.",
    "Заказал виноград (grape) на рынке.",
    "Обожаю романы Диккенса (Dickens).",
    "Хочешь хачапури на ужин?",
    "В Нигерии (Nigeria) свой стиль спидкубинга.",
    "Ночь (night) была долгая, но соберём кубик.",
    "j.perm и Тимур 3x3 — держим темп!",
    "",
    "   ",
]


@pytest.mark.parametrize("text", CLEAN_SENTENCES)
def test_clean_messages_pass(text: str) -> None:
    assert check_message_text(text) is None


PROFANE_SENTENCES = [
    "ты полное хуйло, отвали",
    "вот это пиздец конечно",
    "он мудак какой-то",
    "да ты бляди начитался",
    "иди ты, пидорас",
    "fuck you and your duel",
    "you're such a bitchy person",
]


@pytest.mark.parametrize("text", PROFANE_SENTENCES)
def test_profanity_in_a_sentence_is_rejected(text: str) -> None:
    rejection = check_message_text(text)
    assert rejection is not None and rejection.code == CODE_MESSAGE_NOT_ALLOWED


OBFUSCATED_SENTENCES = [
    "нафиг п1здец какой",
    "ты просто fuсk знает кто",  # Cyrillic с in "fuсk"
    "sh1t случился на дуэли",
    "ну и pizdec с этим кубиком",
]


@pytest.mark.parametrize("text", OBFUSCATED_SENTENCES)
def test_obfuscated_profanity_in_a_sentence_is_rejected(text: str) -> None:
    rejection = check_message_text(text)
    assert rejection is not None and rejection.code == CODE_MESSAGE_NOT_ALLOWED


WORD_ROOT_SENTENCES = [
    "он реально жид какой-то, не хочу с ним",
    "фу, ну и хач",
    "this guy is a total dick",
]


@pytest.mark.parametrize("text", WORD_ROOT_SENTENCES)
def test_word_roots_rejected_as_standalone_tokens_in_a_sentence(text: str) -> None:
    rejection = check_message_text(text)
    assert rejection is not None and rejection.code == CODE_MESSAGE_NOT_ALLOWED


def test_word_root_substring_inside_a_longer_word_is_not_rejected() -> None:
    """ "жид" is a WORD-only root — it must not fire on "жидкость"/"хачапури"
    even embedded in a sentence (unlike the unambiguous substring roots)."""
    assert check_message_text("налил жидкость в бутылку") is None
    assert check_message_text("взял хачапури с собой") is None
    assert check_message_text("это же просто grape сок") is None


def test_long_free_text_without_any_root_word_passes() -> None:
    """The false-positive guard this filter exists for: a long message
    whose GLUED skeleton might accidentally contain a root, but no
    individual TOKEN does."""
    text = (
        "Слушай, я тут подумал — а что если собрать турнир между нашими "
        "друзьями на следующих выходных? Можно взять формат best of three "
        "и посчитать средний результат по пяти попыткам."
    )
    assert check_message_text(text) is None
