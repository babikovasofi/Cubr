// Общий каркас текстовых страниц (правила, приватность) — §3 типографика,
// §5.5 карточка. Никакой логики: только заголовок, дата актуальности и секции.

import type { ReactNode } from "react";

export function DocPage({
  title,
  updated,
  lead,
  children,
}: {
  title: string;
  updated: string;
  lead?: ReactNode;
  children: ReactNode;
}) {
  return (
    <article className="flex max-w-prose flex-col gap-7">
      <header className="flex flex-col gap-3">
        <h1 className="font-sans text-h1 text-ink">{title}</h1>
        <p className="font-sans text-caption uppercase text-muted">Обновлено {updated}</p>
        {lead ? <p className="font-sans text-body text-muted">{lead}</p> : null}
      </header>
      {children}
    </article>
  );
}

export function DocSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-sans text-h2 text-ink">{title}</h2>
      {children}
    </section>
  );
}

export function DocList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="flex list-none flex-col gap-2 p-0">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2 font-sans text-body text-muted">
          <span aria-hidden className="text-faint">
            —
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
