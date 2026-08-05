// @vitest-environment jsdom
//
// Шапка авторизованного пользователя. Бейдж кубков не должен показывать «0»:
// начислять кубки пока некому (рейтинг ждёт честностный кирпич), а нулевой
// счётчик в шапке обещает систему, которой нет.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../../src/App";
import { useAuthStore } from "../../src/store/authStore";

const USER = {
  id: "u-1",
  email: "a@b.com",
  is_active: true,
  is_verified: true,
  is_superuser: false,
  nickname: "Тестер",
  avatar_url: null,
  cups: 0,
  best_single_ms: null,
  best_ao5_ms: null,
  public_handle: null,
  method: null,
  cubing_since_year: null,
};

function renderApp() {
  return render(
    <MemoryRouter initialEntries={["/rules"]}>
      <App />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useAuthStore.setState({ user: USER, status: "authed", bootstrap: async () => {} });
});
afterEach(cleanup);

describe("шапка: бейдж кубков", () => {
  it("нулевые кубки не показываются вовсе", () => {
    renderApp();
    expect(screen.queryByLabelText(/Кубки/)).toBeNull();
  });

  it("появляется, как только кубки есть", () => {
    useAuthStore.setState({ user: { ...USER, cups: 3 }, status: "authed" });
    renderApp();
    expect(screen.getByLabelText("Кубки: 3")).toBeTruthy();
  });
});
