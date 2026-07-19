// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import DuelResult from "../../src/duel/DuelResult";
import type { DuelResultProps } from "../../src/duel/DuelResult";
import type { DuelResultPayload } from "../../src/duel/duelMachine";
import type { DuelH2HRead } from "../../src/api/duel";

// Mock useAuthStore
vi.mock("../../src/store/authStore", () => ({
  useAuthStore: vi.fn((selector) =>
    selector({
      user: { id: "user-a-id" },  // Match the winner_id in DEFAULT_RESULT
    })
  ),
}));

const DEFAULT_RESULT: DuelResultPayload = {
  winner_id: "user-a-id",
  players: [
    {
      slot: "a" as const,
      status: "valid" as const,
      time_ms: 5000,
    },
    {
      slot: "b" as const,
      status: "valid" as const,
      time_ms: 6000,
    },
  ],
};

const DEFAULT_H2H: DuelH2HRead = {
  played: 3,
  your_wins: 2,
  opponent_wins: 1,
  draws: 0,
  opponent_user_id: "opponent-id",
};

const defaultProps: DuelResultProps = {
  result: DEFAULT_RESULT,
  yourSlot: "a",
  onRematch: vi.fn(),
  rematchBusy: false,
  rematchError: null,
  h2h: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DuelResult", () => {
  it("renders outcome label when you won", () => {
    render(<DuelResult {...defaultProps} />);
    expect(screen.getByText("Ты выиграл")).toBeTruthy();
  });

  it("renders draw outcome when winner_id is null", () => {
    const props: DuelResultProps = {
      ...defaultProps,
      result: {
        ...DEFAULT_RESULT,
        winner_id: null,
      },
    };
    render(<DuelResult {...props} />);
    expect(screen.getByText("Ничья")).toBeTruthy();
  });

  it("renders opponent win when yourSlot=a but winner_id is not current user", () => {
    const props: DuelResultProps = {
      ...defaultProps,
      result: {
        ...DEFAULT_RESULT,
        winner_id: "user-b-id",
      },
    };
    render(<DuelResult {...props} />);
    expect(screen.getByText("Не в этот раз")).toBeTruthy();
  });

  it("renders h2h panel with correct text when h2h is provided and played > 0", () => {
    const props: DuelResultProps = {
      ...defaultProps,
      h2h: DEFAULT_H2H,
    };
    render(<DuelResult {...props} />);
    expect(screen.getByText("Вы играли 3 раза, счёт 2:1")).toBeTruthy();
  });

  it("renders h2h with draw notation when draws > 0", () => {
    const h2h: DuelH2HRead = {
      played: 5,
      your_wins: 2,
      opponent_wins: 2,
      draws: 1,
      opponent_user_id: "opponent-id",
    };
    const props: DuelResultProps = {
      ...defaultProps,
      h2h,
    };
    render(<DuelResult {...props} />);
    expect(screen.getByText("Вы играли 5 раз, счёт 2:2 (+1 ничья)")).toBeTruthy();
  });

  it("renders h2h with plural draws when draws > 1", () => {
    const h2h: DuelH2HRead = {
      played: 6,
      your_wins: 2,
      opponent_wins: 2,
      draws: 2,
      opponent_user_id: "opponent-id",
    };
    const props: DuelResultProps = {
      ...defaultProps,
      h2h,
    };
    render(<DuelResult {...props} />);
    expect(screen.getByText("Вы играли 6 раз, счёт 2:2 (+2 ничьи)")).toBeTruthy();
  });

  it("renders h2h with many-form draws when draws > 4", () => {
    const h2h: DuelH2HRead = {
      played: 10,
      your_wins: 3,
      opponent_wins: 2,
      draws: 5,
      opponent_user_id: "opponent-id",
    };
    const props: DuelResultProps = {
      ...defaultProps,
      h2h,
    };
    render(<DuelResult {...props} />);
    expect(screen.getByText("Вы играли 10 раз, счёт 3:2 (+5 ничьих)")).toBeTruthy();
  });

  it("uses singular раз when played===1", () => {
    const h2h: DuelH2HRead = {
      played: 1,
      your_wins: 1,
      opponent_wins: 0,
      draws: 0,
      opponent_user_id: "opponent-id",
    };
    const props: DuelResultProps = {
      ...defaultProps,
      h2h,
    };
    render(<DuelResult {...props} />);
    expect(screen.getByText("Вы играли 1 раз, счёт 1:0")).toBeTruthy();
  });

  it("uses раза when played===2", () => {
    const h2h: DuelH2HRead = {
      played: 2,
      your_wins: 1,
      opponent_wins: 1,
      draws: 0,
      opponent_user_id: "opponent-id",
    };
    const props: DuelResultProps = {
      ...defaultProps,
      h2h,
    };
    render(<DuelResult {...props} />);
    expect(screen.getByText("Вы играли 2 раза, счёт 1:1")).toBeTruthy();
  });

  it("uses раз when played===5", () => {
    const h2h: DuelH2HRead = {
      played: 5,
      your_wins: 2,
      opponent_wins: 2,
      draws: 1,
      opponent_user_id: "opponent-id",
    };
    const props: DuelResultProps = {
      ...defaultProps,
      h2h,
    };
    render(<DuelResult {...props} />);
    expect(screen.getByText("Вы играли 5 раз, счёт 2:2 (+1 ничья)")).toBeTruthy();
  });

  it("does not render h2h panel when h2h is null", () => {
    const props: DuelResultProps = {
      ...defaultProps,
      h2h: null,
    };
    render(<DuelResult {...props} />);
    // Should not find h2h text when h2h is null
    expect(screen.queryByText(/Вы играли/)).toBeNull();
  });

  it("does not render h2h panel when h2h.played === 0", () => {
    const h2h: DuelH2HRead = {
      played: 0,
      your_wins: 0,
      opponent_wins: 0,
      draws: 0,
      opponent_user_id: "opponent-id",
    };
    const props: DuelResultProps = {
      ...defaultProps,
      h2h,
    };
    render(<DuelResult {...props} />);
    // Should not find h2h text when played is 0
    expect(screen.queryByText(/Вы играли/)).toBeNull();
  });

  it("renders Rematch button", () => {
    render(<DuelResult {...defaultProps} />);
    const button = screen.getByRole("button", { name: /Реванш/ });
    expect(button).toBeTruthy();
  });

  it("renders player times in the grid", () => {
    render(<DuelResult {...defaultProps} />);
    // The Timer component should render the formatted times
    expect(screen.getByText("5.00")).toBeTruthy(); // 5000ms = 5.00s
    expect(screen.getByText("6.00")).toBeTruthy(); // 6000ms = 6.00s
  });
});
