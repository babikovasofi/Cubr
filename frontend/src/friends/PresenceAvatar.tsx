// Round avatar for a friend row / profile. Shows the person's uploaded photo
// when there is one, otherwise their first letter (owner: the corner presence
// square looked strange and was removed — online/offline is stated in words
// next to the name instead, and kept here as sr-only text for a11y).

import { useT } from "../i18n/t";

export default function PresenceAvatar({
  displayName,
  online,
  size = 40,
  avatarUrl = null,
}: {
  displayName: string;
  online: boolean;
  size?: number;
  avatarUrl?: string | null;
}) {
  const t = useT();
  const letter = displayName.trim().charAt(0).toUpperCase() || "?";

  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt=""
          className="h-full w-full rounded-full border-2 border-ink object-cover"
        />
      ) : (
        <span
          aria-hidden
          className="flex h-full w-full items-center justify-center rounded-full border-2 border-ink bg-surface-2 font-sans text-small font-black text-ink"
        >
          {letter}
        </span>
      )}
      <span className="sr-only">{online ? t("В сети") : t("Не в сети")}</span>
    </span>
  );
}
