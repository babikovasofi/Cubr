// Gate-spike v2: cubing via the official CDN (cdn.cubing.net) instead of the
// npm/bundled build. Rationale: cubing runs its scramble solver in a module
// WEB WORKER; bundling that worker through Vite's prod build fails at runtime
// ("Module worker instantiation failed" — dev ok, prod broken, same class as the
// cubejs gotcha). The cubing CDN build ships its workers wired correctly, so a
// remote ESM import sidesteps Vite's worker-bundling entirely (same pattern the
// vision rig already uses for the MediaPipe wasm/model). Runtime network dep.
const SCRAMBLE_URL = "https://cdn.cubing.net/v0/js/cubing/scramble";
const TWISTY_URL = "https://cdn.cubing.net/v0/js/cubing/twisty";

const status = document.getElementById("status")!;
const slot = document.getElementById("player-slot")!;

async function main(): Promise<void> {
  status.textContent = "Загружаю cubing с CDN…";
  const [{ randomScrambleForEvent }, { TwistyPlayer }] = await Promise.all([
    import(/* @vite-ignore */ SCRAMBLE_URL),
    import(/* @vite-ignore */ TWISTY_URL),
  ]);

  status.textContent = "Генерирую скрамбл…";
  const scramble = await randomScrambleForEvent("333");
  const alg = String(scramble);

  const player = new TwistyPlayer({
    puzzle: "3x3x3",
    alg,
    background: "none",
    controlPanel: "none",
  });
  slot.replaceChildren(player);
  status.textContent = `Скрамбл (${alg.split(" ").length} ходов): ${alg}`;
  (window as unknown as { __spike: unknown }).__spike = {
    alg,
    moveCount: alg.split(" ").length,
    playerTag: player.tagName,
  };
}

main().catch((e) => {
  status.textContent = "Ошибка: " + (e as Error).message;
  console.error(e);
});
