// /friends (protected — plan: friends-hub). Friends, requests, chat, and
// random-opponent matchmaking all live on this one screen now (moved off
// /profile, which keeps only a short link — see ProfilePage). Matchmaking
// sits above the friend list: "I don't care who" vs. "someone I know" are
// two entry points into a duel on the same page, not two different screens.

import ProfileCard, { CARD_MOTIFS } from "../profile/ProfileCard";
import FriendsSection from "../friends/FriendsSection";
import MatchmakingPanel from "../friends/MatchmakingPanel";
import { useT } from "../i18n/t";

export default function FriendsPage() {
  const t = useT();

  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-sans text-h2 text-ink">{t("Друзья")}</h1>

      <ProfileCard
        title={t("Случайный соперник")}
        motif={CARD_MOTIFS.matchmaking}
        accent="var(--live)"
      >
        <MatchmakingPanel />
      </ProfileCard>

      {/* FriendsSection renders its own "Друзья" heading — no title here,
          same reason as its old spot on /profile. */}
      <ProfileCard motif={CARD_MOTIFS.friends} accent="var(--danger)">
        <FriendsSection />
      </ProfileCard>
    </div>
  );
}
