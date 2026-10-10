// Who is using this page: the owner (this PC, or signed in with one of the owner's Google accounts on
// blixvip.com), a member (anyone else signed in with Google there, server/webapp.js) or a visitor (the read-only
// public view). Members trade paper only and do not see the owner's settings, wallets or coin launcher; the server
// refuses those to them anyway.
import { useSyncExternalStore } from "react";
import { fetchApi, onDirectLine } from "./api";
import { setPaper } from "./mode";
import { store } from "./utils";

export type Role = "owner" | "member" | "visitor";
// Until the server has said: the role this browser had last time, else member on blixvip.com (nearly everyone
// there) and owner on this PC. A member used to start as the owner, so the settings and launcher entries showed
// for a moment on every load and then vanished.
const KNOWN: Role[] = ["owner", "member", "visitor"];
const remembered = store.get<Role | null>("role", null);
let role: Role = remembered && KNOWN.includes(remembered) ? remembered : onDirectLine() ? "member" : "owner";
let email: string | null = null;
let liveWallets = false;
let known = false;   // the server has answered api/me: the role is no longer a guess
const subs = new Set<() => void>();

// The status bar's first latency reading is this same request (shell/StatusBar.tsx), not a second one.
const meT0 = typeof performance !== "undefined" ? performance.now() : 0;
const meAsked = fetchApi("api/me", { cache: "no-store" });
export const firstMeMs: Promise<number | null> = meAsked.then((r) => (r.ok ? Math.round(performance.now() - meT0) : null), () => null);
meAsked.then((r) => r.json()).then((j: { readonly?: boolean; member?: boolean; email?: string; liveWallets?: boolean }) => {
  const was = role;
  role = j.member ? "member" : j.readonly ? "visitor" : "owner";
  email = j.email || null;
  const hadWallets = liveWallets;
  liveWallets = j.liveWallets === true && role !== "visitor";
  if (role !== "owner" && !liveWallets) setPaper(true);
  if (role !== remembered) store.set("role", role);
  const wasKnown = known;
  known = true;
  if (role !== was || hadWallets !== liveWallets || !wasKnown) subs.forEach((f) => f());
}).catch(() => {});
// The direct-line cookie (blix_m, worker/index.js) lives 20 minutes and is set again on every answer from the Worker
// itself (a page view, or api/me through it, never through the direct line): a tab left open asks the Worker every
// 5 minutes, and at once on coming back after a while, so the cookie never runs out while someone is using Blix; an
// account paused in the meantime loses the direct line within those 20 minutes.
if (onDirectLine() && typeof window !== "undefined") {
  let pinged = Date.now();
  const ping = () => { pinged = Date.now(); fetch("api/me", { cache: "no-store", credentials: "same-origin" }).catch(() => {}); };
  window.setInterval(() => { if (!document.hidden) ping(); }, 5 * 60_000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - pinged > 4 * 60_000) ping(); });
}

export const useRole = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => role);
export const useLiveWallets = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => liveWallets || role === "owner");
// True once the server has said who this is (until then useRole is the remembered or default guess).
export const useRoleKnown = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => known);
export const memberEmail = () => email;
// Pages and buttons only the owner has. (Settings is everyone's: a member sees their paper wallet and this browser's
// choices there; the server refuses them the owner's radar settings, pages/Settings.tsx.)
export const OWNER_ONLY = new Set(["launch"]);
