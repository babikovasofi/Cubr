// §5.9 minimal toast: a tiny zustand queue + a fixed viewport. `toast(msg, kind)`
// can be called from anywhere; the viewport (mounted once in App) renders them and
// auto-dismisses after 4s. Kept deliberately small — one line of copy each.

import { useEffect } from "react";
import { create } from "zustand";

export type ToastKind = "info" | "success" | "error";

interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ToastState {
  items: ToastItem[];
  push: (message: string, kind: ToastKind) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

const useToastStore = create<ToastState>((set) => ({
  items: [],
  push: (message, kind) => set((s) => ({ items: [...s.items, { id: nextId++, message, kind }] })),
  dismiss: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}));

export function toast(message: string, kind: ToastKind = "info"): void {
  useToastStore.getState().push(message, kind);
}

const KIND_ACCENT: Record<ToastKind, string> = {
  info: "border-primary",
  success: "border-success",
  error: "border-danger",
};

function ToastRow({ item }: { item: ToastItem }) {
  const dismiss = useToastStore((s) => s.dismiss);
  useEffect(() => {
    const t = setTimeout(() => dismiss(item.id), 4000);
    return () => clearTimeout(t);
  }, [item.id, dismiss]);

  return (
    <div
      role="status"
      className={`animate-toast-in flex items-center gap-3 rounded-md border-2 border-l-8 border-ink ${KIND_ACCENT[item.kind]} bg-surface px-4 py-3 shadow-sticker`}
    >
      <span className="font-sans text-small text-ink">{item.message}</span>
      <button
        type="button"
        onClick={() => dismiss(item.id)}
        aria-label="Закрыть"
        className="ml-auto font-sans text-small font-bold text-muted"
      >
        ✕
      </button>
    </div>
  );
}

export function ToastViewport() {
  const items = useToastStore((s) => s.items);
  if (items.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(92vw,22rem)] flex-col gap-2">
      {items.map((item) => (
        <div key={item.id} className="pointer-events-auto">
          <ToastRow item={item} />
        </div>
      ))}
    </div>
  );
}
