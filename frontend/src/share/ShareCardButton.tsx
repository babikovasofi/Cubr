// Behavior + presentational share/download button (plan: result-share-card).
// One action: render the 1080x1080 PNG, then hand it to shareOrDownload,
// which itself decides share-vs-download at click time (see shareCard.ts).
// "Скачать PNG" is the always-true label — download is the guaranteed
// fallback whenever the native share sheet isn't available.

import { useState } from "react";
import Button from "../components/Button";
import { renderCardBlob, type CardData } from "./resultCard";
import { shareOrDownload } from "./shareCard";

export interface ShareCardButtonProps {
  data: CardData;
}

const SHARE_META = { title: "Мой результат в Cubr", text: "Мой результат в Cubr" };

export default function ShareCardButton({ data }: ShareCardButtonProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const blob = await renderCardBlob(data);
      const filename = `cubr-result-${Date.now()}.png`;
      await shareOrDownload(blob, filename, SHARE_META);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать карточку. Попробуй ещё раз.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <Button type="button" variant="secondary" onClick={() => void handleClick()} disabled={busy}>
        {busy ? "Готовлю карточку…" : "Скачать PNG"}
      </Button>
      {error ? (
        <p role="alert" className="max-w-prose font-sans text-small text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
