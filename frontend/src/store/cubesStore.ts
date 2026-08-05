// Cube-profile store (zustand). Owns the user's cube list plus the currently
// selected cube (persisted to localStorage so a returning user keeps their pick).
//
// Invariants mirrored from the server so the UI never flickers a stale second
// primary between a mutation and a refetch:
//   - exactly one cube is is_primary (a create/update that sets primary clears
//     the flag on the others locally, matching the server transaction);
//   - deleting the primary promotes the most-recent survivor (list is
//     created_at desc, so index 0);
//   - selectedCubeId always references a cube that still exists, defaulting to
//     the primary when the current pick is gone.

import { create } from "zustand";
import { ApiError } from "../api/client";
import {
  createCube,
  deleteCube,
  listCubes,
  updateCube,
  type ColorProfile,
  type CubeCreate,
  type CubeRead,
  type CubeUpdate,
} from "../api/cubes";

const STORAGE_KEY = "cubr_selected_cube";

function readStored(): string | null {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeStored(id: string | null): void {
  try {
    if (id) globalThis.localStorage?.setItem(STORAGE_KEY, id);
    else globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable (private mode / SSR) — selection just won't persist */
  }
}

/** Force a single primary: only `primaryId` keeps the flag. */
function withSinglePrimary(list: CubeRead[], primaryId: string): CubeRead[] {
  return list.map((c) => (c.is_primary === (c.id === primaryId) ? c : { ...c, is_primary: c.id === primaryId }));
}

/** Keep the current pick if it still exists, else fall back to primary, then first. */
function reconcileSelected(list: CubeRead[], current: string | null): string | null {
  if (current && list.some((c) => c.id === current)) return current;
  return list.find((c) => c.is_primary)?.id ?? list[0]?.id ?? null;
}

export type CubesStatus = "idle" | "loading" | "ready" | "error";

interface CubesState {
  list: CubeRead[];
  status: CubesStatus;
  error: string | null;
  selectedCubeId: string | null;
  load: () => Promise<void>;
  setSelected: (id: string | null) => void;
  create: (body: CubeCreate) => Promise<CubeRead>;
  update: (id: string, body: CubeUpdate) => Promise<CubeRead>;
  remove: (id: string) => Promise<void>;
}

export const useCubesStore = create<CubesState>((set) => ({
  list: [],
  status: "idle",
  error: null,
  selectedCubeId: readStored(),

  load: async () => {
    set({ status: "loading", error: null });
    try {
      const list = await listCubes();
      set((s) => {
        const selectedCubeId = reconcileSelected(list, s.selectedCubeId);
        writeStored(selectedCubeId);
        return { list, status: "ready", selectedCubeId };
      });
    } catch (e) {
      set({
        status: "error",
        error: e instanceof ApiError ? e.message : "Не удалось загрузить кубики.",
      });
    }
  },

  setSelected: (id) => {
    writeStored(id);
    set({ selectedCubeId: id });
  },

  create: async (body) => {
    const cube = await createCube(body);
    set((s) => {
      let list = [cube, ...s.list];
      if (cube.is_primary) list = withSinglePrimary(list, cube.id);
      const selectedCubeId = reconcileSelected(list, s.selectedCubeId);
      writeStored(selectedCubeId);
      return { list, status: "ready", selectedCubeId };
    });
    return cube;
  },

  update: async (id, body) => {
    const cube = await updateCube(id, body);
    set((s) => {
      let list = s.list.map((c) => (c.id === id ? cube : c));
      if (cube.is_primary) list = withSinglePrimary(list, cube.id);
      const selectedCubeId = reconcileSelected(list, s.selectedCubeId);
      writeStored(selectedCubeId);
      return { list, selectedCubeId };
    });
    return cube;
  },

  remove: async (id) => {
    await deleteCube(id);
    set((s) => {
      const wasPrimary = s.list.find((c) => c.id === id)?.is_primary ?? false;
      let list = s.list.filter((c) => c.id !== id);
      if (wasPrimary && list.length > 0 && !list.some((c) => c.is_primary)) {
        list = withSinglePrimary(list, list[0].id); // created_at desc → most recent
      }
      const selectedCubeId = reconcileSelected(list, s.selectedCubeId === id ? null : s.selectedCubeId);
      writeStored(selectedCubeId);
      return { list, selectedCubeId };
    });
  },
}));

/** Non-reactive read for imperative callers (e.g. the solo save fire-and-forget). */
export function getSelectedCubeId(): string | null {
  // Only vouch for an id that is actually in the loaded list. selectedCubeId is
  // seeded from localStorage and only reconciled on a successful load(); if load()
  // failed (list still empty) a stale/deleted id would make POST /solves 404 and
  // silently drop the solve. Return null unless the cube is really present.
  const { selectedCubeId, list } = useCubesStore.getState();
  if (selectedCubeId && list.some((c) => c.id === selectedCubeId)) {
    return selectedCubeId;
  }
  return null;
}

/**
 * Non-reactive read of the selected cube's colour profile, or null. Same vouching
 * rule as getSelectedCubeId: only returns a profile for a cube actually present in
 * the loaded list (a stale/absent localStorage id yields null → anon 6-face path).
 */
export function getSelectedProfile(): ColorProfile | null {
  const { selectedCubeId, list } = useCubesStore.getState();
  if (!selectedCubeId) return null;
  return list.find((c) => c.id === selectedCubeId)?.color_profile ?? null;
}

/** Test-only: reset the store to its empty state. */
export function __resetCubesForTests(): void {
  useCubesStore.setState({ list: [], status: "idle", error: null, selectedCubeId: null });
}
