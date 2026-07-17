import type { ButtonHTMLAttributes } from "react";

// §5.1-5.3: primary (default), secondary (surface fill, ink text), and danger
// (destructive actions only, e.g. the tournament two-step commit confirm) all
// share height/radius/hover-lift/focus/disabled — only the fill+text differ.
type Variant = "primary" | "secondary" | "danger";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "bg-primary text-white hover:bg-primary-press",
  secondary: "bg-surface text-ink hover:bg-surface-2",
  danger: "bg-danger text-white hover:bg-danger",
};

export default function Button({
  className = "",
  disabled,
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      disabled={disabled}
      className={[
        "inline-flex h-11 items-center justify-center rounded-full border-2 border-ink",
        "px-4.5 font-sans text-small font-extrabold",
        "transition-transform duration-150 ease-spring",
        VARIANT_CLASSES[variant],
        "hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-sticker",
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
