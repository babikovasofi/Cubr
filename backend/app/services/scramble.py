"""Random-MOVE scramble generation.

Ports ``randomScramble()`` from ``frontend/src/vision/cubeState.ts`` one-to-one:
faces URFDLB, suffixes ``['', "'", "2"]``, never repeat a face back-to-back, and
never emit a redundant pair with the opposite face (e.g. ``R ... L`` where the
face two moves back is the opposite of the current one and the immediately
preceding move is unchanged).

This is random-MOVE, not WCA random-STATE (no solver dependency in this repo) —
a deliberate MVP scope call, documented in the plan's Risks section.
"""

import secrets

_FACES = ("U", "R", "F", "D", "L", "B")
_SUFFIXES = ("", "'", "2")
_OPPOSITE = {"U": "D", "D": "U", "R": "L", "L": "R", "F": "B", "B": "F"}


def random_scramble(length: int = 25) -> str:
    """Return a space-separated scramble of ``length`` moves, e.g. ``"R U' F2 ..."``."""
    moves: list[str] = []
    prev = ""
    prev2 = ""
    while len(moves) < length:
        face = secrets.choice(_FACES)
        if face == prev:
            continue
        if face == prev2 and _OPPOSITE[face] == prev:
            continue
        suffix = secrets.choice(_SUFFIXES)
        moves.append(face + suffix)
        prev2 = prev
        prev = face
    return " ".join(moves)
