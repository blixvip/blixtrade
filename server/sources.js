// Data sources. All free, no keys: DexScreener, GeckoTerminal, RugCheck, PumpPortal (live launches).

import * as health from "./health.js";
import { settings } from "./settings.js";

// Simple per-host throttle so we stay under each API's rate limit.
const gates = new Map();
function throttle(host, perMinute) {
  const gap = 60000 / perMinute;
  const g = gates.get(host) || { next: 0 };
  gates.set(host, g);
  const wait = Math.max(0, g.next - Date.now());
  g.next = Math.max(Date.now(), g.next) + gap;
  return new Promise((r) => setTimeout(r, wait));
}

// GeckoTerminal from the VM's address (measured 2026-10-07 23:43 UTC): 6 calls answered, then 429 for the rest
// of the minute, nowhere near the documented 30. Discovery keeps 4 a minute, the pages 4 (LANES below).
const LIMITS = { "api.dexscreener.com": 200, "api.geckoterminal.com": 4, "api.rugcheck.xyz": 40 };
// The pages' calls (a chart's history, a coin's pool, its price) run in their own lane with their own share of a
// host's allowance, so they never queue behind the discovery scans: GeckoTerminal allows ~30 a minute from one
// address; discovery keeps 15, the pages 10 (gtgate.js caps them by rank).
const LANES = { "api.geckoterminal.com": { page: 4 }, "api.coingecko.com": { keyed: 60 } };   // keyed: 100/min allowed; the daily cap (gtgate.js) guards the month

const SERVICE = { "api.dexscreener.com": "dexscreener", "api.geckoterminal.com": "geckoterminal", "api.coingecko.com": "coingecko", "api.rugcheck.xyz": "rugcheck" };

