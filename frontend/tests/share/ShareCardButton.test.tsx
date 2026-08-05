// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import ShareCardButton from "../../src/share/ShareCardButton";
import type { CardData } from "../../src/share/resultCard";

vi.mock("../../src/share/resultCard", async () => {
  const actual = await vi.importActual<typeof import("../../src/share/resultCard")>(
    "../../src/share/resultCard",
  );
  return { ...actual, renderCardBlob: vi.fn() };
});
vi.mock("../../src/share/shareCard", () => ({ shareOrDownload: vi.fn() }));

import { renderCardBlob } from "../../src/share/resultCard";
import { shareOrDownload } from "../../src/share/shareCard";

const DATA: CardData = {
  kind: "solo",
  timeLabel: "12.34",
  dnf: false,
  scramble: "R U2 F'",
  dateLabel: "19.07.2026",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ShareCardButton", () => {
  it("renders the card and shares/downloads it on click", async () => {
    vi.mocked(renderCardBlob).mockResolvedValue(new Blob(["x"]));
    vi.mocked(shareOrDownload).mockResolvedValue("downloaded");

    render(<ShareCardButton data={DATA} />);
    fireEvent.click(screen.getByRole("button", { name: "Скачать PNG" }));

    await waitFor(() => expect(shareOrDownload).toHaveBeenCalledTimes(1));
    expect(renderCardBlob).toHaveBeenCalledWith(DATA);
  });

  it("shows an inline alert and re-enables the button when rendering fails", async () => {
    vi.mocked(renderCardBlob).mockRejectedValue(new Error("2d context unavailable"));

    render(<ShareCardButton data={DATA} />);
    const button = screen.getByRole("button", { name: "Скачать PNG" });
    fireEvent.click(button);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("2d context unavailable");
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });
});
