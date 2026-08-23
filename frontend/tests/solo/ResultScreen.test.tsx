// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ResultScreen from "../../src/solo/ResultScreen";
import type { SoloHistory } from "../../src/solo/useSoloHistory";

const ANON_HISTORY: SoloHistory = { state: { kind: "anon" }, reload: vi.fn() };

const BASE = {
  seconds: "12.34",
  dnf: false,
  elapsedMs: 12_340,
  validated: true,
  cameraVerified: true,
  onAgain: vi.fn(),
  saveState: "saved" as const,
  history: ANON_HISTORY,
};

function renderScreen(props: Partial<React.ComponentProps<typeof ResultScreen>> = {}) {
  return render(
    <MemoryRouter>
      <ResultScreen {...BASE} {...props} />
    </MemoryRouter>,
  );
}

describe("ResultScreen share button", () => {
  it("renders the share/download button when a scramble is present", () => {
    renderScreen({ scramble: "R U2 F' D L B2" });
    expect(screen.getByRole("button", { name: "Скачать PNG" })).toBeTruthy();
  });

  it("does not render the share/download button when scramble is absent", () => {
    renderScreen();
    expect(screen.queryByRole("button", { name: "Скачать PNG" })).toBeNull();
  });

  it("still renders the share button on a DNF result", () => {
    renderScreen({ dnf: true, scramble: "R U2 F' D L B2" });
    expect(screen.getByRole("button", { name: "Скачать PNG" })).toBeTruthy();
  });
});
