import { create } from "zustand";

// A toast is for a failure or for something that happened out of sight. Success on screen is silent.
const useToasts = create<{ items: { id: number; text: string }[] }>(() => ({ items: [] }));
let seq = 0;
export function toast(text: string) {
  const id = ++seq;
  useToasts.setState((s) => ({ items: [...s.items.slice(-2), { id, text }] }));
  setTimeout(() => useToasts.setState((s) => ({ items: s.items.filter((t) => t.id !== id) })), 4000);
}

export function Toaster() {
  const items = useToasts((s) => s.items);
  return (
    <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-40 flex flex-col gap-2 max-md:right-2 max-md:bottom-16">
      {items.map((t) => (
        <div key={t.id} className="animate-row-in rounded-control border border-rule-2 bg-paper-4 px-3 py-2 text-sm text-ink shadow-sheet">{t.text}</div>
      ))}
    </div>
  );
}
