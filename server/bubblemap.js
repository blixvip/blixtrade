// Bubble maps (the coin page's Bubble map tab): the coin's biggest holders as bubbles sized by their share,
// joined when the wallets are connected. Built fresh on every read from three sources, so it follows the coin:
//
//  1. the holders: the coin page's own live top 100 (coin.js coinPage: the ledger, the chain or Jupiter);
//  2. RugCheck's insider networks (api.rugcheck.xyz/v1/tokens/<mint>/insiders/graph, free, no key): wallets
//     that sent the coin or SOL to each other, intermediaries included. Read again every RC_TTL while someone
//     has the tab open;
//  3. Blix's own funder trace: each top holder's first funder (the SOL that opened the wallet), read on the
//     Helius key that has room. A wallet's first funder never changes, so each is read once and kept in
//     radar.db; only new top holders cost anything. Holders funded by the same wallet, or one by another, join.
//
// Wallets that bought in the launch block with the dev (tag "bundle") join the dev. Known exchange hot wallets
// fund thousands of strangers, so they never join anyone; the pool never joins anyone either.
// Two top holders are in one cluster when any chain of these links joins them; the lines drawn are the
// shortest such chains (a spanning tree, so a cluster of n has n-1 lines), marked with how many wallets sit
// between them.
//
// Who a bubble is: a Fomo trader (Fomo's holder list for the coin: the wallet Blix verified for that trader, else
// the one holder whose balance equals the trader's token amount exactly) or a pump.fun profile. Fomo traders
// below the top 100 still get a bubble (up to EXTRA of them), so every Fomo holder Blix can place is on the map.
import { db } from "./db.js";
import { rpc, validAddress } from "./solana.js";
import { coinPage } from "./coin.js";
import { activeUrl, keyUrls, noteCall } from "./heliuskeys.js";
import { getJson } from "./sources.js";
import { coinFomo } from "./fomoboard.js";
import { pumpPeople } from "./chartpeople.js";
import { books } from "./holders.js";
import { holdersLive, onCurve } from "./holderslive.js";

const now = () => Date.now();
const MIN = 60_000;
const TOP = 100;                // holders on the map
const READ = 300;               // holders read, to place Fomo traders below the top 100
const EXTRA = 40;               // Fomo traders below the top 100 added to the map
const TRACE_TOP = 50;           // holders whose funder Blix traces itself
const PAGES = 3;                // signature pages (1,000 each) walked back to find a wallet's first transaction
const RC_TTL = 3 * MIN;         // RugCheck networks read again after this, while the tab is open
const RC_FAIL = 45_000;         // after a failed read
const TRACE_EVERY = 2 * MIN;    // a coin's new top holders are traced at most this often
const DAY_WALLETS = 2500;       // wallets traced per day, all coins together (~3-6 Helius credits each)
const EXCHANGES = new Map([
  ["5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9", "Binance"], ["2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S", "Binance"],
  ["H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS", "Coinbase"], ["GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE", "Coinbase"],
  ["5VCwKtCXgCJ6kit5FybXjvriW3xELsFDhYrPSqtJNmcD", "OKX"], ["is6MTRHEgyFLNTfYcuV4QBWLjrZBfmhVNYR6ccgr8KV", "OKX"],
  ["AC5RDfQFmDS1deWZos921JfqscXdByf8BKHs5ACWjtW2", "Bybit"], ["ASTyfSima4LLAdDgoFGkgqoKowG1LZFDr9fAQrg7iaJZ", "MEXC"],
  ["FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5", "Kraken"], ["u6PJ8DtQuPFnfmwHbGFULQ4u4EgjDiyYKjVEsynXq2w", "Gate"],
]);

// First funders, kept for good ("" = traced, nothing usable: history too long or self-funded).
db.exec("CREATE TABLE IF NOT EXISTS bubble_funders (wallet TEXT PRIMARY KEY, funder TEXT NOT NULL, t INTEGER NOT NULL)");
const getF = db.prepare("SELECT funder FROM bubble_funders WHERE wallet = ?");
// How many traced wallets a funder opened, all coins together: a wallet that funds strangers by the dozen is a
// service (an exchange or bridge Blix has no name for), and sharing it says nothing about who owns a wallet.
const fundedN = db.prepare("SELECT count(*) AS n FROM bubble_funders WHERE funder = ?");
const HUB = 8;
const putF = db.prepare("INSERT OR REPLACE INTO bubble_funders (wallet, funder, t) VALUES (?, ?, ?)");

