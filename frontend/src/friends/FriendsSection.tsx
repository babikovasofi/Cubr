// "Друзья" — секция на /profile (plan: friends). Взаимные друзья по нику
// (`handle`), никакого поиска по email — см. swarm-report/friends-plan.md.
// `friendship_id` — единственный идентификатор, который тут вообще
// показывается или передаётся дальше; user id никогда не попадает в разметку
// (§ Acceptance criteria — no PII in rendered markup). `display_name`
// приходит с сервера уже готовым ("Аноним" для пустого ника) и рендерится как
// есть, без t() — тот же приём, что в tournament/TournamentStandings.tsx и
// daily/DailyBoard.tsx.

import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import Button from "../components/Button";
import Input from "../components/Input";
import Spinner from "../components/Spinner";
import { ApiError } from "../api/client";
import {
  acceptRequest,
  deleteRequest,
  listFriends,
  listIncoming,
  listOutgoing,
  removeFriend,
  sendRequest,
  type FriendRead,
  type FriendRequestRead,
} from "../api/friends";
import { useChallengeFriend } from "./useChallengeFriend";
import { stripHandlePrefix } from "../lib/handle";
import { useT } from "../i18n/t";
import PresenceAvatar from "./PresenceAvatar";
import FriendProfileModal from "./FriendProfileModal";
import ProfileCard, { CARD_MOTIFS } from "../profile/ProfileCard";

interface Lists {
  friends: FriendRead[];
  incoming: FriendRequestRead[];
  outgoing: FriendRequestRead[];
}

// How often to silently re-pull the friend list so presence dots (and any
// new requests) stay fresh without a manual reload. 15s: responsive against
// the 60s server presence window, well under the 60/min /friends limit.
const FRIENDS_POLL_MS = 15000;

type LoadState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ok" };

export default function FriendsSection() {
  const t = useT();
  const navigate = useNavigate();
  const [lists, setLists] = useState<Lists>({ friends: [], incoming: [], outgoing: [] });
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [profileFriend, setProfileFriend] = useState<FriendRead | null>(null);

  // External sync: friend/request lists live on the server only, no local
  // source of truth to derive from — a plain fetch-on-mount(+reloadKey), same
  // shape as ProfilePage's own History().
  useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    Promise.all([listFriends(), listIncoming(), listOutgoing()])
      .then(([friends, incoming, outgoing]) => {
        if (!alive) return;
        setLists({ friends, incoming, outgoing });
        setState({ kind: "ok" });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setState({
          kind: "error",
          message: e instanceof ApiError ? t(e.message) : t("Не удалось загрузить друзей."),
        });
      });
    return () => {
      alive = false;
    };
    // reloadKey is the only real trigger — t() only reads from the lang store.
  }, [reloadKey]);

  // Presence auto-refresh: a friend's `is_online` only changes server-side
  // (their `user_presence.last_seen_at`), so without polling the list stays
  // frozen at whatever it was on load — the owner had to reload by hand to
  // see someone come online. Silently re-pull every FRIENDS_POLL_MS (no
  // loading flicker; keep the last good data on a failed tick), and skip a
  // backgrounded tab. 15s against a 60s presence window and a 60/min limit
  // is comfortably within budget.
  useEffect(() => {
    let alive = true;
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      Promise.all([listFriends(), listIncoming(), listOutgoing()])
        .then(([friends, incoming, outgoing]) => {
          if (!alive) return;
          setLists({ friends, incoming, outgoing });
          setState({ kind: "ok" });
        })
        .catch(() => undefined);
    }, FRIENDS_POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  function reload(): void {
    setReloadKey((k) => k + 1);
  }

  return (
    <>
      <ProfileCard title={t("Друзья")} motif={CARD_MOTIFS.friends} accent="var(--danger)">
        <AddFriendForm onSent={reload} />

        {state.kind === "loading" ? <Spinner label={t("Загружаю друзей…")} /> : null}

        {state.kind === "error" ? (
          <div role="alert" className="flex flex-col items-start gap-3">
            <p className="font-sans text-small text-danger">{state.message}</p>
            <Button onClick={reload}>{t("Повторить")}</Button>
          </div>
        ) : null}

        {state.kind === "ok" ? (
          <>
            {lists.incoming.length > 0 ? (
              <RequestList
                title={t("Входящие заявки")}
                requests={lists.incoming}
                primaryLabel={t("Принять")}
                onPrimary={(id) => acceptRequest(id).then(reload)}
                secondaryLabel={t("Отклонить")}
                onSecondary={(id) => deleteRequest(id).then(reload)}
              />
            ) : null}

            {lists.outgoing.length > 0 ? (
              <RequestList
                title={t("Исходящие заявки")}
                requests={lists.outgoing}
                secondaryLabel={t("Отменить")}
                onSecondary={(id) => deleteRequest(id).then(reload)}
              />
            ) : null}
          </>
        ) : null}
      </ProfileCard>

      {state.kind === "ok" ? (
        <ProfileCard title={t("Список друзей")} motif={CARD_MOTIFS.badges} accent="var(--warning)">
          <FriendList
            friends={lists.friends}
            onRemoved={reload}
            onOpenChat={(friendshipId) =>
              navigate(`/messages?friendship=${encodeURIComponent(friendshipId)}`)
            }
            onOpenProfile={setProfileFriend}
          />
        </ProfileCard>
      ) : null}

      {profileFriend ? (
        <FriendProfileModal
          friendshipId={profileFriend.friendship_id}
          displayName={profileFriend.display_name}
          online={profileFriend.is_online}
          avatarUrl={profileFriend.avatar_url}
          onClose={() => setProfileFriend(null)}
        />
      ) : null}
    </>
  );
}

