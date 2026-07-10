// "Войти через Google": ask the API for the provider authorize URL, then hand the
// browser off to it (a full navigation, so the OAuth cookie/redirect flow works).

import { useState } from "react";
import { googleAuthorizeUrl } from "../api/auth";
import { ApiError } from "../api/client";

export default function GoogleButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      const url = await googleAuthorizeUrl();
      window.location.assign(url);
    } catch (e) {
      setBusy(false);
      setError(e instanceof ApiError ? e.message : "Не удалось начать вход через Google.");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={go}
        disabled={busy}
        className="inline-flex h-11 items-center justify-center rounded-full border-2 border-ink bg-surface px-4.5 font-sans text-small font-extrabold text-ink transition-transform duration-150 ease-spring hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-sticker disabled:cursor-not-allowed disabled:text-faint"
      >
        {busy ? "Открываю Google…" : "Войти через Google"}
      </button>
      {error ? (
        <p role="alert" className="font-sans text-small text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
