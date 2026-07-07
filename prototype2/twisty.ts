import { loadCubing, type TwistyPlayerEl } from "./cubingCdn.ts";

// Wrapper over <twisty-player>. Fixed orientation (white top, green front) — the
// player never does whole-cube x/y/z rotations, only the scramble's layer turns,
// so the on-screen cube always matches the "hold white up, green front" banner.
export class TwistyView {
  private player: TwistyPlayerEl | null = null;

  async mount(slot: HTMLElement): Promise<void> {
    const { TwistyPlayer } = await loadCubing();
    const p = new TwistyPlayer({
      puzzle: "3x3x3",
      alg: "",
      // white top, green front:
      experimentalSetupAnchor: "start",
      background: "none",
      controlPanel: "none",
      hintFacelets: "none",
      cameraLatitude: 22,
      cameraLongitude: -22,
    });
    this.player = p;
    slot.replaceChildren(p);
  }

  /** Render the cube state after the first `n` moves of `moves`. */
  showState(moves: readonly string[], n: number): void {
    if (!this.player) return;
    // Setting alg to the first n moves (anchor=start) shows the state after them.
    this.player.alg = moves.slice(0, n).join(" ");
  }

  get ready(): boolean {
    return this.player !== null;
  }
}
