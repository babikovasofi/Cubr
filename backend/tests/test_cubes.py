from typing import Any

from httpx import AsyncClient

from tests.conftest import EmailSpy

COOKIE = "cubr_auth"

# A valid 6-face (U/R/F/D/L/B) Lab profile.
PROFILE: dict[str, list[float]] = {
    "U": [95.0, 0.0, 0.0],
    "R": [50.0, 60.0, 40.0],
    "F": [45.0, -50.0, 45.0],
    "D": [90.0, -5.0, 80.0],
    "L": [55.0, 55.0, -30.0],
    "B": [40.0, 20.0, -55.0],
}


async def _register(client: AsyncClient, email: str, password: str = "sup3r-secret-pw") -> None:
    resp = await client.post("/auth/register", json={"email": email, "password": password})
    assert resp.status_code == 201, resp.text


async def _login(client: AsyncClient, email: str, password: str = "sup3r-secret-pw") -> None:
    resp = await client.post("/auth/login", data={"username": email, "password": password})
    assert resp.status_code == 204, resp.text
    assert COOKIE in resp.cookies


async def _register_and_login(client: AsyncClient, email: str) -> None:
    await _register(client, email)
    await _login(client, email)


def _payload(name: str, **extra: Any) -> dict[str, Any]:
    return {"name": name, "color_profile": PROFILE, **extra}


# --- auth gate --------------------------------------------------------------


async def test_cubes_require_auth(client: AsyncClient) -> None:
    assert (await client.get("/cubes")).status_code == 401
    assert (await client.post("/cubes", json=_payload("c"))).status_code == 401


# --- create + list ----------------------------------------------------------


async def test_create_then_list(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, "cuber@example.com")
    resp = await client.post("/cubes", json=_payload("Gan 356"))
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["name"] == "Gan 356"
    assert body["is_primary"] is True  # first cube auto-primary
    assert body["color_profile"] == PROFILE

    resp = await client.get("/cubes")
    assert resp.status_code == 200
    assert [c["name"] for c in resp.json()] == ["Gan 356"]


async def test_color_profile_must_have_six_faces(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, "badprofile@example.com")
    bad = {"U": [1.0, 2.0, 3.0]}  # missing faces
    resp = await client.post("/cubes", json=_payload("x", color_profile=bad))
    assert resp.status_code == 422, resp.text


# --- limit ------------------------------------------------------------------


async def test_sixth_cube_returns_409_cube_limit(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, "collector@example.com")
    for i in range(5):
        resp = await client.post("/cubes", json=_payload(f"cube-{i}"))
        assert resp.status_code == 201, resp.text
    resp = await client.post("/cubes", json=_payload("cube-6"))
    assert resp.status_code == 409, resp.text
    assert resp.json()["detail"] == {"code": "CUBE_LIMIT"}


# --- primary uniqueness -----------------------------------------------------


async def test_exactly_one_primary_after_two_creates(
    client: AsyncClient, email_spy: EmailSpy
) -> None:
    await _register_and_login(client, "twocubes@example.com")
    await client.post("/cubes", json=_payload("first"))
    await client.post("/cubes", json=_payload("second", is_primary=True))

    cubes = (await client.get("/cubes")).json()
    primaries = [c["name"] for c in cubes if c["is_primary"]]
    assert primaries == ["second"]


async def test_patch_is_primary_flips_exclusivity(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, "flip@example.com")
    a = (await client.post("/cubes", json=_payload("A"))).json()
    b = (await client.post("/cubes", json=_payload("B"))).json()
    assert a["is_primary"] is True and b["is_primary"] is False

    resp = await client.patch(f"/cubes/{b['id']}", json={"is_primary": True})
    assert resp.status_code == 200, resp.text

    by_id = {c["id"]: c["is_primary"] for c in (await client.get("/cubes")).json()}
    assert by_id[b["id"]] is True
    assert by_id[a["id"]] is False


async def test_patch_rename(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, "rename@example.com")
    c = (await client.post("/cubes", json=_payload("old"))).json()
    resp = await client.patch(f"/cubes/{c['id']}", json={"name": "new", "note": "n"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["name"] == "new"
    assert body["note"] == "n"


# --- ownership 404 ----------------------------------------------------------


async def test_other_users_cube_is_404(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, "owner@example.com")
    c = (await client.post("/cubes", json=_payload("mine"))).json()
    cube_id = c["id"]

    await _register_and_login(client, "intruder@example.com")
    assert (await client.patch(f"/cubes/{cube_id}", json={"name": "hax"})).status_code == 404
    assert (await client.delete(f"/cubes/{cube_id}")).status_code == 404
    # And the intruder's list never contains it.
    assert (await client.get("/cubes")).json() == []


async def test_unknown_cube_is_404(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, "ghost@example.com")
    missing = "00000000-0000-0000-0000-000000000000"
    assert (await client.patch(f"/cubes/{missing}", json={"name": "x"})).status_code == 404
    assert (await client.delete(f"/cubes/{missing}")).status_code == 404


# --- delete promotes primary ------------------------------------------------


async def test_delete_primary_promotes_most_recent_survivor(
    client: AsyncClient, email_spy: EmailSpy
) -> None:
    await _register_and_login(client, "promote@example.com")
    old = (await client.post("/cubes", json=_payload("old"))).json()
    newer = (await client.post("/cubes", json=_payload("newer"))).json()
    # `old` is primary (first created). Delete it.
    resp = await client.delete(f"/cubes/{old['id']}")
    assert resp.status_code == 204, resp.text

    cubes = (await client.get("/cubes")).json()
    assert len(cubes) == 1
    assert cubes[0]["id"] == newer["id"]
    assert cubes[0]["is_primary"] is True


async def test_delete_last_cube_leaves_none(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, "solo@example.com")
    c = (await client.post("/cubes", json=_payload("only"))).json()
    assert (await client.delete(f"/cubes/{c['id']}")).status_code == 204
    assert (await client.get("/cubes")).json() == []
