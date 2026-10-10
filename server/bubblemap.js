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
import { db } from "./db.js";
import { rpc, validAddress } from "./solana.js";
import { coinPage } from "./coin.js";
import { activeUrl, noteCall } from "./heliuskeys.js";
import { getJson } from "./sources.js";

const now = () => Date.now();
const MIN = 60_000;
const TOP = 100;                // holders on the map
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
export function bubbleMap(mint) {
  if (!validAddress(mint)) return { error: "Not a coin address." };
  bubbleStats.reads++;
  const page = coinPage(mint, { top: TOP });
  const all = (page?.holders?.list || []).filter((h) => h.pct > 0 && validAddress(h.wallet)).slice(0, TOP);
  const r = rugNets(mint);
  if (all.length < 3) return { mint, pending: true, rugcheck: { busy: r.busy } };
  const pool = (h) => h.label === "Pool";
  const nodes = all.map((h) => ({
    w: h.wallet, pct: h.pct, tokens: h.tokens ?? null, tag: h.tag || null, label: h.label || null,
    kind: pool(h) ? "pool" : EXCHANGES.has(h.wallet) ? "exchange" : "holder", cluster: null, funder: null,
  }));
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
  for (const n of nodes) {
    if (n.kind !== "holder") continue;
    const f = funderOf(n.w);
    if (f === undefined) continue;
    n.funder = f || "";
    if (f && !EXCHANGES.has(f)) edge(f, n.w, "funded");
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
  const outNodes = nodes.map(({ funder, ...n }) => ({ ...n, via: funder && EXCHANGES.get(funder) || null, traced: funder != null, untraceable: funder === "" }));
  return {
    mint, t: now(),
    nodes: outNodes,
    links: links.map(({ a, b, hops, kinds, dir, via }) => ({ a, b, hops, kinds, dir, via: via.slice(0, 3) })),
    clusters,
    // For a page loaded before 2026-10-10's rewrite (its tab drew `map` after a Generate button).
    map: { nodes: outNodes, links: links.map((l) => [l.a, l.b]), clusters, traced, t: now() }, building: null, rebuildMs: 30 * MIN,
    sources: {
      holders: page?.info?.source || page?.holders?.source || null, holderCount: page?.info?.holders ?? page?.holders?.count ?? null,
      rugcheck: { t: r.t || null, busy: r.busy, error: r.error, networks: (r.nets || []).length, wallets: rcWallets },
      trace: { error: tr.failed ? bubbleStats.lastError : null, traced: nodes.filter((n) => n.kind === "holder").slice(0, TRACE_TOP).filter((n) => n.funder != null).length, of: Math.min(TRACE_TOP, nodes.filter((n) => n.kind === "holder").length), busy: tr.busy, done: tr.done, total: tr.total },
    },
  };
}

// The old Generate button's POST: every read builds the map now, so it is the same read.
export const makeBubbleMap = bubbleMap;
