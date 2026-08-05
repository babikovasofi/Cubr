import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  listCubes,
  createCube,
  updateCube,
  deleteCube,
  profileToRefs,
  refsToProfile,
  type ColorProfile,
  type CubeRead,
} from "../../src/api/cubes";
import type { Refs } from "../../src/vision/colors";
import { ApiError } from "../../src/api/client";

function res(opts: { status: number; json?: unknown; text?: string }): Response {
  return {
    ok: opts.status >= 200 && opts.status < 300,
    status: opts.status,
    json: async () => opts.json,
    text: async () => opts.text ?? (opts.json === undefined ? "" : JSON.stringify(opts.json)),
  } as unknown as Response;
}

const PROFILE: ColorProfile = {
  U: [95, 0, 5],
  R: [50, 60, 40],
  F: [55, 65, 55],
  D: [96, -2, 80],
  L: [60, 50, -30],
  B: [45, -30, -40],
};

const CUBE: CubeRead = {
  id: "c1",
  name: "MoYu",
  note: null,
  is_primary: true,
  color_profile: PROFILE,
  created_at: "2026-07-10T00:00:00Z",
  recalibrated_at: "2026-07-10T00:00:00Z",
};

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("cubes api", () => {
  it("GET /cubes hits the proxied /api path with credentials", async () => {
    fetchMock.mockResolvedValueOnce(res({ status: 200, json: [CUBE] }));
    const out = await listCubes();
    expect(out).toEqual([CUBE]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/cubes");
    expect(init.credentials).toBe("include");
    expect(init.method ?? "GET").toBe("GET");
  });

  it("POST /cubes sends the JSON body (name/note/is_primary/color_profile)", async () => {
    fetchMock.mockResolvedValueOnce(res({ status: 201, json: CUBE }));
    const body = { name: "MoYu", note: null, is_primary: true, color_profile: PROFILE };
    await createCube(body);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/cubes");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual(body);
  });

  it("maps the 6th-cube 409 CUBE_LIMIT to a RU ApiError", async () => {
    fetchMock.mockResolvedValueOnce(res({ status: 409, json: { detail: { code: "CUBE_LIMIT" } } }));
    const err = (await createCube({ name: "x", color_profile: PROFILE }).catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.code).toBe("CUBE_LIMIT");
    expect(err.message).toContain("лимит");
  });

  it("PATCH /cubes/{id} sends a partial update", async () => {
    fetchMock.mockResolvedValueOnce(res({ status: 200, json: { ...CUBE, name: "renamed" } }));
    await updateCube("c1", { name: "renamed" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/cubes/c1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ name: "renamed" });
  });

  it("DELETE /cubes/{id} resolves undefined on 204", async () => {
    fetchMock.mockResolvedValueOnce(res({ status: 204 }));
    await expect(deleteCube("c1")).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/cubes/c1");
    expect(init.method).toBe("DELETE");
  });
});

describe("profileToRefs / refsToProfile", () => {
  it("round-trips a profile through refs unchanged (all 6 positional faces)", () => {
    const refs = profileToRefs(PROFILE);
    expect(refsToProfile(refs)).toEqual(PROFILE);
  });

  it("clones: mutating the derived refs does not touch the source profile", () => {
    const src: ColorProfile = { ...PROFILE, U: [...PROFILE.U] };
    const refs: Refs = profileToRefs(src);
    refs.U[0] = 999;
    expect(src.U[0]).toBe(PROFILE.U[0]);
  });
});
