// Narratives, live. A narrative shows up on-chain as a burst: several different people launching coins
// with the same ticker, the same word, or the same linked post within minutes, and real buyers arriving
// in at least one of them. This watches every launch for those bursts and, the moment one has money
// behind it, asks Grok (which can search X) what the story is. The hourly scout used to be the only way
// a narrative was found, up to two hours late; a burst is now named in well under a minute.
//
// Once a narrative is known its keywords stay "armed": the next launch that carries one is tracked and
// read at once instead of waiting to be noticed.
import { db, json, logEvent, q } from "./db.js";
import { settings } from "./settings.js";
import { STOP } from "./narratives.js";
import { recentLaunches, launchLog, adoptLaunch, devLaunches } from "./engine.js";
import { getMeta } from "./pulse.js";
import { live, feed } from "./livetrades.js";
import { askGrok, grokReady } from "./grok.js";
import { extractJson } from "./ai.js";
import { safeUrl } from "./quality.js";

const now = () => Date.now();
const MIN = 60_000;
const WINDOW = 3 * 60 * MIN;                 // how far back launches are kept
const COOLDOWN = 30 * MIN;                   // one Grok card per burst per half hour
const FRESH = 3 * 60 * MIN;                  // how long a narrative's keywords stay armed

const store = new Map();                     // mint -> { mint, symbol, name, creator, t, keys: Set, linked }
const index = new Map();                     // key -> { ts: [launch times, history included], mints: [mint] }
const state = new Map();                     // cluster id -> { formingT, cardT, cardN, cardTraders, callId }
const cardHour = [];
let board = [], armed = [], armedT = 0, enqueueFn = null, raiseFn = null, lastSeen = 0;
export const clusterStats = { launches: 0, keys: 0, forming: 0, cards: 0, armedHits: 0, lastMs: 0, lastCardMs: null, lastError: null };

