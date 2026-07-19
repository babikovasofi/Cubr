// Solves endpoints. Mirrors backend/app/schemas/solve.py.

import { request } from "./client";
import type { BadgeRead } from "./badges";

export type SolveStatus = "valid" | "dnf";

export interface SolveCreate {
  scramble: string;
  time_ms: number;
  status?: SolveStatus;
  verify_frames_ok?: boolean;
  /** Optional cube profile this solve was done with (null = none / anon). */
  cube_id?: string | null;
  /**
   * Signed token from GET /scramble (api/scramble.ts). The server verifies it,
   * lazily persists the scramble row, and links solve.scramble_id — the
   * offline/anon local-fallback scramble has no token, so this stays null.
   */
  scramble_token?: string | null;
}

export interface SolveRead {
  id: string;
  scramble: string;
  time_ms: number;
  status: string;
  verify_frames_ok: boolean;
  cube_id: string | null;
  /** Server-side row linked via scramble_token, null when none was verified. */
  scramble_id: string | null;
  created_at: string;
  /** Badges newly granted by THIS solve (best-effort award engine); empty/absent otherwise. */
  new_badges?: BadgeRead[];
}

export function createSolve(body: SolveCreate): Promise<SolveRead> {
  return request<SolveRead>("/solves", { json: body });
}

export function listSolves(limit = 50, offset = 0): Promise<SolveRead[]> {
  return request<SolveRead[]>(`/solves?limit=${limit}&offset=${offset}`);
}
