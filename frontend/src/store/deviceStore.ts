// Escape hatch десктопного гейта (Этап 6, R8). Живёт в сторе, а не в локальном
// состоянии, чтобы заглушка и подсказка на лендинге видели одно решение.
// sessionStorage, а не localStorage: послабление на одну сессию, не навсегда.

import { create } from "zustand";

const STORAGE_KEY = "cubr_handheld_override";

function readOverride(): boolean {
  try {
    return globalThis.sessionStorage?.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeOverride(value: boolean): void {
  try {
    if (value) globalThis.sessionStorage?.setItem(STORAGE_KEY, "1");
    else globalThis.sessionStorage?.removeItem(STORAGE_KEY);
  } catch {
    /* storage недоступен (приватный режим / SSR) — выбор просто не переживёт перезагрузку */
  }
}

interface DeviceState {
  /** Пользователь явно сказал «всё равно открыть здесь». */
  handheldOverride: boolean;
  allowHandheld: () => void;
  resetHandheldOverride: () => void;
}

export const useDeviceStore = create<DeviceState>((set) => ({
  handheldOverride: readOverride(),
  allowHandheld: () => {
    writeOverride(true);
    set({ handheldOverride: true });
  },
  resetHandheldOverride: () => {
    writeOverride(false);
    set({ handheldOverride: false });
  },
}));
