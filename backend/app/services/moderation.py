"""Display-name moderation (Stage 6 checklist: "фильтр слов для ников").

Covers both name fields a user controls:

* ``public_handle`` — the ONLY name that reaches other people (tournament /
  daily boards, П10), so this is the field that actually matters;
* ``nickname`` — currently private (own header/menu), filtered anyway: it may
  surface later, and one policy for both fields is cheaper than two.

Design notes
------------
* Matching runs on a *skeleton*: case-folded, homoglyph-mapped (Latin↔Cyrillic
  look-alikes), leet-mapped (``0→о``, ``3→е``, ``@→a`` …), stripped of every
  non-letter, with runs of the same letter collapsed. Without that, ``xyu``,
  ``п1здец``, ``f_u_c_k`` and ``пииидор`` all walk straight through.
* Because Russian roots are Cyrillic and English ones are Latin, the skeleton is
  built TWICE (one alphabet each) and each root list is matched against its own.
* Roots are split into substring roots (unambiguous inside a word) and
  whole-token roots (``жид``/``хач``/``rape``/``dick`` — otherwise "жидкость",
  "хачапури", "grape" and "Dickens" would be banned).
* This is a filter, not a guarantee: a determined person will always find a
  spelling. The bar is "no casual slur on a public board", not "unbypassable".
"""

import re
import unicodedata
from dataclasses import dataclass

# Error codes travel to the SPA inside `detail: {code, reason}` (same shape as
# CUBE_LIMIT), where api/client.ts maps them to Russian copy.
CODE_TOO_SHORT = "NAME_TOO_SHORT"
CODE_INVALID_CHARS = "NAME_INVALID_CHARS"
CODE_RESERVED = "NAME_RESERVED"
CODE_NOT_ALLOWED = "NAME_NOT_ALLOWED"

MIN_LENGTH = 2

# Letters, digits, space and a few separators. Everything else — emoji, zero-width
# joiners, RTL overrides (a classic impersonation tool) — is rejected outright.
_ALLOWED_RE = re.compile(r"^[A-Za-zА-Яа-яЁё0-9 _.\-]+$")
_HAS_LETTER_RE = re.compile(r"[A-Za-zА-Яа-яЁё]")

# Digits/symbols people substitute for letters. Alphabet-aware: mapping "1" to a
# Latin "i" during the Cyrillic pass would just get dropped, and "п1зда" would slip.
_LEET_RU = {
    "0": "о",
    "1": "и",
    "3": "е",
    "4": "а",
    "6": "б",
    "7": "т",
    "8": "в",
    "9": "г",
    "@": "а",
    "$": "с",
    "!": "и",
    "|": "и",
}

_LEET_EN = {
    "0": "o",
    "1": "i",
    "3": "e",
    "4": "a",
    "5": "s",
    "7": "t",
    "8": "b",
    "9": "g",
    "@": "a",
    "$": "s",
    "!": "i",
    "|": "i",
}

# Latin glyphs that read as Cyrillic letters (used for the Russian skeleton).
_LATIN_TO_CYRILLIC = {
    "a": "а",
    "b": "в",
    "c": "с",
    "e": "е",
    "h": "н",
    "k": "к",
    "m": "м",
    "o": "о",
    "p": "р",
    "t": "т",
    "u": "и",
    "i": "и",
    "x": "х",
    "y": "у",
}

# ...and back, for the English skeleton. Homoglyphs ONLY (no transliteration):
# the realistic bypass here is "fuсk" typed with a Cyrillic с, not "фак".
_CYRILLIC_TO_LATIN = {
    "а": "a",
    "в": "b",
    "с": "c",
    "е": "e",
    "н": "h",
    "к": "k",
    "м": "m",
    "о": "o",
    "р": "p",
    "т": "t",
    "у": "y",
    "х": "x",
}

