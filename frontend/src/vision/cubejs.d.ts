// Minimal ambient types for `cubejs` (ships no .d.ts). Covers only the surface
// this prototype uses. cubejs facelet strings are 54 chars over {U,R,F,D,L,B}.
declare module "cubejs" {
  class Cube {
    static fromString(facelets: string): Cube;
    static random(): Cube;
    static initSolver(): void;
    move(algorithm: string): Cube;
    solve(maxDepth?: number): string;
    asString(): string;
    isSolved(): boolean;
    // Permutation/orientation state (used for real solvability checks).
    co: number[]; // corner orientations
    eo: number[]; // edge orientations
    cornerParity(): number; // corner permutation parity (0|1)
    edgeParity(): number; // edge permutation parity (0|1)
    // Raw permutation arrays (Kociemba indexing: corners URF,UFL,ULB,UBR,DFR,
    // DLF,DBL,DRB; edges UR,UF,UL,UB,DR,DF,DL,DB,FR,FL,BL,BR). cp[i]/ep[i] is
    // the piece now sitting at position i. Test-oracle use only (PLL trainer's
    // independent-spec check derives cycles from these) — nothing in `src/`
    // outside `vision/` reads them.
    cp: number[];
    ep: number[];
  }
  export default Cube;
}
