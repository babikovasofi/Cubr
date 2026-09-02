// /messages (protected, no DesktopOnlyGate — a chat window is exactly the
// kind of screen that should work on a phone). A full-screen messenger:
// friends + conversations sidebar on the left, the open conversation on the
// right (owner: "давай сделаем удобный чат... можно сделать отдельным
// окном"). Supports the `?friendship=<id>` deep link from the "Написать"
// button on a friend row (Friends page) and the "Позвать на дуэль" toast.

import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import ChatSection from "../friends/chat/ChatSection";
import { useT } from "../i18n/t";

export default function MessagesPage() {
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  // Read once, via a lazy initializer — NOT `searchParams.get(...)` on every
  // render — so clearing the param below can't itself flip this back to
  // `null` on the next render (belt-and-suspenders alongside ChatSection's
  // own apply-once ref: review finding #1). Cleared from the URL right after
  // so a reload, or the browser's back/forward, doesn't reopen this friend's
  // chat on top of wherever the reader has since navigated.
  const [friendshipId] = useState(() => searchParams.get("friendship"));

  useEffect(() => {
    if (!friendshipId) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("friendship");
        return next;
      },
      { replace: true },
    );
    // Runs once on mount for this deep link — friendshipId itself never
    // changes after the initializer above.
  }, []);

  return (
    // Fills whatever room App.tsx's `main` has left after the header,
    // BackBar and footer — a plain flex-1/min-h-0 chain (root → main → this
    // div), no pixel arithmetic about any of their heights.
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <h1 className="font-sans text-h2 text-ink">{t("Сообщения")}</h1>
        <Link
          to="/friends"
          className="inline-flex h-11 items-center gap-1.5 rounded-full border-2 border-ink bg-surface px-4 font-sans text-small font-extrabold text-ink no-underline hover:bg-surface-2"
        >
          {t("Друзья")}
        </Link>
      </div>
      <ChatSection openFriendshipId={friendshipId} className="min-h-0 flex-1" />
    </div>
  );
}
