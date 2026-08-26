// /duel — the duel lobby (owner: "заходишь в дуэль и там выбираешь"). ONE entry
// point for every way to start a duel, so the home dashboard shows a single
// uniform "Дуэль" card instead of a mix of button-cards and link-cards:
//   1. Случайный соперник — matchmaking, paired by nearest cups rank.
//   2. Позвать друга — friends who are online right now, invited in one click.
//   3. Дуэль по ссылке — create a room and share its (working) link.
// The realtime duel itself still lives at /duel/:roomId; this is only the
// pre-game chooser.

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import ProfileCard, { CARD_MOTIFS } from "../profile/ProfileCard";
import Button from "../components/Button";
import Spinner from "../components/Spinner";
import { toast } from "../components/Toast";
import MatchmakingPanel from "../friends/MatchmakingPanel";
import PresenceAvatar from "../friends/PresenceAvatar";
import { listFriends, type FriendRead } from "../api/friends";
import { sendInvite } from "../api/chat";
import { createRoom, saveDuelSessionToken } from "../api/duel";
import { ApiError } from "../api/client";
import { useT } from "../i18n/t";

export default function DuelLobbyPage() {
  const t = useT();

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="font-sans text-h1 text-ink">{t("Дуэль")}</h1>
        <p className="max-w-prose font-sans text-body text-muted">
          {t("Выбери, как начать: случайный соперник, друг из тех, кто в сети, или ссылка.")}
        </p>
      </div>

      <ProfileCard
        title={t("Случайный соперник")}
        motif={CARD_MOTIFS.matchmaking}
        accent="var(--live)"
      >
        <p className="font-sans text-small text-muted">
          {t("Найдём соперника онлайн с близким рангом кубков — как только есть пара, оба в дуэль.")}
        </p>
        <MatchmakingPanel />
      </ProfileCard>

      <ProfileCard title={t("Позвать друга")} motif={CARD_MOTIFS.friends} accent="var(--danger)">
        <OnlineFriends />
      </ProfileCard>

      <ProfileCard title={t("Дуэль по ссылке")} motif={CARD_MOTIFS.chat} accent="var(--primary)">
        <LinkDuel />
      </ProfileCard>
    </div>
  );
}

function OnlineFriends() {
  const t = useT();
  const [friends, setFriends] = useState<FriendRead[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    listFriends(controller.signal)
      .then((list) => {
        if (alive) setFriends(list);
      })
      .catch((e: unknown) => {
        if (!alive || controller.signal.aborted) return;
        setError(e instanceof ApiError ? t(e.message) : t("Не удалось загрузить друзей."));
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, []);

  async function invite(friend: FriendRead): Promise<void> {
    setBusyId(friend.friendship_id);
    try {
      await sendInvite(friend.friendship_id);
      setInvitedIds((prev) => new Set(prev).add(friend.friendship_id));
      toast(t("Приглашение отправлено — ждём ответа."), "success");
    } catch (e) {
      toast(e instanceof ApiError ? t(e.message) : t("Не удалось позвать друга."), "error");
    } finally {
      setBusyId(null);
    }
  }

  if (error) {
    return (
      <p role="alert" className="font-sans text-small text-danger">
        {error}
      </p>
    );
  }
  if (friends === null) {
    return <Spinner label={t("Загружаю друзей…")} />;
  }

  const online = friends.filter((f) => f.is_online);

  return (
    <div className="flex flex-col gap-3">
      {online.length === 0 ? (
        <p className="font-sans text-small text-muted">
          {t("Сейчас никого из друзей нет в сети.")}
        </p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-md border border-line">
          {online.map((f) => (
            <li
              key={f.friendship_id}
              className="flex flex-wrap items-center justify-between gap-3 bg-surface px-3.5 py-3"
            >
              <span className="flex min-w-0 items-center gap-3">
                <PresenceAvatar displayName={f.display_name} online size={40} />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-sans text-small font-bold text-ink">
                    {f.display_name}
                  </span>
                  <span className="font-sans text-caption text-success">{t("в сети")}</span>
                </span>
              </span>
              <Button
                disabled={busyId === f.friendship_id || invitedIds.has(f.friendship_id)}
                onClick={() => void invite(f)}
              >
                {invitedIds.has(f.friendship_id) ? t("Позвали") : t("Позвать")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Link to="/friends" className="self-start font-sans text-small font-bold text-primary">
        {t("Все друзья и заявки →")}
      </Link>
    </div>
  );
}

function LinkDuel() {
  const t = useT();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const room = await createRoom();
      saveDuelSessionToken(room.room_id, room.session_token);
      navigate(`/duel/${room.room_id}`, { state: { joinUrl: room.join_url } });
    } catch {
      setError(t("Не удалось создать дуэль. Попробуй ещё раз."));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="font-sans text-small text-muted">
        {t("Создай комнату и пришли ссылку сопернику — старт синхронный, один общий скрамбл.")}
      </p>
      <Button onClick={() => void start()} disabled={busy} className="self-start">
        {busy ? t("Создаю комнату…") : t("Создать ссылку на дуэль")}
      </Button>
      {error ? (
        <p role="alert" className="font-sans text-small text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
