"""Public scramble-generation route. No auth: solo and accuracy-mode run anonymously."""

from fastapi import APIRouter, Depends

from app.config import get_settings
from app.schemas.scramble import ScrambleOut
from app.services.ratelimit import ip_rate_limit
from app.services.scramble import random_scramble
from app.services.scramble_token import sign

settings = get_settings()

router = APIRouter(prefix="/scramble", tags=["scramble"])

_ip_limit = Depends(ip_rate_limit(settings.SCRAMBLE_RATE_LIMIT))

_EVENT = "333"


@router.get("", response_model=ScrambleOut, dependencies=[_ip_limit])
async def get_scramble() -> ScrambleOut:
    # Stateless: no DB write here. The scramble row is persisted lazily by
    # POST /solves only when a real solve consumes the signed token below.
    text = random_scramble()
    token = sign(text, _EVENT, settings.SCRAMBLE_SIGN_SECRET, settings.SCRAMBLE_TOKEN_TTL)
    return ScrambleOut(scramble=text, event=_EVENT, scramble_token=token)
