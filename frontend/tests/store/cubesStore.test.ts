import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CubeRead, ColorProfile } from "../../src/api/cubes";

// Mock the api layer so the store's invariant logic is tested in isolation
// (no fetch). The store imports these named functions.
vi.mock("../../src/api/cubes", async () => {
  const actual = await vi.importActual<typeof import("../../src/api/cubes")>("../../src/api/cubes");
  return {
    ...actual,
    listCubes: vi.fn(),
    createCube: vi.fn(),
    updateCube: vi.fn(),
    deleteCube: vi.fn(),
  };
});

import { listCubes, createCube, updateCube, deleteCube } from "../../src/api/cubes";
import {
  useCubesStore,
  getSelectedCubeId,
  getSelectedProfile,
  __resetCubesForTests,
} from "../../src/store/cubesStore";

const P: ColorProfile = {
  U: [0, 0, 0],
  R: [0, 0, 0],
  F: [0, 0, 0],
  D: [0, 0, 0],
  L: [0, 0, 0],
  B: [0, 0, 0],
};

function cube(id: string, is_primary: boolean, createdAt: string): CubeRead {
  return {
    id,
    name: id,
    note: null,
    is_primary,
    color_profile: { ...P },
    created_at: createdAt,
    recalibrated_at: createdAt,
  };
}

// Minimal in-memory localStorage (test env is node — no DOM storage).
function fakeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
}

let store: Storage;

beforeEach(() => {
  store = fakeStorage();
  vi.stubGlobal("localStorage", store);
  __resetCubesForTests();
  vi.mocked(listCubes).mockReset();
  vi.mocked(createCube).mockReset();
  vi.mocked(updateCube).mockReset();
  vi.mocked(deleteCube).mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("cubesStore.load", () => {
  it("defaults the selection to the primary cube and persists it", async () => {
    vi.mocked(listCubes).mockResolvedValueOnce([
      cube("b", false, "2026-07-02"),
      cube("a", true, "2026-07-01"),
    ]);
    await useCubesStore.getState().load();

    expect(useCubesStore.getState().status).toBe("ready");
    expect(useCubesStore.getState().selectedCubeId).toBe("a");
    expect(getSelectedCubeId()).toBe("a");
    expect(store.getItem("cubr_selected_cube")).toBe("a");
  });

  it("getSelectedCubeId returns null for a stale id not in the loaded list", () => {
    // load() never ran (e.g. it errored) — a stale localStorage id must not be
    // vouched for, or POST /solves would 404 and drop the solve.
    useCubesStore.setState({ selectedCubeId: "ghost", list: [], status: "error" });
    expect(getSelectedCubeId()).toBeNull();
  });

  it("keeps an already-selected cube if it still exists", async () => {
    useCubesStore.setState({ selectedCubeId: "b" });
    vi.mocked(listCubes).mockResolvedValueOnce([
      cube("b", false, "2026-07-02"),
      cube("a", true, "2026-07-01"),
    ]);
    await useCubesStore.getState().load();
    expect(useCubesStore.getState().selectedCubeId).toBe("b");
  });
});

describe("cubesStore single-primary invariant", () => {
  it("create with is_primary clears the flag on the others", async () => {
    useCubesStore.setState({ list: [cube("a", true, "2026-07-01")], status: "ready" });
    vi.mocked(createCube).mockResolvedValueOnce(cube("b", true, "2026-07-02"));

    await useCubesStore.getState().create({ name: "b", color_profile: { ...P } });

    const { list } = useCubesStore.getState();
    expect(list.filter((c) => c.is_primary).map((c) => c.id)).toEqual(["b"]);
    expect(list.map((c) => c.id)).toEqual(["b", "a"]); // newest first
  });

  it("update is_primary=true moves the single primary", async () => {
    useCubesStore.setState({
      list: [cube("b", false, "2026-07-02"), cube("a", true, "2026-07-01")],
      status: "ready",
    });
    vi.mocked(updateCube).mockResolvedValueOnce(cube("b", true, "2026-07-02"));

    await useCubesStore.getState().update("b", { is_primary: true });

    const { list } = useCubesStore.getState();
    expect(list.filter((c) => c.is_primary).map((c) => c.id)).toEqual(["b"]);
  });
});

describe("cubesStore.remove", () => {
  it("promotes the most-recent survivor when the primary is deleted", async () => {
    useCubesStore.setState({
      list: [
        cube("c", false, "2026-07-03"),
        cube("b", false, "2026-07-02"),
        cube("a", true, "2026-07-01"),
      ],
      selectedCubeId: "a",
      status: "ready",
    });
    vi.mocked(deleteCube).mockResolvedValueOnce(undefined);

    await useCubesStore.getState().remove("a");

    const { list, selectedCubeId } = useCubesStore.getState();
    expect(list.map((c) => c.id)).toEqual(["c", "b"]);
    expect(list.filter((c) => c.is_primary).map((c) => c.id)).toEqual(["c"]);
    expect(selectedCubeId).toBe("c"); // selection followed the new primary
  });
});

describe("getSelectedProfile", () => {
  it("returns the selected cube's profile when it is present in the list", () => {
    const c = cube("xyz", true, "2026-07-01");
    c.color_profile = {
      U: [96, 0, 2],
      R: [50, 60, 40],
      F: [55, -45, 30],
      D: [90, -5, 80],
      L: [62, 40, 55],
      B: [40, 10, -45],
    };
    useCubesStore.setState({ list: [c], selectedCubeId: "xyz", status: "ready" });
    expect(getSelectedProfile()).toEqual(c.color_profile);
  });

  it("returns null for a stale/absent selection (mirrors getSelectedCubeId vouching)", () => {
    useCubesStore.setState({ list: [], selectedCubeId: "ghost", status: "error" });
    expect(getSelectedProfile()).toBeNull();
  });

  it("returns null when nothing is selected", () => {
    useCubesStore.setState({ list: [cube("a", true, "2026-07-01")], selectedCubeId: null });
    expect(getSelectedProfile()).toBeNull();
  });
});

describe("cubesStore.setSelected", () => {
  it("persists the pick to localStorage and getSelectedCubeId reads it", () => {
    // getSelectedCubeId only vouches for an id present in the list, so seed it.
    useCubesStore.setState({ list: [cube("xyz", false, "2026-07-01")] });
    useCubesStore.getState().setSelected("xyz");
    expect(getSelectedCubeId()).toBe("xyz");
    expect(store.getItem("cubr_selected_cube")).toBe("xyz");
  });
});
