// /friends (protected — plan: friends-hub). Friends, requests and chat. Each
// logical block is its OWN card (FriendsSection emits a "Друзья" card and a
// "Личные сообщения" card) so they read as separate sections instead of
// blending into one panel. Random-opponent matchmaking moved OFF this screen
// to the home dashboard, next to "Дуэль по ссылке" — it's a duel entry point,
// not a friends feature (owner).

import FriendsSection from "../friends/FriendsSection";

export default function FriendsPage() {
  return (
    <div className="flex flex-col gap-5">
      <FriendsSection />
    </div>
  );
}