// ---------- keys ----------
// Words every tenth coin carries say nothing about a specific story.
const COMMON = new Set("coin token sol solana meme memes pump fun official the inu baby king mini og real new".split(" "));
const SOCIAL = /(^|\.)(x|twitter|t|tiktok|instagram|youtube|youtu|reddit|facebook|truthsocial|github|linktr|pump)\.(com|me|be|ee|fun)$/i;
const tokens = (s) => String(s || "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && w.length <= 24 && !STOP.has(w) && !COMMON.has(w) && !/^\d+$/.test(w));
export function textKeys(l) {
  const ks = new Set();
  const tk = String(l.symbol || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  if (tk.length >= 2 && tk.length <= 16 && !COMMON.has(tk)) ks.add(`w:${tk}`);
  for (const w of tokens(l.name)) ks.add(`w:${w}`);
  return ks;
}
// What a launch links to: a specific post, an X account, or its own website. Shared links are the
// strongest sign that separate launches are about the same thing.
export function linkKeys(m) {
  const ks = new Set();
  for (const u of [m?.twitter, m?.website]) {
    let url; try { url = new URL(u); } catch { continue; }
    const host = url.hostname.replace(/^www\./, "").toLowerCase(), path = url.pathname.replace(/\/+$/, "");
    const post = /^(x|twitter)\.com$/.test(host) && path.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/);
    if (post) { ks.add(`x:${post[2]}`); continue; }
    const handle = /^(x|twitter)\.com$/.test(host) && path.match(/^\/([A-Za-z0-9_]{1,15})$/);
    if (handle) { if (!/^(home|search|i|intent|explore)$/i.test(handle[1])) ks.add(`h:${handle[1].toLowerCase()}`); continue; }
    if (SOCIAL.test(host)) { if (path.length > 1) ks.add(`u:${host}${path.toLowerCase()}`); continue; }
    if (host.includes(".")) ks.add(`d:${host}`);
  }
  return ks;
}
const isLink = (k) => k[1] === ":" && k[0] !== "w";
const label = (k) => k.startsWith("w:") ? k.slice(2) : k.startsWith("x:") ? `the same X post (${k.slice(2)})` : k.startsWith("h:") ? `@${k.slice(2)}` : k.slice(2);
const linkUrl = (k) => k.startsWith("x:") ? `https://x.com/i/status/${k.slice(2)}` : k.startsWith("h:") ? `https://x.com/${k.slice(2)}` : k.startsWith("d:") ? `https://${k.slice(2)}` : k.startsWith("u:") ? `https://${k.slice(2)}` : null;

function addKey(k, t, mint) {
  let e = index.get(k);
  if (!e) index.set(k, (e = { ts: [], mints: [] }));
  e.ts.push(t);
  if (mint) e.mints.push(mint);
}
function ingest() {
  for (let i = recentLaunches.length - 1; i >= 0; i--) {
    const l = recentLaunches[i];
    if (l.seen <= lastSeen && store.has(l.mint)) break;
    if (store.has(l.mint)) continue;
    const rec = { mint: l.mint, symbol: l.symbol, name: l.name, creator: l.creator, uri: l.uri, devSol: l.devSol, t: l.seen, keys: textKeys(l), linked: false, l };
    store.set(l.mint, rec);
    for (const k of rec.keys) addKey(k, rec.t, rec.mint);
    clusterStats.launches++;
    matchArmed(rec);
  }
  if (recentLaunches.length) lastSeen = recentLaunches[recentLaunches.length - 1].seen;
  // The metadata file (socials, links) arrives a few seconds after the launch itself.
  for (let i = recentLaunches.length - 1; i >= 0 && i >= recentLaunches.length - 120; i--) {
    const rec = store.get(recentLaunches[i].mint);
    if (!rec || rec.linked) continue;
    const m = getMeta(rec.mint);
    if (!m || m.pending) continue;
    rec.linked = true;
    if (m.failed) continue;
    rec.desc = m.description || "";
    for (const k of linkKeys(m)) if (!rec.keys.has(k)) { rec.keys.add(k); addKey(k, rec.t, rec.mint); }
  }
}
function prune() {
  const cut = now() - WINDOW - 10 * MIN;
  for (const [m, r] of store) if (r.t < cut) store.delete(m);
  for (const [k, e] of index) {
    while (e.ts.length && e.ts[0] < cut) e.ts.shift();
    while (e.mints.length && !store.has(e.mints[0])) e.mints.shift();
    if (!e.ts.length) index.delete(k);
  }
  for (const [id, s] of state) if (now() - Math.max(s.formingT || 0, s.cardT || 0) > WINDOW) state.delete(id);
  clusterStats.keys = index.size;
}

// ---------- detection ----------
// What one key looks like right now. Pure: takes the times and members, returns the numbers.
export function measure(key, ts, members, t = now(), stats = (mint) => live.get(mint)) {
  const n10 = ts.filter((x) => x > t - 10 * MIN).length, n60 = ts.filter((x) => x > t - 60 * MIN).length;
  // How often this key normally shows up: its launches per 10 minutes over the 3 hours before the burst.
  const before = ts.filter((x) => x <= t - 10 * MIN).length, span = Math.max(30 * MIN, Math.min(WINDOW - 10 * MIN, t - 10 * MIN - (ts[0] || t)));
  const base = before / (span / (10 * MIN)), lift = n10 / Math.max(0.34, base);
  const recent = members.filter((m) => m.t > t - 60 * MIN);
  const devs = new Set(recent.filter((m) => m.t > t - 10 * MIN).map((m) => m.creator || m.mint)).size;
  let traders = 0, vol = 0, alive = 0, lead = null, best = null;
  for (const m of recent) {
    const s = stats(m.mint);
    if (!s) continue;
    const tr = s.traders.size ?? s.traders;
    traders += tr; vol += s.vol || 0;
    if (tr >= 20 && s.buys > s.sells) alive++;
    if (!lead || tr > lead.traders) lead = { mint: m.mint, symbol: m.symbol, name: m.name, t: m.t, traders: tr, mc: s.mc, buys: s.buys, sells: s.sells };
    const mult = s.mc0 > 0 ? s.ath / s.mc0 : 1;
    if (!best || mult > best.mult) best = { mint: m.mint, symbol: m.symbol, mult };
  }
  const link = isLink(key);
  // A burst: enough separate launchers, well above this key's normal rate. Shared links need fewer.
  const burst = link ? n10 >= 3 && devs >= 2 : n10 >= 4 && devs >= 3 && lift >= 4;
  // Money: real buyers in at least one of them. Without it, it is launch spam and nobody is asked about it.
  const money = alive >= 1 && traders >= 40;
  return { key, n10, n60, lift: +lift.toFixed(1), devs, traders, vol, alive, lead, best, burst, money, forming: burst && money,
    score: traders * 0.5 + n10 * 5 + alive * 10 + (link ? 15 : 0) };
}

function detect() {
  const t = now(), found = [];
  for (const [key, e] of index) {
    if (e.ts.length < 3 || e.ts[e.ts.length - 1] < t - 10 * MIN) continue;
    const members = e.mints.map((m) => store.get(m)).filter(Boolean);
    const c = measure(key, e.ts, members, t);
    if (c.burst) found.push({ ...c, members });
  }
  // The same story shows up under several keys (its ticker, a word in its name, its post): keep one
  // cluster per story, the strongest, and note the other keys on it.
  found.sort((a, b) => b.score - a.score);
  const out = [];
  for (const c of found) {
    const mine = new Set(c.members.filter((m) => m.t > t - 60 * MIN).map((m) => m.mint));
    const same = out.find((o) => { let hit = 0; for (const m of o.set) if (mine.has(m)) hit++; return hit >= Math.min(o.set.size, mine.size) * 0.5; });
    if (same) { same.keys.push(c.key); continue; }
    out.push({ ...c, set: mine, keys: [c.key] });
  }
  return out;
}

// ---------- the Grok card ----------
const CARD_SYSTEM = `You identify memecoin narratives for a Solana trader, the minute they start. Several different people have just launched coins on pump.fun that share a ticker, a word or a linked post, and real buyers are arriving. Find out what the story is.
Use x_search (and web search if it is a news story): what happened, the original post or event, who is spreading it (follower counts), how fast, and whether it is real people or bots and launch farms.
Decide the stage: "early" (the catalyst is minutes to an hour old and still spreading), "running" (coins are pumping, attention growing), "peaking" (crowded, late), "dead" (old, or no real story behind the launches).
Speed matters more than depth here: run at most three searches, then answer with what you have.
Never invent a post, an account, a number or a URL. If you find nothing behind it, say so: real=false, stage "dead".
Reply with ONLY JSON:
{"name":"2-5 word name for the narrative","what":"what happened and why coins are launching on it, 1-2 sentences","real":true|false,
"source":{"url":"https://... the original post or article you found, or null","who":"account or outlet","when":"when it was posted"},
"spread":"who is posting it and how fast, 1 sentence","organic":"organic|mixed|botted|none","stage":"early|running|peaking|dead","confidence":0-100,
"keywords":["3-8 lowercase words or short phrases a coin on this narrative would use in its name or ticker"],
"lead":"the ticker most likely to be THE coin of this narrative, from the list given","risk":"what kills it, 1 sentence"}`;

db.exec(`CREATE TABLE IF NOT EXISTS narrative_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT, t INTEGER, name TEXT, stage TEXT, thesis TEXT, catalysts TEXT, keywords TEXT,
  confidence INTEGER, playbook INTEGER, model TEXT, examples TEXT, matches TEXT, best_mult REAL, best_peak REAL,
  launches_after INTEGER, status TEXT DEFAULT 'open', checked_t INTEGER
)`);
for (const c of ["source TEXT", "cluster_key TEXT", "ms INTEGER", "detect_ms INTEGER", "updated_t INTEGER", "seen INTEGER DEFAULT 1", "med_mult REAL", "lead_mult REAL", "lead_mint TEXT"])
  try { db.exec(`ALTER TABLE narrative_calls ADD COLUMN ${c}`); } catch {}

const nameKey = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
// One story is one row. A narrative found again (by the scout or by a later burst) updates the row it
// already has, and keeps the time it was first called so its result is measured from then.
export function upsertNarrative(n) {
  const kws = n.keywords || [];
  const open = db.prepare("SELECT id, name, keywords, cluster_key, seen, confidence FROM narrative_calls WHERE t > ? AND status = 'open' ORDER BY t DESC").all(now() - 8 * 60 * MIN);
  const same = open.find((o) => (n.clusterKey && o.cluster_key === n.clusterKey) || nameKey(o.name) === nameKey(n.name)
    || (() => { const a = new Set(json(o.keywords, [])); const hit = kws.filter((k) => a.has(k)).length; return hit >= 2 && hit >= Math.min(a.size, kws.length) * 0.6; })());
  if (same) {
    db.prepare(`UPDATE narrative_calls SET stage = ?, thesis = COALESCE(?, thesis), catalysts = COALESCE(?, catalysts), keywords = ?, confidence = ?, updated_t = ?, seen = COALESCE(seen, 1) + 1,
      cluster_key = COALESCE(cluster_key, ?), model = COALESCE(?, model) WHERE id = ?`)
      .run(n.stage, n.thesis || null, n.catalysts ? JSON.stringify(n.catalysts) : null, JSON.stringify([...new Set([...json(same.keywords, []), ...kws])].slice(0, 10)), n.confidence ?? same.confidence, now(), n.clusterKey || null, n.model || null, same.id);
    return { id: same.id, updated: true };
  }
  db.prepare(`INSERT INTO narrative_calls (t, name, stage, thesis, catalysts, keywords, confidence, playbook, model, examples, matches, checked_t, source, cluster_key, ms, detect_ms, updated_t, lead_mint)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(now(), String(n.name).slice(0, 80), n.stage, n.thesis || "", JSON.stringify(n.catalysts || {}), JSON.stringify(kws), Math.max(0, Math.min(100, Math.round(n.confidence || 0))),
      db.prepare("SELECT MAX(version) v FROM playbook").get()?.v || 0, n.model || null, JSON.stringify(n.examples || []), JSON.stringify(n.matches || []), now(),
      n.source || "scout", n.clusterKey || null, n.ms ?? null, n.detectMs ?? null, now(), n.leadMint || null);
  return { id: db.prepare("SELECT last_insert_rowid() id").get().id, updated: false };
}

const inHour = () => { while (cardHour.length && cardHour[0] < now() - 60 * MIN) cardHour.shift(); return cardHour.length; };
const usd = (sol) => Math.round((sol || 0) * feed.solUsd);
async function card(c, st) {
  const t0 = now(), top = c.members.filter((m) => m.t > now() - 60 * MIN).map((m) => ({ m, s: live.get(m.mint) })).sort((a, b) => (b.s?.traders.size || 0) - (a.s?.traders.size || 0)).slice(0, 8);
  const links = c.keys.filter(isLink).map(linkUrl).filter(Boolean);
  const data = {
    sharedBy: c.keys.map(label), sharedLinks: links, launchesLast10Min: c.n10, launchesLastHour: c.n60, timesItsNormalRate: c.lift, differentLaunchers: c.devs,
    buyersAcrossThem: c.traders, volumeUsd: usd(c.vol), coinsWithRealBuying: c.alive,
    coins: top.map(({ m, s }) => ({ ticker: m.symbol, name: m.name, description: (m.desc || "").slice(0, 140) || undefined, ageMinutes: +((now() - m.t) / MIN).toFixed(1), mcapUsd: s ? usd(s.mc) : null, traders: s?.traders.size ?? 0, buys: s?.buys ?? 0, sells: s?.sells ?? 0, mint: m.mint })),
  };
  let r = null, out = null;
  if (grokReady("narrative") && inHour() < (settings.narrativeCardsPerHour || 6)) {
    cardHour.push(now());
    try {
      r = await askGrok(CARD_SYSTEM, `Burst (JSON):\n${JSON.stringify(data)}`, { model: settings.narrativeModel || "grok-4.7", search: true, maxSearches: 3, effort: "low", maxTokens: 900, timeout: 45_000, lane: "narrative" });
      out = extractJson(r.text);
    } catch (e) { clusterStats.lastError = e.message; if (!e.blocked && !e.busy) logEvent("error", `narrative card: ${e.message}`); }
  }
  const lead = (out?.lead && top.find(({ m }) => String(m.symbol).toLowerCase() === String(out.lead).replace(/^\$/, "").toLowerCase())?.m) || (c.lead && store.get(c.lead.mint)) || top[0]?.m;
  // No answer from Grok (out of budget, or it failed): the burst is still recorded and its words armed, as a plain observation.
  const words = c.keys.filter((k) => k.startsWith("w:")).map((k) => k.slice(2));
  const kws = (out ? (out.keywords || []) : words).map((k) => String(k).toLowerCase().trim()).filter((k) => k.length >= 3).slice(0, 8);
  const src = safeUrl(out?.source?.url);
  const n = {
    name: out?.name || `$${lead?.symbol || label(c.keys[0])} burst`, stage: out ? (["early", "running", "peaking", "dead"].includes(out.stage) ? out.stage : "running") : "running",
    thesis: out ? [out.what, out.spread].filter(Boolean).join(" ") : `${c.n10} coins launched in 10 minutes sharing ${c.keys.map(label).slice(0, 3).join(", ")}, with ${c.traders} buyers between them. Not yet looked up on X.`,
    catalysts: { catalysts: out?.what ? [out.what] : [], risk: out?.risk || null, sources: src ? [{ url: src, what: String(out.source.who || "source").slice(0, 160), when: String(out.source.when || "").slice(0, 40) }] : links.slice(0, 2).map((u) => ({ url: u, what: "linked by the launches", when: "" })),
      searches: r?.searches || 0, organic: out?.organic || null, real: out ? out.real !== false : null, burst: { n10: c.n10, n60: c.n60, lift: c.lift, devs: c.devs, traders: c.traders, sharedBy: c.keys.map(label) } },
    keywords: kws, confidence: out ? out.confidence : 30, model: r?.model || "radar", source: "cluster", clusterKey: c.keys[0], ms: r?.ms ?? null, detectMs: now() - st.formingT, leadMint: lead?.mint || null,
    examples: top.slice(0, 6).map(({ m }) => ({ ticker: String(m.symbol || "").slice(0, 20), mint: m.mint })),
  };
  if (!kws.length) return;
  const saved = upsertNarrative(n);
  st.cardT = now(); st.cardN = c.n60; st.cardTraders = c.traders; st.callId = saved.id; st.name = n.name; st.stage = n.stage;
  clusterStats.cards++; clusterStats.lastCardMs = now() - t0;
  armedT = 0;
  logEvent("research", `Narrative ${saved.updated ? "update" : "forming"}: ${n.name} (${n.stage}${out ? `, ${out.organic || "?"}, confidence ${n.confidence}` : ", not looked up"}) ${c.n10} launches in 10m, ${c.traders} buyers; named ${Math.round((now() - st.formingT) / 1000)}s after the burst began`);
  // The lead coin gets tracked, read and (once) announced.
  if (!lead || n.stage === "dead" || n.stage === "peaking" || (out && out.real === false)) return;
  await adoptLaunch(lead.l || lead).catch(() => {});
  const s = live.get(lead.mint);
  enqueueFn?.(lead.mint, (s?.progress ?? 0) >= 0.6 ? "near" : "new", 5e11 + (n.confidence || 0) * 1e6);
  const tok = q.getToken.get(lead.mint);
  if (tok && !saved.updated && raiseFn) raiseFn({ ...tok, mcap: s ? usd(s.mc) : tok.mcap }, "narrative", `New narrative: ${n.name}`,
    `${n.thesis} Lead coin $${lead.symbol}${s ? ` at $${Math.round(usd(s.mc) / 1000)}k with ${s.traders.size} traders` : ""}. ${c.n10} launches in 10 minutes.${src ? ` Source: ${src}` : ""}`.slice(0, 500), 0, { safe: false, why: "a narrative alert, not a safety-checked buy signal" });
}

// ---------- armed keywords ----------
const GENERIC = new Set("ai cat cats dog dogs coin token sol solana meme memes pump fun the moon pepe frog inu baby king man official new bot agent agents chinese china usa trump elon x".split(" "));
function loadArmed() {
  if (now() - armedT < 30_000) return;
  armedT = now();
  armed = db.prepare("SELECT id, name, keywords, confidence, stage FROM narrative_calls WHERE t > ? AND status = 'open' AND stage IN ('early', 'running') ORDER BY t DESC LIMIT 40").all(now() - FRESH).map((n) => {
    const kws = json(n.keywords, []).filter((k) => k.length >= 4 && !GENERIC.has(k) && !COMMON.has(k));
    const esc = (k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s_-]*");
    return { id: n.id, name: n.name, confidence: n.confidence, res: kws.map((k) => new RegExp(`(^|[^\\p{L}\\p{N}])${esc(k)}($|[^\\p{L}\\p{N}])`, "iu")), hits: [] };
  }).filter((n) => n.res.length);
}
const armedFor = new Map();                  // mint -> { id, name, confidence }
export const narrativeFor = (mint) => armedFor.get(mint) || null;
function matchArmed(rec) {
  const text = `${rec.symbol || ""} ${rec.name || ""}`;
  for (const n of armed) {
    if (!n.res.some((re) => re.test(text))) continue;
    armedFor.set(rec.mint, { id: n.id, name: n.name, confidence: n.confidence });
    if (armedFor.size > 4000) armedFor.delete(armedFor.keys().next().value);
    clusterStats.armedHits++;
    // A known narrative attracts dozens of copies: only the first few each ten minutes are read on sight.
    n.hits = n.hits.filter((x) => x > now() - 10 * MIN);
    if (n.hits.length >= 6) return;
    n.hits.push(now());
    adoptLaunch(rec.l).then(() => enqueueFn?.(rec.mint, "new", 3e11 + (n.confidence || 0) * 1e6)).catch(() => {});
    return;
  }
}

// ---------- loop ----------
let busy = false;
async function tick() {
  if (busy) return;
  busy = true;
  const t0 = now();
  try {
    loadArmed();
    ingest();
    const found = detect();
    const jobs = [];
    for (const c of found) {
      const id = c.keys.find((k) => state.has(k)) || c.keys[0];
      let st = state.get(id);
      if (!st) state.set(id, (st = { formingT: null, cardT: 0 }));
      c.id = id; c.st = st;
      if (!c.forming) continue;
      st.formingT ||= now();
      // Looked up once when it forms, and again only if it has kept growing.
      const grown = st.cardT && (c.n60 >= 2 * (st.cardN || 1) || c.traders >= 3 * (st.cardTraders || 1));
      if (!st.busy && (!st.cardT || (grown && now() - st.cardT > COOLDOWN))) { st.busy = true; jobs.push(card(c, st).catch((e) => { clusterStats.lastError = e.message; }).finally(() => { st.busy = false; })); }
    }
    board = found.slice(0, 30).map((c) => ({
      id: c.id, keys: c.keys.map(label), links: c.keys.filter(isLink).map(linkUrl).filter(Boolean), n10: c.n10, n60: c.n60, lift: c.lift, devs: c.devs, traders: c.traders, volUsd: usd(c.vol), alive: c.alive,
      state: c.forming ? "forming" : "launches only", since: c.st.formingT, name: c.st.name || null, stage: c.st.stage || null, callId: c.st.callId || null, looking: Boolean(c.st.busy),
      lead: c.lead && { mint: c.lead.mint, symbol: c.lead.symbol, name: c.lead.name, traders: c.lead.traders, mcap: usd(c.lead.mc), age: now() - c.lead.t },
      best: c.best && c.best.mult >= 1.5 ? { mint: c.best.mint, symbol: c.best.symbol, mult: +c.best.mult.toFixed(1) } : null,
      coins: c.members.filter((m) => m.t > now() - 60 * MIN).slice(-12).map((m) => ({ mint: m.mint, symbol: m.symbol })),
    }));
    clusterStats.forming = board.filter((b) => b.state === "forming").length;
    await Promise.allSettled(jobs.length ? [Promise.race([Promise.all(jobs), new Promise((ok) => setTimeout(ok, 100))])] : []);
  } catch (e) { clusterStats.lastError = e.message; }
  finally { clusterStats.lastMs = now() - t0; busy = false; }
}

// For the page and for the scout: the bursts right now, and the narratives whose keywords are armed.
export const clusterBoard = () => ({ clusters: board, armed: armed.map((n) => ({ id: n.id, name: n.name, confidence: n.confidence })), stats: clusterStats, grok: grokReady("narrative") });

export function startClusters({ enqueue, raise }) {
  enqueueFn = enqueue; raiseFn = raise;
  // Six hours of launch names are already on disk: they are the "normal rate" a burst is measured against.
  for (const l of launchLog) for (const k of textKeys(l)) addKey(k, l.t, null);
  for (const e of index.values()) e.ts.sort((a, b) => a - b);
  prune();
  setInterval(() => { tick(); }, 5000);
  setInterval(prune, 60_000);
}
