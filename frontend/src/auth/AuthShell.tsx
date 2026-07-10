// Shared centered card for the auth screens. Keeps each page presentational.

import type { ReactNode } from "react";

interface AuthShellProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}

export default function AuthShell({ title, subtitle, children, footer }: AuthShellProps) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-sans text-h2 text-ink">{title}</h1>
        {subtitle ? <p className="font-sans text-body text-muted">{subtitle}</p> : null}
      </div>
      <div className="flex flex-col gap-4 rounded-lg border-2 border-ink bg-surface p-6 shadow-sticker">
        {children}
      </div>
      {footer ? <div className="font-sans text-small text-muted">{footer}</div> : null}
    </div>
  );
}
