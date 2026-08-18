// Screen-state hook for /trainer: which set(s) (PLL, OLL, or both) are in
// rotation, which cases within them, "any grip", the current draw, and
// whether the answer is revealed. Local to one page — not global cross-tree
// state, so a plain hook (not a zustand store) is the right size, per the
// design-system's "small single-responsibility, push logic into useX hooks"
// rule.
//
// Persists selection to localStorage via a guarded accessor (mirrors
// duel/countdownSound.ts's isCountdownMuted/setCountdownMuted pattern: works
// with storage disabled/private-mode, never throws). A corrupt or missing
// stored value falls back to "everything" — the trainer is more useful full
// than empty, and a raw JSON.parse failure must not blank the page.
//
// Backward compatibility: this page originally shipped PLL-only, storing
// selection under `cubr.trainer.pll.cases` / `cubr.trainer.pll.anyGrip`. A
// visitor with one of those already in localStorage must not lose it or see
// a broken page when OLL is added — see `readState`'s migration branch,
// which is tried ONLY when the new-format keys are absent (so a legacy
// PLL-only selection survives untouched: same ids, same "any grip", set
// defaults to PLL-only, exactly what that visitor had before). The legacy
// key is read-only from here on — new writes always go to the new keys.

import { useState } from "react";
import {
  ALL_CASE_IDS,
  casesByGroup,
  getCase,
  type PllCase,
  type PllCaseId,
  type PllGroup,
} from "./pll";
import {
  ALL_OLL_CASE_IDS,
  ollCasesByGroup,
  getOllCase,
  type OllCase,
  type OllCaseId,
  type OllGroup,
} from "./oll";
import { generateCaseScramble } from "./generate";

export type TrainerSet = "pll" | "oll";
export type TrainerCaseId = PllCaseId | OllCaseId;

const SETS_KEY = "cubr.trainer.sets";
const CASES_KEY = "cubr.trainer.cases";
const ANY_GRIP_KEY = "cubr.trainer.anyGrip";

const LEGACY_PLL_CASES_KEY = "cubr.trainer.pll.cases";
const LEGACY_ANY_GRIP_KEY = "cubr.trainer.pll.anyGrip";

export function isOllId(id: TrainerCaseId): id is OllCaseId {
  return id.startsWith("OLL");
}

/** The case object for either kind of id, without the caller needing to
 * discriminate first. */
export function getAnyCase(id: TrainerCaseId): PllCase | OllCase {
  return isOllId(id) ? getOllCase(id) : getCase(id);
}

function allIdsFor(sets: readonly TrainerSet[]): TrainerCaseId[] {
  const out: TrainerCaseId[] = [];
  if (sets.includes("pll")) out.push(...ALL_CASE_IDS);
  if (sets.includes("oll")) out.push(...ALL_OLL_CASE_IDS);
  return out;
}

const ALL_SETS: readonly TrainerSet[] = ["pll", "oll"];

function isTrainerSet(v: unknown): v is TrainerSet {
  return v === "pll" || v === "oll";
}

function parseSets(raw: string | null): TrainerSet[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const sets = parsed.filter(isTrainerSet);
    return sets.length > 0 ? sets : null;
  } catch {
    return null;
  }
}

function parseCaseIds(raw: string | null, known: ReadonlySet<string>): TrainerCaseId[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const ids = parsed.filter((v): v is TrainerCaseId => typeof v === "string" && known.has(v));
    return ids.length > 0 ? ids : null;
  } catch {
    return null;
  }
}

interface TrainerState {
  sets: readonly TrainerSet[];
  selectedIds: readonly TrainerCaseId[];
}

function defaultState(): TrainerState {
  return { sets: [...ALL_SETS], selectedIds: allIdsFor(ALL_SETS) };
}

function readState(): TrainerState {
  try {
    if (typeof localStorage === "undefined") return defaultState();

    const rawSets = localStorage.getItem(SETS_KEY);
    const rawCases = localStorage.getItem(CASES_KEY);
    if (rawSets !== null || rawCases !== null) {
      const sets = parseSets(rawSets) ?? [...ALL_SETS];
      const known = new Set<string>(allIdsFor(sets));
      const ids = parseCaseIds(rawCases, known) ?? allIdsFor(sets);
      return { sets, selectedIds: ids };
    }

    // Legacy PLL-only visitor (pre-OLL storage format) — migrate read-only.
    const legacyRaw = localStorage.getItem(LEGACY_PLL_CASES_KEY);
    if (legacyRaw !== null) {
      const known = new Set<string>(ALL_CASE_IDS);
      const ids = parseCaseIds(legacyRaw, known) ?? [...ALL_CASE_IDS];
      return { sets: ["pll"], selectedIds: ids };
    }

    return defaultState();
  } catch {
    return defaultState();
  }
}

function writeSelection(sets: readonly TrainerSet[], ids: readonly TrainerCaseId[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(SETS_KEY, JSON.stringify(sets));
    localStorage.setItem(CASES_KEY, JSON.stringify(ids));
  } catch {
    // best-effort persistence only
  }
}

function readAnyGrip(): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    const raw = localStorage.getItem(ANY_GRIP_KEY);
    if (raw !== null) return raw === "1";
    return localStorage.getItem(LEGACY_ANY_GRIP_KEY) === "1";
  } catch {
    return false;
  }
}

