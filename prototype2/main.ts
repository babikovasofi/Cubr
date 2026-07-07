// Glue: generate a scramble (cubing via CDN), drive the pure walkthrough step
// machine, render the twisty state + Russian per-move direction, minimap, notation
// toggle. Throwaway rig — shows the INTENDED cube state, not the user's real cube
// (no camera here; physical correctness is a Stage-1 concern).

import { generateScramble, parseMoves } from "./scramble.ts";
import {
  makeWalkthrough,
  totalSteps,
  next,
  prev,
  goto,
  currentMove,
  progressFraction,
  isFirst,
  isLast,
  type Walkthrough,
} from "./walkthrough.ts";
import { moveLabelRu } from "./moveCopy.ts";
import { TwistyView } from "./twisty.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const els = {
  status: $("status"),
  stepView: $("step-view"),
  progressText: $("progress-text"),
  progressBar: $<HTMLProgressElement>("progress-bar"),
  direction: $("direction"),
  btnPrev: $<HTMLButtonElement>("btn-prev"),
  btnNext: $<HTMLButtonElement>("btn-next"),
  toggleNotation: $<HTMLInputElement>("toggle-notation"),
  notation: $("notation"),
  minimap: $("minimap"),
};

const twisty = new TwistyView();
let w: Walkthrough;
let scrambleStr = "";

const NOTATION_KEY = "cubr.scramble.showNotation";

function render(): void {
  const total = totalSteps(w);
  twisty.showState(w.moves, w.index);

  els.progressText.textContent = isLast(w)
    ? `Готово: все ${total} ходов сделаны`
    : `Шаг ${w.index + 1} из ${total}`;
  els.progressBar.value = progressFraction(w);

  const move = currentMove(w);
  els.direction.textContent = move
    ? `${move} — ${moveLabelRu(move)}`
    : "Кубик перемешан. Дальше в игре — проверка камерой (Этап 1).";

  els.btnPrev.disabled = isFirst(w);
  els.btnNext.textContent = isLast(w) ? "Готово" : "дальше →";

  // Minimap: one chip per move, current highlighted.
  const chips = els.minimap.children;
  for (let i = 0; i < chips.length; i++) {
    (chips[i] as HTMLElement).classList.toggle("current", i === w.index && !isLast(w));
    (chips[i] as HTMLElement).classList.toggle("done", i < w.index);
  }
}

function buildMinimap(): void {
  els.minimap.replaceChildren();
  w.moves.forEach((mv, i) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = mv;
    chip.title = moveLabelRu(mv);
    chip.addEventListener("click", () => {
      goto(w, i); // jump to the state BEFORE move i (so it's the current step)
      render();
    });
    els.minimap.append(chip);
  });
}

function onKey(e: KeyboardEvent): void {
  if (e.key === "ArrowRight" || e.key === " ") {
    e.preventDefault();
    next(w);
    render();
  } else if (e.key === "ArrowLeft") {
    e.preventDefault();
    prev(w);
    render();
  }
}

async function init(): Promise<void> {
  try {
    els.status.textContent = "Загружаю cubing с CDN и генерирую скрамбл…";
    await twisty.mount($("player-slot"));
    scrambleStr = await generateScramble();
    w = makeWalkthrough(parseMoves(scrambleStr));

    els.notation.textContent = scrambleStr;
    els.status.hidden = true;
    els.stepView.hidden = false;

    buildMinimap();

    els.btnNext.addEventListener("click", () => {
      next(w);
      render();
    });
    els.btnPrev.addEventListener("click", () => {
      prev(w);
      render();
    });

    // Notation toggle, persisted.
    const saved = localStorage.getItem(NOTATION_KEY) === "1";
    els.toggleNotation.checked = saved;
    els.notation.hidden = !saved;
    els.toggleNotation.addEventListener("change", () => {
      els.notation.hidden = !els.toggleNotation.checked;
      localStorage.setItem(NOTATION_KEY, els.toggleNotation.checked ? "1" : "0");
    });

    document.addEventListener("keydown", onKey);
    render();
  } catch (e) {
    els.status.textContent =
      "Не удалось загрузить cubing (проверь интернет) — " + (e as Error).message;
    console.error(e);
  }
}

init();
