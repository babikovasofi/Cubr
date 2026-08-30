// @vitest-environment jsdom
//
// Живой чек-лист правил пароля: что зажигается, когда, и какое правило
// прячется без известных почты/ника.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import PasswordChecklist from "../../src/components/PasswordChecklist";
import { PASSWORD_MIN_LENGTH } from "../../src/lib/password";

function ruleState(id: string): string | null {
  return screen.getByTestId(`password-rule-${id}`).getAttribute("data-met");
}

describe("PasswordChecklist", () => {
  it("на пустом поле не отмечает ни одного правила", () => {
    render(<PasswordChecklist password="" identity={{ email: "a@b.ru" }} />);
    expect(ruleState("length")).toBe("false");
    expect(ruleState("identity")).toBe("false");
  });

  it("отмечает длину ровно на минимуме, не раньше", () => {
    const short = "x".repeat(PASSWORD_MIN_LENGTH - 1);
    const { rerender } = render(<PasswordChecklist password={short} />);
    expect(ruleState("length")).toBe("false");

    rerender(<PasswordChecklist password={"x".repeat(PASSWORD_MIN_LENGTH)} />);
    expect(ruleState("length")).toBe("true");
  });

  it("ловит пароль, равный почте, её началу или нику — без учёта регистра", () => {
    const identity = { email: "Kubik@example.com", handle: "speedy" };
    const { rerender } = render(
      <PasswordChecklist password="kubik@example.com" identity={identity} />,
    );
    expect(ruleState("identity")).toBe("false");

    rerender(<PasswordChecklist password="KUBIK" identity={identity} />);
    expect(ruleState("identity")).toBe("false");

    rerender(<PasswordChecklist password="Speedy" identity={identity} />);
    expect(ruleState("identity")).toBe("false");

    rerender(<PasswordChecklist password="синий чайник шагает" identity={identity} />);
    expect(ruleState("identity")).toBe("true");
  });

  it("скрывает правило про почту, когда почта и ник неизвестны (экран сброса)", () => {
    render(<PasswordChecklist password="синий чайник" />);
    expect(screen.getByTestId("password-rule-length")).toBeTruthy();
    expect(screen.queryByTestId("password-rule-identity")).toBeNull();
  });
});
