// User display settings (zustand). Currently just the solve-time format, persisted
// to localStorage so a returning user keeps their pick. localStorage-guarded for
// private mode / SSR (mirrors store/cubesStore.ts).

import { create } from "zustand";
import { type TimeFormat } from "../lib/formatTime";

const STORAGE_KEY = "cubr_time_format";
const DEFAULT_TIME_FORMAT: TimeFormat = "clock";

function readTimeFormat(): TimeFormat {
  try {
    const v = globalThis.localStorage?.getItem(STORAGE_KEY);
    return v === "seconds" || v === "clock" ? v : DEFAULT_TIME_FORMAT;
  } catch {
    return DEFAULT_TIME_FORMAT;
  }
}

function writeTimeFormat(format: TimeFormat): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, format);
  } catch {
    /* storage unavailable (private mode / SSR) — choice just won't persist */
  }
}

interface SettingsState {
  timeFormat: TimeFormat;
  setTimeFormat: (format: TimeFormat) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  timeFormat: readTimeFormat(),
  setTimeFormat: (format) => {
    writeTimeFormat(format);
    set({ timeFormat: format });
  },
}));
