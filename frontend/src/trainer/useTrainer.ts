// Screen-state hook for /trainer: which cases are in rotation, "any grip",
// the current draw, and whether the answer is revealed. Local to one page —
// not global cross-tree state, so a plain hook (not a zustand store) is the
// right size, per the design-system's "small single-responsibility, push
// logic into useX hooks" rule.
//
// Persists selection to localStorage via a guarded accessor (mirrors
// duel/countdownSound.ts's isCountdownMuted/setCountdownMuted pattern: works
// with storage disabled/private-mode, never throws). A corrupt or missing
// stored value falls back to "all cases" — the trainer is more useful full
// than empty, and a raw JSON.parse failure must not blank the page.

import { useState } from "react";
import { ALL_CASE_IDS, casesByGroup, getCase, type PllCaseId, type PllGroup } from "./pll";
import { generateCaseScramble } from "./generate";

const CASES_KEY = "cubr.trainer.pll.cases";
const ANY_GRIP_KEY = "cubr.trainer.pll.anyGrip";

function readCases(): PllCaseId[] {
  try {
    if (typeof localStorage === "undefined") return [...ALL_CASE_IDS];
    const raw = localStorage.getItem(CASES_KEY);
    if (!raw) return [...ALL_CASE_IDS];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...ALL_CASE_IDS];
    const known = new Set<string>(ALL_CASE_IDS);
    const ids = parsed.filter((v): v is PllCaseId => typeof v === "string" && known.has(v));
    return ids.length > 0 ? ids : [...ALL_CASE_IDS];
  } catch {
    return [...ALL_CASE_IDS];
  }
}

function writeCases(ids: readonly PllCaseId[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(CASES_KEY, JSON.stringify(ids));
  } catch {
    // best-effort persistence only
  }
}

function readAnyGrip(): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(ANY_GRIP_KEY) === "1";
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
  caseId: PllCaseId;
  scramble: string;
}

function draw(ids: readonly PllCaseId[], anyGrip: boolean): Draw {
  const pool = ids.length > 0 ? ids : ALL_CASE_IDS;
  const caseId = pool[Math.floor(Math.random() * pool.length)];
  const scramble = generateCaseScramble(getCase(caseId), { anyGrip });
  return { caseId, scramble };
}

export interface UseTrainerResult {
  selectedIds: readonly PllCaseId[];
  anyGrip: boolean;
  caseId: PllCaseId;
  scramble: string;
  /** Answer visible: multi-case selection hides it until reveal(); a
   * single-case selection has nothing to hide (you already know which case
   * you're drilling), so it starts revealed. */
  revealed: boolean;
  toggleAnyGrip: () => void;
  next: () => void;
  reveal: () => void;
  toggleCase: (id: PllCaseId) => void;
  selectAll: () => void;
  selectGroup: (group: PllGroup) => void;
}

export function useTrainer(): UseTrainerResult {
  const [selectedIds, setSelectedIds] = useState<readonly PllCaseId[]>(() => readCases());
  const [anyGrip, setAnyGrip] = useState<boolean>(() => readAnyGrip());
  const [current, setCurrent] = useState<Draw>(() => draw(readCases(), readAnyGrip()));
  const [revealed, setRevealed] = useState<boolean>(() => readCases().length === 1);

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

  function applySelection(next: readonly PllCaseId[]): void {
    setSelectedIds(next);
    writeCases(next);
    setRevealed(next.length === 1);
  }

  function toggleCase(id: PllCaseId): void {
    const isSelected = selectedIds.includes(id);
    // Can't uncheck the last remaining case — an empty selection has nothing
    // to draw from.
    if (isSelected && selectedIds.length === 1) return;
    const next = isSelected ? selectedIds.filter((v) => v !== id) : [...selectedIds, id];
    applySelection(next);
  }

  function selectAll(): void {
    applySelection([...ALL_CASE_IDS]);
  }

  function selectGroup(group: PllGroup): void {
    applySelection(casesByGroup(group).map((c) => c.id));
  }

  return {
    selectedIds,
    anyGrip,
    caseId: current.caseId,
    scramble: current.scramble,
    revealed,
    toggleAnyGrip,
    next,
    reveal,
    toggleCase,
    selectAll,
    selectGroup,
  };
}
