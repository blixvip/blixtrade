import { create } from "zustand";
import { fetchApi } from "./api";
import { firstMeMs } from "./role";

// How the connection to the server is doing, from a small timed read of api/me: every 15 s while all is well,
// every 4 s once it looks slow or gone (so recovery shows quickly). One slow answer could be a hiccup, so "slow"
// needs two in a row, or one very slow one; "offline" is the browser saying so, or two failed reads in a row.
export type NetState = "ok" | "slow" | "offline";
export const SLOW_MS = 1000;
const VERY_SLOW_MS = 3000;

export const useNet = create<{ ms: number | null; state: NetState }>(() => ({ ms: null, state: "ok" }));

let started = false, slow = 0, failed = 0, timer = 0, busy = false;

function judge(ms: number | null) {
  if (ms == null) failed++; else failed = 0;
  if (ms != null && ms > SLOW_MS) slow++; else if (ms != null) slow = 0;
  const state: NetState = !navigator.onLine || failed >= 2 ? "offline"
    : ms != null && (slow >= 2 || ms > VERY_SLOW_MS) ? "slow"
    : ms == null ? useNet.getState().state   // one failed read: keep what we had until the next one says
    : "ok";
  useNet.setState({ ms: ms ?? useNet.getState().ms, state });
}

async function ping() {
  clearTimeout(timer);
  if (busy) return;
  if (document.hidden) { timer = window.setTimeout(ping, 15_000); return; }
  busy = true;
  const t0 = performance.now();
  try {
    const r = await fetchApi("api/me", { cache: "no-store", signal: AbortSignal.timeout(8000) });
    judge(r.ok ? Math.round(performance.now() - t0) : null);
  } catch { judge(null); }
  finally {
    busy = false;
    timer = window.setTimeout(ping, useNet.getState().state === "ok" ? 15_000 : 4_000);
  }
}

// Started once by whoever first needs it (the status bar's Connection, the slow-connection notice).
export function watchNet() {
  if (started || typeof window === "undefined") return;
  started = true;
  firstMeMs.then((v) => { if (v != null) judge(v); });
  addEventListener("offline", () => { useNet.setState({ state: "offline" }); clearTimeout(timer); timer = window.setTimeout(ping, 4_000); });
  addEventListener("online", () => { failed = 0; ping(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) ping(); });
  timer = window.setTimeout(ping, 15_000);
}
