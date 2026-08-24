// "Друзья" — секция на /profile (plan: friends). Взаимные друзья по нику
// (`handle`), никакого поиска по email — см. swarm-report/friends-plan.md.
// `friendship_id` — единственный идентификатор, который тут вообще
// показывается или передаётся дальше; user id никогда не попадает в разметку
// (§ Acceptance criteria — no PII in rendered markup). `display_name`
// приходит с сервера уже готовым ("Аноним" для пустого ника) и рендерится как
// есть, без t() — тот же приём, что в tournament/TournamentStandings.tsx и
// daily/DailyBoard.tsx.

import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
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
import ChatSection from "./chat/ChatSection";

interface Lists {
  friends: FriendRead[];
  incoming: FriendRequestRead[];
  outgoing: FriendRequestRead[];
}

type LoadState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ok" };

export default function FriendsSection() {
  const t = useT();
  const [lists, setLists] = useState<Lists>({ friends: [], incoming: [], outgoing: [] });
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [openChatFriendshipId, setOpenChatFriendshipId] = useState<string | null>(null);

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

  function reload(): void {
    setReloadKey((k) => k + 1);
  }

  return (
    <section className="flex flex-col gap-4" aria-labelledby="friends-heading">
      <h2 id="friends-heading" className="font-sans text-h3 text-ink">
        {t("Друзья")}
      </h2>

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

          <FriendList
            friends={lists.friends}
            onRemoved={reload}
            onOpenChat={setOpenChatFriendshipId}
          />

          {lists.friends.length > 0 ? (
            <div className="flex flex-col gap-3">
              <h3 className="font-sans text-small font-bold text-ink">{t("Личные сообщения")}</h3>
              <ChatSection openFriendshipId={openChatFriendshipId} />
            </div>
          ) : null}
        </>
      ) : null}
    </section>
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
}: {
  friends: FriendRead[];
  onRemoved: () => void;
  onOpenChat: (friendshipId: string) => void;
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

  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-sans text-small font-bold text-ink">{t("Список друзей")}</h3>

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
        <ul className="flex flex-col gap-2">
          {friends.map((f) => (
            <li
              key={f.friendship_id}
              className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface px-3.5 py-2.5"
            >
              <span className="font-sans text-small text-ink">{f.display_name}</span>
              <div className="flex items-center gap-2">
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
          ))}
        </ul>
      ) : null}
    </div>
  );
}