export async function getJson(url, { timeout = 15000, lane = null, headers = {} } = {}) {
  const host = new URL(url).host;
  const perMin = lane && LANES[host]?.[lane];
  await throttle(perMin ? `${host}:${lane}` : host, perMin || LIMITS[host] || 60);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { accept: "application/json", "user-agent": "meme-radar/0.1", ...headers } });
    if (r.status === 429) throw Object.assign(new Error(`${host} rate limited`), { status: 429 });
    if (!r.ok) throw Object.assign(new Error(`${host} ${r.status}`), { status: r.status });
    const body = await r.json();
    health.ok(SERVICE[host] || host);
    return body;
  } catch (e) {
    // A coin RugCheck has never seen is a normal 4xx, not an outage.
    if (!(e.status >= 400 && e.status < 429)) health.fail(SERVICE[host] || host, e.name === "AbortError" ? "timed out" : e);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const SOL = "solana";

// ---------- DexScreener ----------
export async function dexLatestProfiles() {
  const list = await getJson("https://api.dexscreener.com/token-profiles/latest/v1");
  return list.filter((t) => t.chainId === SOL).map((t) => ({
    mint: t.tokenAddress, description: t.description || "", image: t.icon?.startsWith("https://") ? t.icon : null,
    links: (t.links || []).map((l) => ({ type: l.type || l.label?.toLowerCase() || "link", url: l.url })), source: "dex-profile",
  }));
}

export async function dexBoosts(kind = "latest") {
  const list = await getJson(`https://api.dexscreener.com/token-boosts/${kind}/v1`);
  return list.filter((t) => t.chainId === SOL).map((t) => ({
    mint: t.tokenAddress, description: t.description || "", boosts: t.totalAmount || t.amount || 0,
    links: (t.links || []).map((l) => ({ type: l.type || l.label?.toLowerCase() || "link", url: l.url })), source: `dex-boost-${kind}`,
  }));
}

// Up to 30 mints per call. Returns the most liquid pair per token.
// out.failed holds the mints whose request failed, so "no pair" is never confused with "no answer".
export async function dexTokens(mints) {
  const out = new Map();
  out.failed = new Set();
  for (let i = 0; i < mints.length; i += 30) {
    const chunk = mints.slice(i, i + 30);
    let pairs = [];
    try { pairs = await getJson(`https://api.dexscreener.com/tokens/v1/${SOL}/${chunk.join(",")}`); }
    catch (e) { for (const m of chunk) out.failed.add(m); if (e.status === 429) throw e; continue; }
    for (const p of pairs || []) {
      const mint = p.baseToken?.address;
      if (!mint || !chunk.includes(mint)) continue;
      const prev = out.get(mint);
      if (!prev || (p.liquidity?.usd || 0) > (prev.liquidity?.usd || 0)) out.set(mint, p);
    }
  }
  return out;
}

// ---------- GeckoTerminal ----------
function geckoPools(res) {
  return (res.data || []).map((p) => {
    const base = p.relationships?.base_token?.data?.id?.replace(/^solana_/, "");
    return { mint: base, name: p.attributes?.name?.split(" / ")[0], source: "gecko" };
  }).filter((p) => p.mint && p.mint !== "So11111111111111111111111111111111111111112");
}
// Jupiter's newest tokens (lite-api tokens/v2/recent): the 30 whose first pool was created most recently, on any
// launchpad or DEX (pump.fun, Meteora DBC and DAMM, Bags, LaunchLab, memefun, plain pools). About 30 seconds of
// launches at a busy hour, so it is asked every 25 s. Keyless and shared with trade quotes and Blix Vault's swaps
// (jupdisc.js): one call per 25 s, and 15 s of silence after a 429.
let jupRecentCooling = 0;
export async function jupRecent() {
  if (Date.now() < jupRecentCooling) return [];
  const r = await fetch("https://lite-api.jup.ag/tokens/v2/recent", { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (r.status === 429) { jupRecentCooling = Date.now() + 15_000; return []; }   // the list spans under a minute: a longer silence loses coins
  if (!r.ok) throw new Error(`lite-api.jup.ag ${r.status}`);
  const list = await r.json();
  return (Array.isArray(list) ? list : []).filter((t) => t?.id && t.id !== "So11111111111111111111111111111111111111112").map((t) => ({
    mint: t.id, symbol: t.symbol || null, name: t.name || null, image: t.icon || null, creator: t.dev || null,
    launchpad: t.launchpad || null, poolAt: Date.parse(t.firstPool?.createdAt || "") || null, source: "jup-recent",
  }));
}
export const geckoNew = async () => geckoPools(await getJson("https://api.geckoterminal.com/api/v2/networks/solana/new_pools?page=1"));
export const geckoTrending = async () => geckoPools(await getJson("https://api.geckoterminal.com/api/v2/networks/solana/trending_pools?page=1&duration=1h"));

// ---------- RugCheck ----------
// Full RugCheck report: authority/LP risks plus holders, insiders and the dev's position.
export async function rugcheck(mint) {
  const r = await getJson(`https://api.rugcheck.xyz/v1/tokens/${mint}/report`, { timeout: 25000 });
  const risks = (r.risks || []).map((x) => ({ name: x.name, level: x.level, value: x.value, description: x.description }));
  const known = r.knownAccounts || {};
  const supply = Number(r.token?.supply || 0);
  const holders = (r.topHolders || []).map((h) => ({
    owner: h.owner, pct: +(h.pct || 0).toFixed(2), insider: !!h.insider,
    known: known[h.owner]?.name || known[h.address]?.name || null,
  }));
  const real = holders.filter((h) => !h.known);
  const top10 = real.slice(0, 10).reduce((s, h) => s + h.pct, 0);
  const insiderPct = supply ? (r.insiderNetworks || []).reduce((s, n) => s + Number(n.currentHolding || 0), 0) / supply * 100 : 0;
  const devPct = supply ? Number(r.creatorBalance || 0) / supply * 100 : 0;
  const devLaunches = Array.isArray(r.creatorTokens) ? r.creatorTokens.length : 0;
  const lp = (r.markets || []).map((m) => m.lp?.lpLockedPct).filter((x) => x != null);

  const danger = risks.filter((x) => x.level === "danger").length + (r.rugged ? 1 : 0);
  const warn = risks.filter((x) => x.level === "warn").length;
  // 0..100 where 100 is clean. RugCheck's own risks first, then concentration and dev behaviour.
  let clean = 100 - danger * 35 - warn * 8;
  if (typeof r.score_normalised === "number") clean = Math.min(clean, 100 - Math.min(100, r.score_normalised));
  if (top10 > 35) clean -= Math.min(30, top10 - 35);
  if (insiderPct > 15) clean -= Math.min(30, (insiderPct - 15) * 1.5);
  if (devPct > 5) clean -= Math.min(25, (devPct - 5) * 2);
  if (devLaunches >= 5) clean -= 15;
  return {
    risks, danger, warn, raw: r.score_normalised ?? null, clean: Math.max(0, Math.round(clean)),
    lpLockedPct: r.lpLockedPct ?? (lp.length ? Math.max(...lp) : null),
    totalHolders: r.totalHolders ?? null, top10: +top10.toFixed(1), insiderPct: +insiderPct.toFixed(1),
    insiderNetworks: (r.insiderNetworks || []).length, creator: r.creator || null, devPct: +devPct.toFixed(2),
    devLaunches, rugged: !!r.rugged, holders: real.slice(0, 15),
    // RugCheck has not counted this coin's holders yet: its figures (and the clean score they give) say nothing.
    unindexed: !(r.totalHolders > 0) && !(r.topHolders || []).length,
  };
}

// ---------- PumpPortal (live launches + graduations) ----------
export function pumpStream({ onToken, onMigration, onStatus }) {
  let ws, alive = true, retry = 2000, lastMsg = Date.now();
  // Watchdog: launches arrive every second or two, so 90s of silence means a dead socket.
  const dog = setInterval(() => {
    // A copy with the market feeds off (marketFeeds false: the PC beside the VM) never connected: it says "off", not "stalled".
    if (settings.marketFeeds === false) return;
    if (Date.now() - lastMsg > 90_000) { onStatus?.("stalled, reconnecting"); lastMsg = Date.now(); try { ws?.close(); } catch {} }
  }, 30_000);
  const connect = () => {
    if (!alive) return;
    if (settings.marketFeeds === false) { onStatus?.("off (marketFeeds false)"); return; }
    ws = new WebSocket("wss://pumpportal.fun/api/data");
    ws.addEventListener("message", () => { lastMsg = Date.now(); });
    ws.onopen = () => {
      retry = 2000;
      onStatus?.("connected");
      ws.send(JSON.stringify({ method: "subscribeNewToken" }));
      ws.send(JSON.stringify({ method: "subscribeMigration" }));
    };
    ws.onmessage = (m) => {
      let d; try { d = JSON.parse(m.data); } catch { return; }
      if (d.txType === "create" && d.mint) onToken?.({ mint: d.mint, symbol: d.symbol, name: d.name, uri: d.uri, pool: d.pool, mcapSol: d.marketCapSol, creator: d.traderPublicKey, devSol: d.solAmount, mayhem: Boolean(d.is_mayhem_mode), source: "pump-live" });
      else if (d.txType === "migrate" || (d.mint && d.pool && !d.txType)) onMigration?.({ mint: d.mint, pool: d.pool });
    };
    ws.onclose = () => { onStatus?.("reconnecting"); if (alive) setTimeout(connect, retry = Math.min(retry * 2, 60000)); };
    ws.onerror = () => { try { ws.close(); } catch {} };
  };
  connect();
  return { stop() { alive = false; clearInterval(dog); try { ws?.close(); } catch {} } };
}
