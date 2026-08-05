from pydantic import BaseModel


class ScrambleOut(BaseModel):
    scramble: str
    event: str = "333"
    # HMAC-signed, one-time-use token (see app.services.scramble_token). The
    # client threads this back into POST /solves to authenticate the scramble
    # text server-side and link solve.scramble_id.
    scramble_token: str
