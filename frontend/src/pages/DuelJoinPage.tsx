// /duel/join/:token — accepts a duel invite (plan: stage4-duel-by-link).
// Wrapped in ProtectedRoute by App.tsx, so an anon visitor is bounced through
// /login?next=/duel/join/<token> and lands back here after signing in —
// ProtectedRoute's existing `next` handling already covers this path with NO
// changes (see auth/onboarding.ts's isSafeLocalPath: any single-leading-slash
// path, which /duel/join/<token> is, survives the round trip through login).

import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Button from "../components/Button";
import Spinner from "../components/Spinner";
import { ApiError } from "../api/client";
import { existingRoomIdFrom, joinRoom, saveDuelSessionToken } from "../api/duel";

type JoinState = "joining" | "not_found" | "already_active" | "error";

export default function DuelJoinPage() {
  const { token = "" } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [state, setState] = useState<JoinState>("joining");
  const [existingRoomId, setExistingRoomId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run(): Promise<void> {
      try {
        const joined = await joinRoom(token);
        if (cancelled) return;
        saveDuelSessionToken(joined.room_id, joined.session_token);
        navigate(`/duel/${joined.room_id}`, { replace: true });
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404) {
          setState("not_found");
        } else if (e instanceof ApiError && e.status === 409) {
          setExistingRoomId(existingRoomIdFrom(e));
          setState("already_active");
        } else {
          setState("error");
        }
      }
    }
    void run();

    return () => {
      cancelled = true;
    };
  }, [token, navigate]);

  if (state === "joining") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center" aria-live="polite">
        <Spinner label="Подключаюсь к дуэли…" />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-4 rounded-lg border-2 border-ink bg-surface p-7">
      {state === "not_found" ? (
        <p role="alert" className="max-w-prose font-sans text-body text-danger">
          Ссылка на дуэль недействительна или устарела.
        </p>
      ) : null}

      {state === "already_active" ? (
        <>
          <p role="alert" className="max-w-prose font-sans text-body text-danger">
            У тебя уже есть активная дуэль — сначала заверши её.
          </p>
          {existingRoomId ? (
            <Link to={`/duel/${existingRoomId}`}>
              <Button>Перейти к активной дуэли</Button>
            </Link>
          ) : null}
        </>
      ) : null}

      {state === "error" ? (
        <p role="alert" className="max-w-prose font-sans text-body text-danger">
          Не удалось подключиться к дуэли. Попробуй ещё раз.
        </p>
      ) : null}

      <Link to="/">
        <Button variant="secondary">На главную</Button>
      </Link>
    </div>
  );
}
