// /friends (protected — plan: friends-hub). Friends and requests; chat lives
// on its own screen now (/messages — owner: "давай сделаем удобный чат...
// отдельным окном"), reached via the "Сообщения" link below and the header's
// chat bell. Random-opponent matchmaking moved OFF this screen to the home
// dashboard, next to "Дуэль по ссылке" — it's a duel entry point, not a
// friends feature (owner).

import { Link } from "react-router-dom";
import FriendsSection from "../friends/FriendsSection";
import { useT } from "../i18n/t";

export default function FriendsPage() {
  const t = useT();
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-sans text-h2 text-ink">{t("Друзья")}</h1>
        <Link
          to="/messages"
          className="inline-flex h-11 items-center gap-1.5 rounded-full border-2 border-ink bg-surface px-4 font-sans text-small font-extrabold text-ink no-underline hover:bg-surface-2"
        >
          {t("Сообщения")}
        </Link>
      </div>
      <FriendsSection />
    </div>
  );
}
