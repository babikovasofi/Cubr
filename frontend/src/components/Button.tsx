import type { ButtonHTMLAttributes } from "react";

// §5.1 Primary button: primary fill, 2px ink border, radius full, hover lifts
// (-2px,-2px) + shadow-sticker, spring transition, focus ring, disabled state.
export default function Button({
  className = "",
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      disabled={disabled}
      className={[
        "inline-flex h-11 items-center justify-center rounded-full border-2 border-ink",
        "bg-primary px-4.5 font-sans text-small font-extrabold text-white",
        "transition-transform duration-150 ease-spring",
        "hover:-translate-x-0.5 hover:-translate-y-0.5 hover:bg-primary-press hover:shadow-sticker",
        "active:translate-x-0 active:translate-y-0 active:shadow-none",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        "disabled:cursor-not-allowed disabled:border-line disabled:bg-surface-2",
        "disabled:text-faint disabled:shadow-none disabled:translate-x-0 disabled:translate-y-0",
        className,
      ].join(" ")}
      {...props}
    />
  );
}