function writeAnyGrip(value: boolean): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (value) localStorage.setItem(ANY_GRIP_KEY, "1");
    else localStorage.removeItem(ANY_GRIP_KEY);
  } catch {
    // best-effort persistence only
  }
}

interface Draw {
  caseId: TrainerCaseId;
  scramble: string;
}

function draw(ids: readonly TrainerCaseId[], anyGrip: boolean): Draw {
  const pool = ids.length > 0 ? ids : allIdsFor(ALL_SETS);
  const caseId = pool[Math.floor(Math.random() * pool.length)];
  const scramble = generateCaseScramble(getAnyCase(caseId), { anyGrip });
  return { caseId, scramble };
}

export interface UseTrainerResult {
  sets: readonly TrainerSet[];
  selectedIds: readonly TrainerCaseId[];
  anyGrip: boolean;
  caseId: TrainerCaseId;
  scramble: string;
  /** Answer visible: multi-case selection hides it until reveal(); a
   * single-case selection has nothing to hide (you already know which case
   * you're drilling), so it starts revealed. */
  revealed: boolean;
  toggleAnyGrip: () => void;
  next: () => void;
  reveal: () => void;
  /** Turn a whole set (PLL/OLL) on or off. Turning one on selects all of its
   * cases; turning the last remaining set off is a no-op (mirrors
   * toggleCase's "can't reach empty selection" guard, one level up). */
  toggleSet: (set: TrainerSet) => void;
  toggleCase: (id: TrainerCaseId) => void;
  selectAll: () => void;
  selectPllGroup: (group: PllGroup) => void;
  selectOllGroup: (group: OllGroup) => void;
}

function readInitial(): { state: TrainerState; anyGrip: boolean } {
  return { state: readState(), anyGrip: readAnyGrip() };
}

export function useTrainer(): UseTrainerResult {
  // Read localStorage exactly once per mount: `init` is seeded from a lazy
  // useState initializer (runs on first render only) and never reassigned,
  // so it stays referentially stable across re-renders for the other
  // useState calls below to seed themselves from.
  const [init] = useState(readInitial);
  const [{ sets, selectedIds }, setState] = useState<TrainerState>(init.state);
  const [anyGrip, setAnyGrip] = useState<boolean>(init.anyGrip);
  const [current, setCurrent] = useState<Draw>(() => draw(init.state.selectedIds, init.anyGrip));
  const [revealed, setRevealed] = useState<boolean>(() => init.state.selectedIds.length === 1);

  function next(): void {
    const d = draw(selectedIds, anyGrip);
    setCurrent(d);
    setRevealed(selectedIds.length === 1);
  }

  function reveal(): void {
    setRevealed(true);
  }

  function toggleAnyGrip(): void {
    setAnyGrip((prev) => {
      const next = !prev;
      writeAnyGrip(next);
      return next;
    });
  }

  function applySelection(
    nextSets: readonly TrainerSet[],
    nextIds: readonly TrainerCaseId[],
  ): void {
    setState({ sets: nextSets, selectedIds: nextIds });
    writeSelection(nextSets, nextIds);
    setRevealed(nextIds.length === 1);
  }

  function toggleSet(set: TrainerSet): void {
    const isActive = sets.includes(set);
    if (isActive && sets.length === 1) return; // can't turn off the last set
    const nextSets = isActive ? sets.filter((s) => s !== set) : [...sets, set];
    // Turning a set off drops its cases from the selection; turning one on
    // adds all of its cases (a fresh "select all" for that set, simpler and
    // more predictable than trying to remember a stale prior selection).
    const otherIds = selectedIds.filter((id) => (isOllId(id) ? set !== "oll" : set !== "pll"));
    const nextIds = isActive ? otherIds : [...otherIds, ...allIdsFor([set])];
    applySelection(nextSets, nextIds);
  }

  function toggleCase(id: TrainerCaseId): void {
    const isSelected = selectedIds.includes(id);
    // Can't uncheck the last remaining case — an empty selection has nothing
    // to draw from.
    if (isSelected && selectedIds.length === 1) return;
    const nextIds = isSelected ? selectedIds.filter((v) => v !== id) : [...selectedIds, id];
    applySelection(sets, nextIds);
  }

  function selectAll(): void {
    applySelection(sets, allIdsFor(sets));
  }

  function selectPllGroup(group: PllGroup): void {
    const pllIds = casesByGroup(group).map((c) => c.id) as TrainerCaseId[];
    const ollIds = selectedIds.filter(isOllId);
    applySelection(sets, [...pllIds, ...ollIds]);
  }

  function selectOllGroup(group: OllGroup): void {
    const ollIds = ollCasesByGroup(group).map((c) => c.id) as TrainerCaseId[];
    const pllIds = selectedIds.filter((id) => !isOllId(id));
    applySelection(sets, [...pllIds, ...ollIds]);
  }

  return {
    sets,
    selectedIds,
    anyGrip,
    caseId: current.caseId,
    scramble: current.scramble,
    revealed,
    toggleAnyGrip,
    next,
    reveal,
    toggleSet,
    toggleCase,
    selectAll,
    selectPllGroup,
    selectOllGroup,
  };
}