export const bubbleStats = { reads: 0, rugcheck: { ok: 0, failed: 0, lastError: null }, traced: 0, day: "", today: 0, lastError: null };
const rc = new Map();          // mint -> { t, nets, error, busy, seen }
const trace = new Map();       // mint -> { t, busy, done, total }

const funderOf = (w) => getF.get(w)?.funder;   // undefined: not traced yet; "": traced, no funder found

// RugCheck's networks for a coin: the cached answer at once, a fresh read started when it is old.
function rugNets(mint) {
  let e = rc.get(mint);
  if (!e) { e = { t: 0, nets: null, error: null, busy: false }; rc.set(mint, e); }
  e.seen = now();
  const age = now() - e.t;
  if (!e.busy && age > (e.error && !e.nets ? RC_FAIL : RC_TTL)) {
    e.busy = true;
    getJson(`https://api.rugcheck.xyz/v1/tokens/${mint}/insiders/graph`, { timeout: 20_000 })
      .then((j) => { e.nets = Array.isArray(j) ? j : []; e.error = null; bubbleStats.rugcheck.ok++; })
      .catch((err) => {
        // A coin RugCheck has not indexed yet answers 4xx: no networks yet, not a failure.
        if (err.status >= 400 && err.status < 429) { e.nets = e.nets || []; e.error = null; return; }
        e.error = err.status === 429 ? "RugCheck is busy" : "RugCheck didn't answer"; bubbleStats.rugcheck.failed++; bubbleStats.rugcheck.lastError = err.message;
      })
      .finally(() => { e.t = now(); e.busy = false; });
  }
  if (rc.size > 400) for (const [k, v] of rc) if (now() - (v.seen || 0) > 30 * MIN) rc.delete(k);
  return e;
}

// One Helius call; a 429 (the key is shared with the chart stream, 10 calls a second) waits and tries again.
async function call(method, params) {
  const ws = activeUrl();
  if (!ws) return rpc(method, params);
  const url = ws.replace(/^ws/i, "http");
  for (let tries = 0; ; tries++) {
    noteCall(url, method);
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(20_000) });
    if (r.status === 429 && tries < 5) { await new Promise((ok) => setTimeout(ok, 600 * 2 ** tries + Math.random() * 400)); continue; }
    if (!r.ok) throw new Error(`Helius ${r.status}`);
    const j = await r.json();
    if (j.error) throw new Error(j.error.message || "RPC error");
    return j.result;
  }
}

// The SOL that opened a wallet: the sender of the first transfer into it in its oldest transaction (else that
// transaction's fee payer, when it is someone else). "" when the history is too long to walk or shows no one.
async function readFunder(wallet) {
  let before, oldest = null;
  for (let page = 0; page < PAGES; page++) {
    const sigs = await call("getSignaturesForAddress", [wallet, { limit: 1000, ...(before ? { before } : {}) }]);
    if (!sigs?.length) break;
    oldest = sigs[sigs.length - 1].signature;
    if (sigs.length < 1000) { before = null; break; }
    before = oldest;
  }
  if (!oldest || before) return "";
  const tx = await call("getTransaction", [oldest, { maxSupportedTransactionVersion: 0, encoding: "jsonParsed", commitment: "confirmed" }]);
  const ixs = [...(tx?.transaction?.message?.instructions || []), ...(tx?.meta?.innerInstructions || []).flatMap((x) => x.instructions || [])];
  for (const ix of ixs) {
    const info = ix?.parsed?.info;
    if (ix?.program !== "system" || !info) continue;
    const to = info.destination || info.newAccount, from = info.source;
    if (to === wallet && from && from !== wallet) return from;
  }
  const payer = tx?.transaction?.message?.accountKeys?.[0];
  const key = typeof payer === "string" ? payer : payer?.pubkey;
  return key && key !== wallet ? key : "";
}

