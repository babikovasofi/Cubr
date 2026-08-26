// Duel-invite chat bubble (friends-hub plan, Этап B). Renders EVERY state a
// `DuelInviteRead` can be in — pending (invitee sees Accept/Decline, inviter
// sees Cancel), accepted (both sides get "Войти в дуэль"), declined/
// canceled/expired (quiet terminal text, deliberately NOT `danger`-red —
// design: terminal states are quiet, not alarming). `can_accept`/
// `can_decline`/`can_cancel` and `state` are trusted as-is from the server,
// never re-derived here (see DuelInviteRead's docstring in api/chat.ts).
//
// TTL countdown: `seconds_left` is a snapshot from the last server read
// (accept/decline/cancel response, or a poll-triggered refetch of the open
// conversation — see useChatPoll's `refetchOpenConversation`). A local 1s
// ticker counts down BETWEEN those reads so the buttons go quiet right at
// zero instead of staying clickable until the next network round trip
// (plan: "по 0 кнопка гаснет, а не 404"). Design: the countdown digits stay
// `ink` (never yellow — contrast) with a separate small `warning` dot next
// to them, not colored digits.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "../../components/Button";
import { toast } from "../../components/Toast";
import { ApiError } from "../../api/client";
import { saveDuelSessionToken } from "../../api/duel";
import {
  acceptInvite,
  cancelInvite,
  declineInvite,
  type ChatMessage,
  type DuelInviteActionRead,
  type DuelInviteRead,
} from "../../api/chat";
import { useT } from "../../i18n/t";

function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return `${m}:${String(rest).padStart(2, "0")}`;
}

function patchFromAction(invite: DuelInviteRead, action: DuelInviteActionRead): DuelInviteRead {
  return {
    ...invite,
    state: action.state,
    room_id: action.room_id,
    session_token: action.session_token ?? invite.session_token,
    can_accept: false,
    can_decline: false,
    can_cancel: false,
    seconds_left: 0,
  };
}

export default function InviteMessage({
  message,
  meUserId,
  friendDisplayName,
  onInviteUpdated,
}: {
  message: ChatMessage;
  meUserId: string | null;
  friendDisplayName: string;
  onInviteUpdated: (messageId: string, invite: DuelInviteRead) => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const invite = message.invite;
  const [busy, setBusy] = useState(false);
  const [localSecondsLeft, setLocalSecondsLeft] = useState(invite?.seconds_left ?? 0);

  // External sync: reset the local ticker whenever a fresh server read hands
  // us a new seconds_left (accept/decline/cancel response, or a poll-driven
  // refetch) — not derived during render, this is re-seeding a clock off an
  // external source of truth.
  useEffect(() => {
    setLocalSecondsLeft(invite?.seconds_left ?? 0);
  }, [invite?.seconds_left, invite?.state]);

  // External sync: a real wall-clock ticker, not something render can derive.
  useEffect(() => {
    if (!invite || invite.state !== "pending") return;
    const timer = setInterval(() => {
      setLocalSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [invite?.id, invite?.state]);

  if (!invite) return null; // defensive — kind === "invite" always carries one server-side

  const isInviter = meUserId !== null && invite.inviter_id === meUserId;
  const expiredLocally = localSecondsLeft <= 0;
  const meLabel = t("Ты");
  const leftLabel = isInviter ? meLabel : friendDisplayName;
  const rightLabel = isInviter ? friendDisplayName : meLabel;

  async function run(action: () => Promise<DuelInviteActionRead>, navigateOnAccept: boolean) {
    setBusy(true);
    try {
      const result = await action();
      // Non-null: `run` is only ever wired to onClick handlers below, all of
      // which exist only once the `if (!invite) return null` guard above has
      // already passed — TS just can't see that across the closure boundary.
      const patched = patchFromAction(invite!, result);
      onInviteUpdated(message.id, patched);
      if (navigateOnAccept && patched.room_id && patched.session_token) {
        saveDuelSessionToken(patched.room_id, patched.session_token);
        navigate(`/duel/${patched.room_id}`);
      }
    } catch (e) {
      toast(
        e instanceof ApiError ? t(e.message) : t("Не удалось выполнить действие."),
        "error",
      );
    } finally {
      setBusy(false);
    }
  }

  function enterDuel() {
    if (!invite || !invite.room_id || !invite.session_token) return;
    saveDuelSessionToken(invite.room_id, invite.session_token);
    navigate(`/duel/${invite.room_id}`);
  }

  return (
    <div className="flex w-full max-w-[85%] flex-col items-center gap-3 rounded-md border-2 border-ink bg-surface p-4 shadow-sticker">
      <div className="flex items-center gap-3">
        <span className="max-w-[10ch] truncate font-sans text-small font-bold text-ink">
          {leftLabel}
        </span>
        <span className="font-sans text-h3 text-ink">{t("VS")}</span>
        <span className="max-w-[10ch] truncate font-sans text-small font-bold text-ink">
          {rightLabel}
        </span>
      </div>

      {invite.state === "pending" ? (
        <>
          <div className="flex items-center justify-center gap-2">
            <span className="font-sans text-small font-black text-ink">
              {formatCountdown(localSecondsLeft)}
            </span>
            <span
              aria-hidden
              className="h-2 w-2 rounded-full"
              style={{ background: "var(--warning)" }}
            />
          </div>
          {isInviter ? (
            <Button
              variant="secondary"
              disabled={busy || !invite.can_cancel || expiredLocally}
              onClick={() => void run(() => cancelInvite(invite.id), false)}
            >
              {busy ? t("Отменяю…") : t("Отменить")}
            </Button>
          ) : (
            <div className="flex items-center justify-center gap-2">
              <Button
                disabled={busy || !invite.can_accept || expiredLocally}
                onClick={() => void run(() => acceptInvite(invite.id), true)}
              >
                {busy ? t("Принимаю…") : t("Принять")}
              </Button>
              <Button
                variant="secondary"
                disabled={busy || !invite.can_decline || expiredLocally}
                onClick={() => void run(() => declineInvite(invite.id), false)}
              >
                {t("Отклонить")}
              </Button>
            </div>
          )}
        </>
      ) : null}

      {invite.state === "accepted" ? (
        <Button disabled={!invite.room_id || !invite.session_token} onClick={enterDuel}>
          {t("Войти в дуэль")}
        </Button>
      ) : null}

      {invite.state === "declined" ? (
        <p className="font-sans text-small text-muted">{t("Приглашение отклонено.")}</p>
      ) : null}
      {invite.state === "canceled" ? (
        <p className="font-sans text-small text-muted">{t("Приглашение отменено.")}</p>
      ) : null}
      {invite.state === "expired" ? (
        <p className="font-sans text-small text-muted">{t("Время приглашения истекло.")}</p>
      ) : null}
    </div>
  );
}
