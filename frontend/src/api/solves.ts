// Solves endpoints. Mirrors backend/app/schemas/solve.py.

import { request } from "./client";

export type SolveStatus = "valid" | "dnf";

export interface SolveCreate {
  scramble: string;
  time_ms: number;
  status?: SolveStatus;
  verify_frames_ok?: boolean;
}

export interface SolveRead {
  id: string;
  scramble: string;
  time_ms: number;
  status: string;
  verify_frames_ok: boolean;
  created_at: string;
}

export function createSolve(body: SolveCreate): Promise<SolveRead> {
  return request<SolveRead>("/solves", { json: body });
}

export function listSolves(limit = 50, offset = 0): Promise<SolveRead[]> {
  return request<SolveRead[]>(`/solves?limit=${limit}&offset=${offset}`);
}
