// "Соперник найден" splash shown the moment matchmaking pairs, BEFORE the
// cube calibration — a real-games "match found / VS" beat in the app's own
// style (owner). Pulls the opponent (handle, avatar, cups rank) from the
// freshly-paired room, shows you-vs-them, and auto-enters after a short
// countdown (or immediately on the button). Purely presentational; the room
// and session token already exist by the time this renders.

import { useEffect, useState } from "react";
import Button from "../components/Button";
import TrophyIcon from "../components/TrophyIcon";
import { RANKS } from "../components/CupsRoad";
import PresenceAvatar from "./PresenceAvatar";
import { getRoom, type DuelRoomRead } from "../api/duel";
import { useAuthStore } from "../store/authStore";
import { formatHandle } from "../lib/handle";
import { useT } from "../i18n/t";

const AUTO_ENTER_SECONDS = 4;

function Side({
  name,
  avatarUrl,
  cups,
  rankName,
}: {
  name: string;
  avatarUrl: string | null;
  cups: number | null;
  rankName: string | null;
}) {
  const t = useT();
  const rank = rankName ? (RANKS.find((r) => r.name === rankName) ?? null) : null;
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
      <PresenceAvatar displayName={name} online avatarUrl={avatarUrl} size={72} />
      <span className="max-w-full truncate font-sans text-body font-bold text-ink">{name}</span>
      {cups !== null ? (
        <span className="inline-flex items-center gap-1 rounded-full border-2 border-ink bg-warning px-2.5 py-0.5 font-sans text-caption font-black text-ink">
          <TrophyIcon size={13} /> {cups.toLocaleString("ru-RU")}
          {rank ? <span className="font-bold opacity-80"> · {t(rank.label)}</span> : null}
        </span>
      ) : null}
    </div>
  );
}

export default function MatchFoundSplash({
  roomId,
  onProceed,
}: {
  roomId: string;
  onProceed: () => void;
}) {
  const t = useT();
  const me = useAuthStore((s) => s.user);
  const [room, setRoom] = useState<DuelRoomRead | null>(null);
  const [count, setCount] = useState(AUTO_ENTER_SECONDS);

  useEffect(() => {
    const controller = new AbortController();
    getRoom(roomId, controller.signal)
      .then((r) => setRoom(r))
      .catch(() => undefined); // best-effort — splash still shows "соперник" generically
    return () => controller.abort();
  }, [roomId]);

  useEffect(() => {
    const id = setInterval(() => setCount((c) => c - 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (count <= 0) onProceed();
  }, [count, onProceed]);

  const myName = me?.handle ? formatHandle(me.handle) : t("Ты");
  const oppName = room?.opponent_display_name ?? t("Соперник");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4">
      <div className="flex w-full max-w-md flex-col gap-5 rounded-lg border-2 border-ink bg-surface p-6 shadow-sticker">
        <h2 className="text-center font-sans text-h2 font-black text-ink">
          {t("Соперник найден!")}
        </h2>

        <div className="flex items-center gap-3">
          <Side name={myName} avatarUrl={me?.avatar_url ?? null} cups={me?.cups ?? null} rankName={me?.cups_rank ?? null} />
          <span className="shrink-0 font-sans text-h1 font-black text-primary">{t("VS")}</span>
          <Side
            name={oppName}
            avatarUrl={room?.opponent_avatar_url ?? null}
            cups={room?.opponent_cups ?? null}
            rankName={room?.opponent_cups_rank ?? null}
          />
        </div>

        <Button onClick={onProceed} className="w-full justify-center">
          {t("Войти в дуэль")}
        </Button>
        <p className="text-center font-sans text-small text-muted">
          {t("Входим через")} {Math.max(count, 0)}…
        </p>
      </div>
    </div>
  );
}