// Trace the coin's top holders Blix has not traced yet, two at a time (the key's 10 calls a second are shared).
function traceNew(mint, wallets) {
  let s = trace.get(mint);
  if (s && (s.busy || now() - s.t < TRACE_EVERY)) return s;
  const todo = wallets.filter((w) => funderOf(w) === undefined);
  if (!s) { s = { t: 0, busy: false, done: 0, total: 0 }; trace.set(mint, s); }
  s.t = now();
  if (!todo.length) return s;
  const day = new Date().toISOString().slice(0, 10);
  if (bubbleStats.day !== day) { bubbleStats.day = day; bubbleStats.today = 0; }
  const room = DAY_WALLETS - bubbleStats.today;
  if (room <= 0) return s;
  const list = todo.slice(0, room);
  bubbleStats.today += list.length;
  Object.assign(s, { busy: true, done: 0, total: list.length, failed: 0 });
  let next = 0;
  Promise.all(Array.from({ length: 2 }, async () => {
    while (next < list.length) {
      const w = list[next++];
      try { putF.run(w, await readFunder(w), now()); bubbleStats.traced++; } catch (e) { bubbleStats.lastError = e.message; s.failed++; }
      s.done++;
    }
  })).finally(() => { s.busy = false; s.t = now(); });
  if (trace.size > 400) for (const [k, v] of trace) if (!v.busy && now() - v.t > 30 * MIN) trace.delete(k);
  return s;
}

// The map, as the tab draws it.
// The last map each coin drew, kept 20 minutes: a read that comes back without holders for a moment (a
// snapshot being rebuilt, a slow RPC) answers the last good map, marked stale, instead of a loading screen.
const lastGood = new Map();
export function bubbleMap(mint) {
  const a = buildMap(mint);
  if (a.nodes) { lastGood.set(mint, a); if (lastGood.size > 300) lastGood.delete(lastGood.keys().next().value); return a; }
  const g = lastGood.get(mint);
  return g && now() - g.t < 20 * MIN ? { ...g, stale: true } : a;
}

