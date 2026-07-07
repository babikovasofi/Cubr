import { create } from "zustand";

export type Theme = "light" | "dark";

interface UiState {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

// Apply the theme to <html> so the design-system CSS vars (.dark in index.css)
// switch the whole palette. Guarded for non-DOM (test/node) environments.
function applyThemeClass(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
}

const initialTheme: Theme = "light";
applyThemeClass(initialTheme);

export const useUiStore = create<UiState>((set) => ({
  theme: initialTheme,
  toggleTheme: () =>
    set((s) => {
      const next: Theme = s.theme === "light" ? "dark" : "light";
      applyThemeClass(next);
      return { theme: next };
    }),
  setTheme: (theme) => {
    applyThemeClass(theme);
    set({ theme });
  },
}));
