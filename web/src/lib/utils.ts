import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

// Small per-browser preferences (effects mode, filters). Storage can be blocked; the app works without it.
export const store = {
  get<T>(key: string, fallback: T): T {
    try { const v = localStorage.getItem(`blix:${key}`); return v == null ? fallback : (JSON.parse(v) as T); } catch { return fallback; }
  },
  set(key: string, value: unknown) {
    try { localStorage.setItem(`blix:${key}`, JSON.stringify(value)); } catch { /* private window */ }
  },
};