function buildMap(mint) {
  if (!validAddress(mint)) return { error: "Not a coin address." };
  bubbleStats.reads++;
  const page = coinPage(mint, { top: READ });
  let read = (page?.holders?.list || []).filter((h) => h.pct > 0 && validAddress(h.wallet));
  // No holder list yet (a big bonded coin whose full snapshot has not landed, or cannot while the Helius keys
  // rest): the chain's 20 largest accounts stand in, so the map draws at once.
  let fallback = null;
  if (read.length < 3) { fallback = largestHolders(mint); if (fallback.list?.length > read.length) read = fallback.list; }
  const fomo = fomoPeople(mint, read);
  // Fomo traders below the top 100 join as their own bubbles, from the read list or, deeper, from every balance.
  const deeper = fomo.extra.filter((h) => !read.some((r) => r.wallet === h.wallet));
  const all = [...read.slice(0, TOP), ...read.slice(TOP).filter((h) => fomo.byWallet.has(h.wallet)), ...deeper]
    .filter((h, k, list) => k < TOP || fomo.byWallet.has(h.wallet)).slice(0, TOP + EXTRA);
  const r = rugNets(mint);
  // Fewer than 3 holders is a real answer once the chain was read (a coin still all in its launch curve, say).
  if (!all.length || (all.length < 3 && !fallback?.list)) return { mint, pending: true, rugcheck: { busy: r.busy }, holders: { listed: read.length, fallback: fallback && { busy: fallback.busy, n: fallback.list?.length ?? null, error: fallback.error } }, error: fallback?.error && !fallback.busy && now() - fallback.t < 60_000 && fallback.fails > 2 ? "Couldn't read this coin's holders from the chain. Trying again." : undefined };
  const pool = (h) => h.label === "Pool";
  const nodes = all.map((h) => ({
    w: h.wallet, pct: h.pct, tokens: h.tokens ?? null, tag: h.tag || null, label: h.label || null,
    kind: pool(h) ? "pool" : EXCHANGES.has(h.wallet) ? "exchange" : "holder", cluster: null, funder: null, rank: h.rank ?? read.indexOf(h) + 1, person: null,
  }));
  const pump = pumpPeople(nodes.filter((n) => n.kind === "holder").map((n) => n.w));
  for (const n of nodes) {
    if (n.kind !== "holder") continue;
    const f = fomo.byWallet.get(n.w), p = pump.get(n.w);
    if (f) n.person = f;
    else if (p) n.person = { src: "pump", name: p.name, handle: p.name, pic: p.pic || null, followers: p.followers || 0, link: `https://pump.fun/profile/${encodeURIComponent(p.name)}`, x: p.x || null, how: "wallet" };
  }
  const tr = traceNew(mint, nodes.filter((n) => n.kind === "holder").slice(0, TRACE_TOP).map((n) => n.w));

  // One graph over every wallet the sources name. Edge kinds: "transfer" (RugCheck), "funded" (first funder),
  // "launch" (bought in the dev's launch block). Edges are stored both ways with their real direction.
  const holderAt = new Map(nodes.map((n, i) => [n.w, i]));
  const shut = new Set([...EXCHANGES.keys(), ...nodes.filter((n) => n.kind !== "holder").map((n) => n.w)]);
  const adj = new Map();
  const edge = (a, b, kind) => {
    if (!a || !b || a === b || shut.has(a) || shut.has(b)) return;
    for (const [x, y, fwd] of [[a, b, true], [b, a, false]]) {
      let m = adj.get(x); if (!m) adj.set(x, (m = new Map()));
      const had = m.get(y);
      if (!had) m.set(y, { kind, fwd });
      else if (had.kind !== kind && !had.kinds?.includes(kind)) had.kinds = [...(had.kinds || [had.kind]), kind];
    }
  };
  let rcWallets = 0;
  for (const net of r.nets || []) {
    for (const l of net.links || []) edge(l.source, l.target, "transfer");
    rcWallets += (net.nodes || []).length;
  }
  const localF = new Map();
  for (const n of nodes) { const f = n.kind === "holder" ? funderOf(n.w) : null; if (f) localF.set(f, (localF.get(f) || 0) + 1); }
  for (const n of nodes) {
    if (n.kind !== "holder") continue;
    const f = funderOf(n.w);
    if (f === undefined) continue;
    n.funder = f || "";
    if (!f || EXCHANGES.has(f)) continue;
    // A hub: funded many wallets, most of them outside this coin's holders.
    const total = fundedN.get(f)?.n ?? 0, here = localF.get(f) || 0;
    if (total >= HUB && total > here * 2) { n.hub = total; continue; }
    edge(f, n.w, "funded");
  }
  // Holders whose first buy of the coin landed in the same block (the coin's own trade ledger): a few wallets
  // buying in one slot is how bundles look. A crowded slot (a hot coin's busy moment) proves nothing, so 2 to 6 only.
  const book = books.get(mint);
  if (book) {
    const bySlot = new Map();
    for (const n of nodes) {
      if (n.kind !== "holder") continue;
      const slot = book.bal.get(n.w)?.slot;
      if (slot == null) continue;
      const l = bySlot.get(slot) || []; l.push(n); bySlot.set(slot, l);
    }
    for (const l of bySlot.values()) if (l.length >= 2 && l.length <= 6) for (const n of l.slice(1)) edge(l[0].w, n.w, "block");
  }
  const launch = nodes.filter((n) => n.kind === "holder" && (n.tag === "dev" || n.tag === "bundle"));
  if (launch.length > 1) { const dev = launch.find((n) => n.tag === "dev") || launch[0]; for (const n of launch) if (n !== dev) edge(dev.w, n.w, "launch"); }

  // From each holder, every other holder within 4 hops (breadth-first, never passing through another holder:
  // that holder has its own lines). These are the candidate lines.
  const cands = [];
  for (const [i, n] of nodes.entries()) {
    if (!adj.has(n.w)) continue;
    const prev = new Map([[n.w, null]]);
    let front = [n.w];
    for (let hop = 1; hop <= 4 && front.length; hop++) {
      const nextF = [];
      for (const x of front) for (const y of adj.get(x)?.keys() || []) {
        if (prev.has(y)) continue;
        prev.set(y, x);
        const j = holderAt.get(y);
        if (j == null) { nextF.push(y); continue; }
        if (j <= i) continue;
        // Walk back for the path's kinds and, on a single hop, the direction.
        const path = [y]; for (let p = x; p; p = prev.get(p)) path.push(p);
        path.reverse();
        const kinds = new Set(); let dir = 0;
        for (let k = 1; k < path.length; k++) { const e = adj.get(path[k - 1]).get(path[k]); for (const kk of e.kinds || [e.kind]) kinds.add(kk); if (path.length === 2) dir = e.fwd ? 1 : -1; }
        cands.push({ a: i, b: j, hops: hop, kinds: [...kinds], dir, via: path.slice(1, -1) });
      }
      front = nextF;
    }
  }
  // Keep the shortest lines that join clusters (Kruskal): a cluster of n holders gets n-1 lines.
  const parent = nodes.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const links = [];
  for (const c of cands.sort((x, y) => x.hops - y.hops || nodes[y.b].pct - nodes[x.b].pct)) {
    const ra = find(c.a), rb = find(c.b);
    if (ra === rb) continue;
    parent[ra] = rb;
    links.push(c);
  }
  const groups = new Map();
  nodes.forEach((n, i) => { if (n.kind === "holder") { const g = find(i); groups.set(g, [...(groups.get(g) || []), i]); } });
  const clusters = [...groups.values()].filter((g) => g.length > 1)
    .map((g) => {
      const ls = links.filter((l) => g.includes(l.a));
      const why = [...new Set(ls.flatMap((l) => l.kinds))];
      return { n: g.length, pct: +g.reduce((s, i) => s + nodes[i].pct, 0).toFixed(3), members: g, why };
    })
    .sort((a, b) => b.pct - a.pct);
  clusters.forEach((c, k) => { for (const i of c.members) nodes[i].cluster = k; });

  const traced = nodes.filter((n) => n.funder != null).length;
  const outNodes = nodes.map(({ funder, hub, ...n }) => ({ ...n, via: funder && EXCHANGES.get(funder) || (hub ? `a wallet that funded ${hub} others` : null), traced: funder != null, untraceable: funder === "" }));
  return {
    mint, t: now(),
    nodes: outNodes,
    links: links.map(({ a, b, hops, kinds, dir, via }) => ({ a, b, hops, kinds, dir, via: via.slice(0, 3) })),
    clusters,
    // For a page loaded before 2026-10-10's rewrite (its tab drew `map` after a Generate button).
    map: { nodes: outNodes, links: links.map((l) => [l.a, l.b]), clusters, traced, t: now() }, building: null, rebuildMs: 30 * MIN,
    sources: {
      fomo: { holders: fomo.total, placed: nodes.filter((n) => n.person?.src === "fomo").length, read: fomo.read },
      people: nodes.filter((n) => n.person).length,
      holders: fallback?.list && read === fallback.list ? "largest 20 (chain)" : page?.info?.source || page?.holders?.source || null, holderCount: page?.info?.holders ?? page?.holders?.count ?? null,
      rugcheck: { t: r.t || null, busy: r.busy, error: r.error, networks: (r.nets || []).length, wallets: rcWallets },
      trace: { error: tr.failed ? bubbleStats.lastError : null, traced: nodes.filter((n) => n.kind === "holder").slice(0, TRACE_TOP).filter((n) => n.funder != null).length, of: Math.min(TRACE_TOP, nodes.filter((n) => n.kind === "holder").length), busy: tr.busy, done: tr.done, total: tr.total, resting: !activeUrl() },
    },
  };
}

