// @vitest-environment jsdom
//
// NextCard (карточка «что дальше» на ResultScreen): пустое состояние (нет
// истории — сравнивать не с чем) и праздничный вид (рекорд побит).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { SolveRead } from "../../src/api/solves";
import NextCard from "../../src/solo/NextCard";
import type { SoloHistory } from "../../src/solo/useSoloHistory";
import { useAuthStore } from "../../src/store/authStore";

vi.mock("../../src/api/duel", () => ({
  createRoom: vi.fn(),
  saveDuelSessionToken: vi.fn(),
}));

function solve(time_ms: number, status = "valid"): SolveRead {
  return {
    id: `${time_ms}-${status}-${Math.random()}`,
    scramble: "R U R' U'",
    time_ms,
    status,
    verify_frames_ok: false,
    cube_id: null,
    scramble_id: null,
    created_at: "2026-08-01T10:00:00Z",
  };
}

function renderCard(props: Partial<React.ComponentProps<typeof NextCard>> = {}) {
  const base: React.ComponentProps<typeof NextCard> = {
    dnf: false,
    elapsedMs: 30_000,
    history: { state: { kind: "anon" }, reload: vi.fn() },
    onAgain: vi.fn(),
  };
  return render(
    <MemoryRouter>
      <NextCard {...base} {...props} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useAuthStore.setState({ user: null, status: "anon" });
});

afterEach(cleanup);

describe("NextCard — пустое состояние", () => {
  it("без истории показывает, что даёт следующая сборка, а не прочерки", () => {
    renderCard({ history: { state: { kind: "ok", solves: [] }, reload: vi.fn() } });

    expect(screen.getByText(/Сохрани ещё одну сборку — здесь появится сравнение/)).toBeTruthy();
    // Никаких выдуманных чисел сравнения на пустой истории.
    expect(screen.queryByText(/Быстрее своего среднего/)).toBeNull();
    expect(screen.queryByText(/Медленнее своего среднего/)).toBeNull();
  });

  it("аноним тоже видит пустое состояние, а не ошибку", () => {
    renderCard({ history: { state: { kind: "anon" }, reload: vi.fn() } });
    expect(screen.getByText(/Сохрани ещё одну сборку — здесь появится сравнение/)).toBeTruthy();
  });

  it("всегда доступна кнопка «Ещё раз», даже без истории", () => {
    const onAgain = vi.fn();
    renderCard({ history: { state: { kind: "ok", solves: [] }, reload: vi.fn() }, onAgain });
    expect(screen.getByRole("button", { name: "Ещё раз" })).toBeTruthy();
  });
});

describe("NextCard — праздничный вид (рекорд побит)", () => {
  it("показывает стикер «Новый личный рекорд!» и на сколько он побит", () => {
    const history: SoloHistory = {
      state: { kind: "ok", solves: [solve(32_000), solve(35_000)] },
      reload: vi.fn(),
    };
    renderCard({ elapsedMs: 28_000, history });

    expect(screen.getByText("Новый личный рекорд!")).toBeTruthy();
    expect(screen.getByText(/быстрее прежнего рекорда/)).toBeTruthy();
    // Разрыв "до рекорда" не показывается, когда он уже побит.
    expect(screen.queryByText(/До личного рекорда/)).toBeNull();
  });

  it("рекорд НЕ побит — показывает разрыв, без стикера", () => {
    const history: SoloHistory = {
      state: { kind: "ok", solves: [solve(32_000), solve(35_000)] },
      reload: vi.fn(),
    };
    renderCard({ elapsedMs: 33_000, history });

    expect(screen.queryByText("Новый личный рекорд!")).toBeNull();
    expect(screen.getByText(/До личного рекорда/)).toBeTruthy();
  });
});

describe("NextCard — состояние загрузки/ошибки истории", () => {
  it("во время загрузки не показывает выдуманных чисел", () => {
    renderCard({ history: { state: { kind: "loading" }, reload: vi.fn() } });
    expect(screen.getByText("Считаю статистику…")).toBeTruthy();
    expect(screen.queryByText(/Быстрее своего среднего/)).toBeNull();
  });

  it("ошибка загрузки истории даёт повторить", () => {
    const reload = vi.fn();
    renderCard({ history: { state: { kind: "error" }, reload } });
    expect(screen.getByRole("alert")).toBeTruthy();
    screen.getByRole("button", { name: "Повторить" }).click();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("NextCard — DNF", () => {
  it("DNF не сравнивается со средним/рекордом", () => {
    const history: SoloHistory = {
      state: { kind: "ok", solves: [solve(32_000)] },
      reload: vi.fn(),
    };
    renderCard({ dnf: true, history });
    expect(screen.getByText(/сравнение появится у следующей засчитанной сборки/)).toBeTruthy();
  });
});
