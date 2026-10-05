// Coin logos: one loader for every picture of a coin on the page (Pulse rows, tables, the coin page).
//
// Logos the radar already has come in bulk: every picture that appears in the same moment is asked for in
// one /api/pics request (a browser sends only six requests at a time to this PC, so one by one they would
// trickle in over a couple of seconds). A coin the radar has no picture for yet is fetched there in the
// background; when it lands the radar says so on the live stream ("pic") and every picture of that coin
// loads it at once. Until then a miss is asked again one by one, quickly at first (new launches publish
// their picture within seconds), then rarely. What is known is shared by all the pictures of one coin and
// kept across scrolling.
import { useCallback, useSyncExternalStore } from "react";

interface Pic { ok: boolean; dead: boolean; tries: number; v: number; timer: number; data: string | null; batched: boolean }
const pics = new Map<string, Pic>();
const subs = new Map<string, Set<() => void>>();
const RETRY_MS = [700, 1500, 3000, 6000, 12_000, 30_000, 60_000];

const get = (mint: string) => {
  let p = pics.get(mint);
  if (!p) {
    if (pics.size > 3000) for (const [k, x] of pics) if (!subs.get(k)?.size) { clearTimeout(x.timer); pics.delete(k); if (pics.size < 2000) break; }
    pics.set(mint, (p = { ok: false, dead: false, tries: 0, v: 0, timer: 0, data: null, batched: false }));
    ask(mint, p);
  }
  return p;
};
const emit = (mint: string) => subs.get(mint)?.forEach((f) => f());
const again = (mint: string) => { const p = get(mint); p.v++; p.dead = false; emit(mint); };

// The bulk request: everything asked for within one frame goes together, up to 100 at a time.
let queue: string[] = [], flushing = 0;
function ask(mint: string, p: Pic) {
  p.batched = true;
  queue.push(mint);
  if (!flushing) flushing = requestAnimationFrame(flush) || window.setTimeout(flush, 16);
}
async function flush() {
  flushing = 0;
  const all = queue; queue = [];
  for (let i = 0; i < all.length; i += 100) {
    const part = all.slice(i, i + 100);
    let got: Record<string, string | null> = {};
    try {
      const r = await fetch(`/api/pics?m=${part.join(",")}`, { signal: AbortSignal.timeout(8000) });
      if (r.ok) got = await r.json();
    } catch {}
    for (const mint of part) {
      const p = pics.get(mint);
      if (!p) continue;
      p.batched = false;
      if (got[mint] && !p.ok) p.data = got[mint];
      emit(mint);   // no data: the picture falls back to /img/<mint> and its retries
    }
  }
}

// The radar has the picture now (its "pic" event): load it everywhere, whatever the misses said.
export function picReady(mint: string) {
  const p = pics.get(mint);
  if (!p || p.ok) return;
  clearTimeout(p.timer); p.timer = 0; p.tries = 0;
  again(mint);
}

export function usePic(mint: string) {
  const subscribe = useCallback((fn: () => void) => {
    let set = subs.get(mint);
    if (!set) subs.set(mint, (set = new Set()));
    set.add(fn);
    return () => { set!.delete(fn); if (!set!.size) subs.delete(mint); };
  }, [mint]);
  useSyncExternalStore(subscribe, () => { const p = pics.get(mint); return p ? `${+p.ok}${+p.dead}${p.v}${+p.batched}${+!!p.data}` : ""; });
  const p = get(mint), v = p.v;
  return {
    // Waiting on the bulk answer: no <img> yet, so nothing queues behind it.
    src: p.batched || p.dead ? null : p.data && !v ? p.data : `/img/${mint}${v ? `?v=${v}` : ""}`,
    ok: p.ok,
    key: `${mint}:${v}:${+!!p.data}`,   // a new attempt is a new <img>; loading one never remounts it
    onLoad: () => { if (!p.ok) { p.ok = true; emit(mint); } },
    // Several pictures of one coin may miss together: the first one for this attempt schedules the next.
    onError: () => {
      if (p.ok || p.timer || p.v !== v) return;
      if (p.data && !v) { p.data = null; emit(mint); return; }
      const wait = RETRY_MS[p.tries++];
      if (wait == null) { p.dead = true; emit(mint); return; }
      p.timer = window.setTimeout(() => { p.timer = 0; again(mint); }, wait);
    },
  };
}