// The old Generate button's POST: every read builds the map now, so it is the same read.
export const makeBubbleMap = bubbleMap;

// Fomo's traders in this coin, each placed on a holder wallet: the wallet Blix verified for the trader
// (fomoresolve.js), else the one holder holding exactly the trader's token amount (to 0.2%). An amount two
// holders share, or none does (the trader bought or sold since Fomo's read), places no one.
function fomoPeople(mint, holders) {
  const byWallet = new Map();
  let f;
  try { f = coinFomo(mint); } catch { return { byWallet, extra: [], total: 0, read: null }; }
  const list = (f?.holders || []).filter((x) => x && x.handle);
  // Every holder Blix can see: the coin's own ledger (curve coins) or the chain's live balances, else the read list.
  const supply = holders.find((h) => h.pct > 0 && h.tokens > 0);
  const per = supply ? supply.tokens / supply.pct : null;   // tokens per 1%
  let free = holders.filter((h) => h.label !== "Pool" && !EXCHANGES.has(h.wallet));
  const shown = new Set(holders.map((h) => h.wallet));
  try {
    const b = books.get(mint);
    let more = b ? [...b.bal].filter(([, w]) => w.b > 0.5).map(([wallet, w]) => [wallet, w.b]) : null;
    if (!more) { const live = holdersLive(mint, { n: 50_000 }); if (live?.top?.length) more = live.top; }
    if (more && per) for (const [wallet, tokens] of more) if (!shown.has(wallet) && !EXCHANGES.has(wallet)) free.push({ wallet, tokens: Math.round(tokens), pct: +(tokens / per).toFixed(4), tag: null, label: null, deep: true });
  } catch {}
  for (const x of list) {
    let w = x.wallet && free.some((h) => h.wallet === x.wallet) ? x.wallet : null, how = "wallet";
    if (!w && x.amount > 0) {
      const tol = Math.max(x.amount * 0.002, 2);
      const hits = free.filter((h) => h.tokens != null && Math.abs(h.tokens - x.amount) <= tol && !byWallet.has(h.wallet));
      if (hits.length === 1) { w = hits[0].wallet; how = "amount"; }
    }
    if (!w || byWallet.has(w)) continue;
    byWallet.set(w, {
      src: "fomo", name: x.name || x.handle, handle: x.handle, pic: x.pic || null, followers: x.followers || 0, verified: Boolean(x.verified),
      link: `https://fomo.family/profile/${encodeURIComponent(x.handle)}`, how, usd: x.value ?? null, pnl: x.pnl ?? null, dev: Boolean(x.dev), thesis: x.thesis?.text || null,
    });
  }
  const extra = free.filter((h) => h.deep && byWallet.has(h.wallet)).map(({ deep, ...h }) => ({ ...h, rank: 1 + free.filter((x) => x.tokens > h.tokens).length + holders.filter((x) => x.label === "Pool" || EXCHANGES.has(x.wallet)).filter((x) => x.tokens > h.tokens).length }));
  return { byWallet, extra, total: f?.totalHolders ?? list.length, read: f?.heldAt ?? f?.read ?? null };
}

