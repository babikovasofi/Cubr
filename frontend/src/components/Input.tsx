// §5.4 form field: label tied to input, ink border, focus ring, inline error.
// `ref` is a normal prop (React 19). Errors render below with aria-describedby.

import { useId, type InputHTMLAttributes, type Ref } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string | null;
  /** Постоянная подсказка под полем (правила ввода), видимая до отправки. */
  hint?: string | null;
  ref?: Ref<HTMLInputElement>;
}

export default function Input({
  label,
  error,
  hint,
  id,
  className = "",
  ref,
  ...props
}: InputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  // Ошибка важнее подсказки, но подсказка остаётся озвученной: скринридер
  // читает обе, ошибку первой.
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ");

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="font-sans text-small font-bold text-ink">
        {label}
      </label>
      <input
        id={inputId}
        ref={ref}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={[
          "h-11 rounded-md border-2 border-ink bg-surface px-3.5 font-sans text-body text-ink",
          "placeholder:text-faint",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
          error ? "border-danger" : "",
          className,
        ].join(" ")}
        {...props}
      />
      {error ? (
        <p id={errorId} role="alert" className="font-sans text-small text-danger">
          {error}
        </p>
      ) : null}
      {hint ? (
        <p id={hintId} className="font-sans text-small text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
