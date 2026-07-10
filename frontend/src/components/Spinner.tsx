// Minimal loading spinner reusing the design tokens (ink border, primary accent).

export default function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden
        className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-line border-t-primary"
      />
      {label ? <span className="font-sans text-small text-muted">{label}</span> : null}
      <span className="sr-only">{label ?? "Загрузка"}</span>
    </div>
  );
}
