// "Друзья" tab of the messenger sidebar (owner: "в чате можно друзей сбоку").
// Presentational — data comes from useChatFriends (ChatSection). Same
// presence-grouped layout as FriendsSection.FriendList (online first, then
// offline, hairline-divided rows) but every row is a single tap target that
// opens a chat with that friend — no per-row action buttons here, those
// belong to the Friends page.

import PresenceAvatar from "../PresenceAvatar";
import Spinner from "../../components/Spinner";
import Button from "../../components/Button";
import { useT } from "../../i18n/t";
import type { FriendRead } from "../../api/friends";

export default function ChatFriendsPanel({
  friends,
  loadState,
  onSelect,
  onRetry,
}: {
  friends: FriendRead[];
  loadState: "loading" | "ok" | "error";
  onSelect: (friendshipId: string) => void;
  onRetry: () => void;
}) {
  const t = useT();

  if (loadState === "loading" && friends.length === 0) {
    return <Spinner label={t("Загружаю друзей…")} />;
  }

  if (loadState === "error" && friends.length === 0) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3">
        <p className="font-sans text-small text-danger">{t("Не удалось загрузить друзей.")}</p>
        <Button onClick={onRetry}>{t("Повторить")}</Button>
      </div>
    );
  }

  if (friends.length === 0) {
    return (
      <p className="font-sans text-small text-muted">
        {t("Пока нет друзей — добавь их на странице «Друзья».")}
      </p>
    );
  }

  const online = friends.filter((f) => f.is_online);
  const offline = friends.filter((f) => !f.is_online);

  function group(label: string, list: FriendRead[]) {
    if (list.length === 0) return null;
    return (
      <div className="overflow-hidden rounded-md border border-line" key={label}>
        <div className="border-b border-line bg-surface-2 px-3.5 py-2">
          <span className="font-sans text-caption font-black uppercase tracking-wide text-muted">
            {label} · {list.length}
          </span>
        </div>
        <ul className="divide-y divide-line">
          {list.map((f) => (
            <li key={f.friendship_id}>
              <button
                type="button"
                onClick={() => onSelect(f.friendship_id)}
                className="flex min-h-11 w-full items-center gap-3 bg-surface px-3.5 py-2.5 text-left transition-colors hover:bg-surface-2"
              >
                <PresenceAvatar
                  displayName={f.display_name}
                  online={f.is_online}
                  size={36}
                  avatarUrl={f.avatar_url}
                />
                <span className="min-w-0 flex-1 truncate font-sans text-small font-bold text-ink">
                  {f.display_name}
                </span>
                <span aria-hidden className="shrink-0 font-sans text-body text-muted">
                  ›
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {group(t("В сети"), online)}
      {group(t("Не в сети"), offline)}
    </div>
  );
}
