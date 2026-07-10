// Cube-profile endpoints. Mirrors backend/app/schemas/cube.py.
//
// color_profile keys are the POSITIONAL cube faces (reader space) U/R/F/D/L/B —
// NOT colour letters. Each value is one Lab reference [L, a, b], exactly the
// output of the reader's calibrate() (see useCubeReader.getProfile).

import { request } from "./client";

export const CUBE_FACES = ["U", "R", "F", "D", "L", "B"] as const;
export type CubeFace = (typeof CUBE_FACES)[number];

/** 6 Lab face references, keyed by positional face. */
export type ColorProfile = Record<CubeFace, [number, number, number]>;

/** Client-side cube limit (server enforces the same, returns 409 CUBE_LIMIT). */
export const CUBE_LIMIT = 5;

export interface CubeRead {
  id: string;
  name: string;
  note: string | null;
  is_primary: boolean;
  color_profile: ColorProfile;
  created_at: string;
  recalibrated_at: string;
}

export interface CubeCreate {
  name: string;
  note?: string | null;
  is_primary?: boolean;
  color_profile: ColorProfile;
}

export interface CubeUpdate {
  name?: string;
  note?: string | null;
  is_primary?: boolean;
}

export function listCubes(): Promise<CubeRead[]> {
  return request<CubeRead[]>("/cubes");
}

export function createCube(body: CubeCreate): Promise<CubeRead> {
  return request<CubeRead>("/cubes", { json: body });
}

export function updateCube(id: string, body: CubeUpdate): Promise<CubeRead> {
  return request<CubeRead>(`/cubes/${id}`, { method: "PATCH", json: body });
}

export function deleteCube(id: string): Promise<void> {
  return request<void>(`/cubes/${id}`, { method: "DELETE" });
}