# Unambiguous obscene roots — matched as substrings of the skeleton.
_ROOTS_RU: tuple[str, ...] = (
    "хуй",
    "хуе",
    "хуя",
    "хуи",
    "хую",
    "пизд",
    "ебат",
    "ебан",
    "ебал",
    "ебуч",
    "ебло",
    "ебош",
    "ебыр",
    "бляд",
    "блят",
    "пидор",
    "пидар",
    "пидр",
    "педик",
    "гандон",
    "гондон",
    "мудак",
    "мудил",
    "залуп",
    "дроч",
    "шлюх",
    "шлюш",
    "сука",
    "суки",
    "сучар",
    "сучк",
    "уебок",
    "уебищ",
    "гнида",
)

# Russian mat typed on a Latin keyboard ("pizdec", "blyad"). Matched against the
# LATIN skeleton — the Cyrillic one can't see them, and vice versa.
_ROOTS_RU_TRANSLIT: tuple[str, ...] = (
    "pizd",
    "ebal",
    "ebat",
    "eban",
    "blyad",
    "blyat",
    "pidor",
    "pidar",
    "mudak",
    "zalup",
    "gandon",
    "gondon",
    "shluh",
    "suka",
    "suchka",
)

_ROOTS_EN: tuple[str, ...] = (
    "fuck",
    "fuk",
    "shit",
    "cunt",
    "bitch",
    "asshole",
    "whore",
    "slut",
    "faggot",
    "wank",
    "nazi",
    "hitler",
    "pedophil",
    "paedophil",
)

# Ordinary words that contain an obscene root and would otherwise be banned.
# Cut out of the skeleton BEFORE the root scan (in skeleton form themselves).
_BENIGN_RU: tuple[str, ...] = (
    "скипидар",  # ...пидар
    "страху",  # застрахуй / страхует
    "барсук",  # ...суки
)

# Roots that are only offensive as a standalone word: as substrings they eat
# ordinary vocabulary (жидкость, хачапури, grape, Dickens, Assassin).
_WORD_ROOTS_RU: tuple[str, ...] = ("жид", "хач", "хер", "манда", "нигер", "нигеры", "нига", "нигга")
# "nigg*" is deliberately NOT a substring root: repeat-collapsing turns it into
# "nig", which lives inside "night"/"Nigeria". As whole tokens it is unambiguous.
_WORD_ROOTS_EN: tuple[str, ...] = (
    "rape",
    "dick",
    "fag",
    "hoe",
    "hui",
    "huy",
    "huj",
    "nigger",
    "niggers",
    "nigga",
    "niggas",
)

# Names that would let someone pose as staff or as the product itself.
_RESERVED: tuple[str, ...] = (
    "admin",
    "administrator",
    "root",
    "superuser",
    "moderator",
    "mod",
    "staff",
    "support",
    "system",
    "cubr",
    "cubrofficial",
    "official",
    "админ",
    "администратор",
    "администрация",
    "модератор",
    "поддержка",
    "система",
    "судья",
    "кубр",
)


def _collapse_repeats(value: str) -> str:
    return re.sub(r"(.)\1+", r"\1", value)


def _as_skeletons(words: tuple[str, ...]) -> tuple[str, ...]:
    """Roots/reserved names live in skeleton form: the input is repeat-collapsed
    before matching, so "faggot" would never meet a literal "faggot" (it arrives
    as "fagot"), and "поддержка" arrives as "подержка"."""
    return tuple(_collapse_repeats(w) for w in words)


_ROOTS_RU = _as_skeletons(_ROOTS_RU)
_ROOTS_RU_TRANSLIT = _as_skeletons(_ROOTS_RU_TRANSLIT)
_ROOTS_EN = _as_skeletons(_ROOTS_EN)
_WORD_ROOTS_RU = _as_skeletons(_WORD_ROOTS_RU)
_WORD_ROOTS_EN = _as_skeletons(_WORD_ROOTS_EN)
_RESERVED = _as_skeletons(_RESERVED)
_BENIGN_RU = _as_skeletons(_BENIGN_RU)


@dataclass(frozen=True)
class NameRejection:
    """Why a display name was refused. ``reason`` is user-facing Russian copy."""

    code: str
    reason: str


def _map_chars(value: str, table: dict[str, str]) -> str:
    return "".join(table.get(ch, ch) for ch in value)


