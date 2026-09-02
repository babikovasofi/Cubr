// Friend list feed for the messenger sidebar's "Друзья" tab (owner: "в чате
// можно друзей сбоку"). Deliberately its OWN small poll, separate from
// useChatPoll (conversations/messages) — friend presence is unrelated data
// with its own endpoint (`GET /friends`), and useChatPoll must stay the
// single long-poll loop per tab (plan §2); this is a plain interval poll,
// same technique as FriendsSection's presence refresh: skip a backgrounded
// tab, keep the last good list on a failed tick, no loading flicker on a
// silent re-pull.

import { useEffect, useState } from "react";
import { listFriends, type FriendRead } from "../../api/friends";

const FRIENDS_POLL_MS = 15000;

export interface ChatFriendsState {
  friends: FriendRead[];
  loadState: "loading" | "ok" | "error";
}

export interface UseChatFriends extends ChatFriendsState {
  refresh: () => void;
}

export function useChatFriends(): UseChatFriends {
  const [state, setState] = useState<ChatFriendsState>({ friends: [], loadState: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  // External sync: the friend list lives on the server only — fetch on
  // mount and whenever `reloadKey` bumps (manual retry or a poll tick).
  useEffect(() => {
    let alive = true;
    setState((s) => (s.friends.length > 0 ? s : { ...s, loadState: "loading" }));
    listFriends()
      .then((friends) => {
        if (!alive) return;
        setState({ friends, loadState: "ok" });
      })
      .catch(() => {
        if (!alive) return;
        setState((s) => ({ friends: s.friends, loadState: s.friends.length > 0 ? "ok" : "error" }));
      });
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  // External sync: a real wall-clock poll interval, not derivable from render.
  useEffect(() => {
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      setReloadKey((k) => k + 1);
    }, FRIENDS_POLL_MS);
    return () => clearInterval(id);
  }, []);

  return { ...state, refresh: () => setReloadKey((k) => k + 1) };
}