// The 20 largest token accounts of a coin, by owner (two cheap RPC calls, any endpoint): getTokenLargestAccounts,
// then the accounts' owners. An owner that is not a wallet (off the ed25519 curve: a program's PDA) is a pool or
// a program vault, labelled Pool. Read at most once a minute per coin.
const largest = new Map();   // mint -> { t, busy, list, error, fails, seen }
function largestHolders(mint) {
  let e = largest.get(mint);
  if (!e) { e = { t: 0, busy: false, list: null, error: null, fails: 0 }; largest.set(mint, e); }
  e.seen = now();
  if (!e.busy && now() - e.t > (e.list ? MIN : 15_000)) {
    e.busy = true;
    (async () => {
      const [big, sup] = await Promise.all([small("getTokenLargestAccounts", [mint, { commitment: "confirmed" }]), small("getTokenSupply", [mint])]);
      const accs = (big?.value || []).filter((a) => +a.uiAmount > 0);
      const total = +sup?.value?.uiAmount || 0;
      if (!accs.length || !total) throw new Error("no accounts");
      const info = await small("getMultipleAccounts", [accs.map((a) => a.address), { encoding: "jsonParsed", commitment: "confirmed" }]);
      const by = new Map();
      accs.forEach((a, i) => { const o = info?.value?.[i]?.data?.parsed?.info?.owner; if (o) by.set(o, (by.get(o) || 0) + (+a.uiAmount || 0)); });
      e.list = [...by].map(([wallet, tokens]) => ({ wallet, tokens: Math.round(tokens), pct: +((tokens / total) * 100).toFixed(3), tag: null, label: onCurve(wallet) ? null : "Pool" }))
        .sort((a, b) => b.tokens - a.tokens);
      e.error = null; e.fails = 0;
    })().catch((err) => { e.error = err.message; e.fails++; }).finally(() => { e.t = now(); e.busy = false; });
  }
  if (largest.size > 300) for (const [k, v] of largest) if (!v.busy && now() - (v.seen || 0) > 30 * MIN) largest.delete(k);
  return e;
}

// A small read for the holder fallback: on a Helius key even while its daily pacing rests (three 1-credit calls a
// minute per open coin; the public endpoint answers 429 to getTokenLargestAccounts), else the public endpoint.
// A 429 (the keys' 10 calls a second are shared with the chart stream) waits and tries the other key.
async function small(method, params) {
  const keys = [...new Set([activeUrl(), ...keyUrls()].filter(Boolean))].map((k) => k.replace(/^ws/i, "http"));
  if (!keys.length) return rpc(method, params);
  for (let tries = 0; tries < 6; tries++) {
    const url = keys[tries % keys.length];
    noteCall(url, method);
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(20_000) }).catch(() => null);
    if (r?.ok) { const j = await r.json(); if (j.error) throw new Error(j.error.message || "RPC error"); return j.result; }
    await new Promise((ok) => setTimeout(ok, 300 * 2 ** Math.min(tries, 4) + Math.random() * 300));
  }
  return rpc(method, params);
}