def _strip_benign(skeleton: str) -> str:
    for word in _BENIGN_RU:
        skeleton = skeleton.replace(word, "")
    return skeleton


def _skeleton(value: str, alphabet: str) -> str:
    """Case-folded, homoglyph/leet-normalised, letters-only, repeats collapsed."""
    # NFKD also splits ё into е + combining diaeresis; dropping the mark below
    # folds ё→е, which is what we want for matching.
    folded = unicodedata.normalize("NFKD", value.casefold())
    folded = "".join(ch for ch in folded if not unicodedata.combining(ch))
    if alphabet == "ru":
        folded = _map_chars(_map_chars(folded, _LEET_RU), _LATIN_TO_CYRILLIC)
        letters = re.sub(r"[^а-я]", "", folded)
    else:
        folded = _map_chars(_map_chars(folded, _LEET_EN), _CYRILLIC_TO_LATIN)
        letters = re.sub(r"[^a-z]", "", folded)
    return _collapse_repeats(letters)


def _tokens(value: str, alphabet: str) -> list[str]:
    """Same normalisation as the skeleton, but separators still split words."""
    folded = unicodedata.normalize("NFKD", value.casefold())
    folded = "".join(ch for ch in folded if not unicodedata.combining(ch))
    if alphabet == "ru":
        folded = _map_chars(_map_chars(folded, _LEET_RU), _LATIN_TO_CYRILLIC)
        parts = re.split(r"[^а-я]+", folded)
    else:
        folded = _map_chars(_map_chars(folded, _LEET_EN), _CYRILLIC_TO_LATIN)
        parts = re.split(r"[^a-z]+", folded)
    return [_collapse_repeats(p) for p in parts if p]


def check_display_name(value: str | None) -> NameRejection | None:
    """Return why ``value`` is unacceptable as a nickname / public handle.

    ``None`` means "fine". An empty/absent name is fine too — both fields are
    optional; clearing them is a legitimate action.
    """
    if value is None:
        return None
    name = value.strip()
    if not name:
        return None

    if len(name) < MIN_LENGTH:
        return NameRejection(CODE_TOO_SHORT, "Имя слишком короткое: минимум 2 символа.")

    if not _ALLOWED_RE.match(name) or not _HAS_LETTER_RE.search(name):
        return NameRejection(
            CODE_INVALID_CHARS,
            "В имени можно использовать буквы, цифры, пробел, дефис, точку и подчёркивание.",
        )

    ru_skeleton = _skeleton(name, "ru")
    en_skeleton = _skeleton(name, "en")

    if ru_skeleton in _RESERVED or en_skeleton in _RESERVED:
        return NameRejection(CODE_RESERVED, "Это имя зарезервировано. Выбери другое.")

    # Benign words are cut out first, so "скипидар" no longer carries "пидар".
    ru_skeleton = _strip_benign(ru_skeleton)

    for root in _ROOTS_RU:
        if root in ru_skeleton:
            return NameRejection(CODE_NOT_ALLOWED, "Такое имя не подходит. Выбери другое.")
    for root in _ROOTS_EN + _ROOTS_RU_TRANSLIT:
        if root in en_skeleton:
            return NameRejection(CODE_NOT_ALLOWED, "Такое имя не подходит. Выбери другое.")

    ru_tokens = _tokens(name, "ru")
    en_tokens = _tokens(name, "en")
    if any(t in _WORD_ROOTS_RU for t in ru_tokens) or any(t in _WORD_ROOTS_EN for t in en_tokens):
        return NameRejection(CODE_NOT_ALLOWED, "Такое имя не подходит. Выбери другое.")

    return None


def sanitize_derived_nickname(value: str, fallback: str = "cuber") -> str:
    """Nickname derived by US (OAuth email local-part), not typed by the user.

    Failing an OAuth redirect with a 400 because someone's work email is rude
    would be absurd — so a rejected derivation silently becomes ``fallback``.
    """
    candidate = value.strip()[:64]
    return fallback if check_display_name(candidate) is not None else candidate