function AddFriendForm({ onSent }: { onSent: () => void }) {
  const t = useT();
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = handle.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await sendRequest(trimmed);
      setHandle("");
      onSent();
    } catch (err) {
      // 404 (unknown handle) carries no `code` on the wire — it is not
      // FriendConflictError/HandleRequired, just a bare 404 (plan §7) — so it
      // needs its own status check rather than a RU_BY_CODE lookup.
      if (err instanceof ApiError && err.status === 404) {
        setError(t("Такого ника нет."));
      } else if (err instanceof ApiError) {
        setError(t(err.message));
      } else {
        setError(t("Не удалось отправить заявку."));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-wrap items-end gap-3" onSubmit={onSubmit} noValidate>
      <div className="flex flex-col gap-1.5">
        <Input
          label={t("Ник друга")}
          maxLength={64}
          value={handle}
          onChange={(e) => setHandle(stripHandlePrefix(e.target.value))}
          error={error}
        />
        <p className="font-sans text-small text-muted">
          {t("Буквы, цифры, пробел, дефис, точка и подчёркивание.")}
        </p>
      </div>
      <Button type="submit" disabled={busy || !handle.trim()}>
        {busy ? t("Отправляю…") : t("Отправить заявку")}
      </Button>
    </form>
  );
}

function RequestList({
  title,
  requests,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
}: {
  title: string;
  requests: FriendRequestRead[];
  primaryLabel?: string;
  onPrimary?: (friendshipId: string) => Promise<unknown>;
  secondaryLabel: string;
  onSecondary: (friendshipId: string) => Promise<unknown>;
}) {
  const t = useT();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: (id: string) => Promise<unknown>, id: string) {
    setBusyId(id);
    setError(null);
    try {
      await action(id);
    } catch (e) {
      setError(e instanceof ApiError ? t(e.message) : t("Не удалось выполнить действие."));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-sans text-small font-bold text-ink">{title}</h3>
      {error ? (
        <p role="alert" className="font-sans text-small text-danger">
          {error}
        </p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {requests.map((r) => (
          <li
            key={r.friendship_id}
            className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface px-3.5 py-2.5"
          >
            <span className="font-sans text-small text-ink">{r.display_name}</span>
            <div className="flex items-center gap-2">
              {onPrimary && primaryLabel ? (
                <Button
                  variant="secondary"
                  disabled={busyId === r.friendship_id}
                  onClick={() => void run(onPrimary, r.friendship_id)}
                >
                  {primaryLabel}
                </Button>
              ) : null}
              <Button
                variant="secondary"
                disabled={busyId === r.friendship_id}
                onClick={() => void run(onSecondary, r.friendship_id)}
              >
                {secondaryLabel}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FriendList({
  friends,
  onRemoved,
  onOpenChat,
  onOpenProfile,
}: {
  friends: FriendRead[];
  onRemoved: () => void;
  onOpenChat: (friendshipId: string) => void;
  onOpenProfile: (friend: FriendRead) => void;
}) {
  const t = useT();
  const challenge = useChallengeFriend();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  async function onRemove(id: string) {
    setBusyId(id);
    setRemoveError(null);
    try {
      await removeFriend(id);
      onRemoved();
    } catch (e) {
      setRemoveError(e instanceof ApiError ? t(e.message) : t("Не удалось удалить."));
    } finally {
      setBusyId(null);
    }
  }

  // Presence-grouped, online first — the pattern every game friends list uses
  // (Discord/Steam: "Online"/"Offline" sections, count in the header). Each
  // group is a bordered list with hairline dividers between rows so entries
  // read as distinct, not one blended stack (owner: "разграничь как в играх").
  const online = friends.filter((f) => f.is_online);
  const offline = friends.filter((f) => !f.is_online);

  // Grid, not flex-wrap: with wrap, a row's shape depended on how long the
  // nickname happened to be — a short one kept the buttons inline, a long one
  // pushed them onto their own line, so neighbouring rows looked like two
  // different designs (owner: "по разному выглядит"). One column up to `sm`
  // (name above, buttons below — the same for every row), two from `sm` on,
  // where the name truncates instead of pushing anything anywhere.
  function friendRow(f: FriendRead) {
    return (
      <li
        key={f.friendship_id}
        className="grid grid-cols-1 gap-2.5 bg-surface px-3.5 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-3"
      >
        <button
          type="button"
          onClick={() => onOpenProfile(f)}
          aria-label={t("Открыть профиль игрока")}
          className="flex w-full min-w-0 items-center gap-3 rounded-md text-left hover:opacity-80"
        >
          <PresenceAvatar
            displayName={f.display_name}
            online={f.is_online}
            size={40}
            avatarUrl={f.avatar_url}
          />
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-sans text-small font-bold text-ink">
              {f.display_name}
            </span>
            <span
              className={`font-sans text-caption ${f.is_online ? "text-success" : "text-muted"}`}
            >
              {f.is_online ? t("в сети") : t("не в сети")}
            </span>
          </span>
        </button>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <Button variant="secondary" onClick={() => onOpenChat(f.friendship_id)}>
            {t("Написать")}
          </Button>
          <Button disabled={challenge.busy} onClick={() => void challenge.challenge()}>
            {t("Вызвать")}
          </Button>
          <Button
            variant="secondary"
            disabled={busyId === f.friendship_id}
            onClick={() => void onRemove(f.friendship_id)}
          >
            {t("Удалить")}
          </Button>
        </div>
      </li>
    );
  }

  function group(label: string, list: FriendRead[]) {
    if (list.length === 0) return null;
    return (
      <div className="overflow-hidden rounded-md border border-line">
        <div className="border-b border-line bg-surface-2 px-3.5 py-2">
          <span className="font-sans text-caption font-black uppercase tracking-wide text-muted">
            {label} · {list.length}
          </span>
        </div>
        <ul className="divide-y divide-line">{list.map(friendRow)}</ul>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {friends.length === 0 ? (
        <p className="font-sans text-small text-muted">
          {t("Пока нет друзей — добавь кого-нибудь по нику выше.")}
        </p>
      ) : null}

      {challenge.error ? (
        <div role="alert" className="flex flex-wrap items-center gap-3">
          <p className="font-sans text-small text-danger">{challenge.error}</p>
          {challenge.existingRoomId ? (
            <Link to={`/duel/${challenge.existingRoomId}`}>
              <Button variant="secondary">{t("Перейти к активной дуэли")}</Button>
            </Link>
          ) : null}
        </div>
      ) : null}

      {removeError ? (
        <p role="alert" className="font-sans text-small text-danger">
          {removeError}
        </p>
      ) : null}

      {friends.length > 0 ? (
        <div className="flex flex-col gap-3">
          {group(t("В сети"), online)}
          {group(t("Не в сети"), offline)}
        </div>
      ) : null}
    </div>
  );
}
