// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import { BrowserRouter, MemoryRouter } from "react-router-dom";
import UnsubscribePage from "../../src/pages/UnsubscribePage";

// Hoist the mock definition
const { unsubscribeChatMock } = vi.hoisted(() => ({
  unsubscribeChatMock: vi.fn(),
}));

vi.mock("../../src/api/email", () => {
  return { unsubscribeChat: unsubscribeChatMock };
});

describe("UnsubscribePage — no API call on mount", () => {
  beforeEach(() => {
    unsubscribeChatMock.mockClear();
  });

  it("does NOT call unsubscribeChat on mount (email-client prefetch safety)", () => {
    render(
      <MemoryRouter initialEntries={["/unsubscribe?token=abc123"]}>
        <UnsubscribePage />
      </MemoryRouter>,
    );

    // Verify the page renders with the button in idle state
    expect(screen.getByText(/Больше не получать письмо/)).toBeTruthy();
    expect(screen.getByRole("button")).toBeTruthy();

    // Most important: the mock was NEVER called on mount
    expect(unsubscribeChatMock).toHaveBeenCalledTimes(0);
  });

  it("calls unsubscribeChat only when button is clicked", async () => {
    unsubscribeChatMock.mockResolvedValue(undefined);

    render(
      <MemoryRouter initialEntries={["/unsubscribe?token=test-token"]}>
        <UnsubscribePage />
      </MemoryRouter>,
    );

    // Initially: no call
    expect(unsubscribeChatMock).toHaveBeenCalledTimes(0);

    // Click the button
    const button = screen.getByRole("button");
    await act(async () => {
      fireEvent.click(button);
    });

    // Now exactly one call with the token (first arg is the token)
    await waitFor(() => {
      expect(unsubscribeChatMock).toHaveBeenCalledTimes(1);
      const firstCall = unsubscribeChatMock.mock.calls[0];
      expect(firstCall[0]).toBe("test-token");
    });
  });

  it("shows success message after successful unsubscribe", async () => {
    unsubscribeChatMock.mockResolvedValue(undefined);

    render(
      <MemoryRouter initialEntries={["/unsubscribe?token=valid-token"]}>
        <UnsubscribePage />
      </MemoryRouter>,
    );

    const button = screen.getByRole("button");
    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(
        screen.getByText(
          /Готово — письма о новых сообщениях больше не приходят\. Включить их снова можно в профиле\./,
        ),
      ).toBeTruthy();
    });
  });

  it("shows error message when unsubscribe fails", async () => {
    unsubscribeChatMock.mockRejectedValue(new Error("Token expired"));

    render(
      <MemoryRouter initialEntries={["/unsubscribe?token=bad-token"]}>
        <UnsubscribePage />
      </MemoryRouter>,
    );

    const button = screen.getByRole("button");
    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(
        screen.getByText(/Ссылка отписки недействительна или устарела\./),
      ).toBeTruthy();
    });
  });

  it("shows error when token is missing from URL", () => {
    render(
      <MemoryRouter initialEntries={["/unsubscribe"]}>
        <UnsubscribePage />
      </MemoryRouter>,
    );

    expect(screen.getByText(/В ссылке нет токена/)).toBeTruthy();
    expect(unsubscribeChatMock).toHaveBeenCalledTimes(0);
  });
});
