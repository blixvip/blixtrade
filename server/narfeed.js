// The Narratives page in one answer: every story Grok (or the burst detector) has named in the last
// 12 hours, ranked by how alive it is right now, with its coins (pictures, market caps, buyers) and the
// X posts it came from. Read-only: no Grok calls, no writes. Posts are read through FxTwitter in the
// background, one every 3 s, and kept 30 minutes, so the page never waits on X.
import { db, json } from "./db.js";
import { narrativeBoard } from "./brain.js";
import { clusterBoard } from "./clusters.js";
import { live, feed } from "./livetrades.js";
import { grokSpend, grokStatus, grokReady } from "./grok.js";
import { safeUrl } from "./quality.js";

const now = () => Date.now();
const MIN = 60_000;
const usd = (sol) => Math.round((sol || 0) * feed.solUsd);

// ---------- X posts ----------
const tweets = new Map();                   // id -> { t, post | null }
const queue = [];
let pumping = false;
const TWEET_TTL = 30 * MIN, TWEET_MAX = 300;
const postId = (url) => String(url || "").match(/(?:x|twitter)\.com\/[^/]+\/status\/(\d{5,25})/i)?.[1] || null;

async function readPost(id) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 10_000);
  try {
    const r = await fetch(`https://api.fxtwitter.com/status/${id}`, { signal: ctl.signal, headers: { accept: "application/json", "user-agent": "blix/1.0" } });
    if (!r.ok) return null;
    const tw = (await r.json()).tweet;
    if (!tw) return null;
    const m = tw.media || {};
    return {
      id, url: safeUrl(tw.url) || `https://x.com/i/status/${id}`, text: String(tw.text || "").slice(0, 600),
      author: { name: tw.author?.name || "", handle: tw.author?.screen_name || "", avatar: safeUrl(tw.author?.avatar_url), verified: Boolean(tw.author?.verification?.verified), followers: tw.author?.followers ?? null },
      photos: [...(m.photos || []).map((p) => p.url), ...(m.videos || []).map((v) => v.thumbnail_url)].map(safeUrl).filter(Boolean).slice(0, 4),
      video: Boolean(m.videos?.length), likes: tw.likes ?? 0, retweets: tw.retweets ?? 0, replies: tw.replies ?? 0, views: tw.views ?? null,
      t: tw.created_timestamp ? tw.created_timestamp * 1000 : null,
      quote: tw.quote ? { handle: tw.quote.author?.screen_name || "", name: tw.quote.author?.name || "", text: String(tw.quote.text || "").slice(0, 280), avatar: safeUrl(tw.quote.author?.avatar_url) } : null,
    };
  } catch { return null; } finally { clearTimeout(timer); }
}
async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length) {
      const id = queue.shift();
      const have = tweets.get(id);
      if (have && now() - have.t < TWEET_TTL) continue;
      tweets.set(id, { t: now(), post: await readPost(id) });
      while (tweets.size > TWEET_MAX) tweets.delete(tweets.keys().next().value);
      await new Promise((ok) => setTimeout(ok, 3000).unref());
    }
  } finally { pumping = false; }
}
function post(id) {
  const have = tweets.get(id);
  if (!have || now() - have.t > TWEET_TTL) { if (!queue.includes(id) && queue.length < 60) queue.push(id); pump(); }
  return have?.post || null;
}

// ---------- coins ----------
const tokenRow = db.prepare("SELECT mint, symbol, name, mcap, chg_h1, vol_h1, peak_mcap, graduated, status FROM tokens WHERE mint = ?");
function coin(mint, fallback = {}) {
  const r = tokenRow.get(mint), s = live.get(mint);
  const mcap = s ? usd(s.mc) : r?.mcap ?? fallback.mcap ?? null;
  const base = fallback.base || null;
  return {
    mint, symbol: r?.symbol || fallback.symbol || fallback.ticker || "?", name: r?.name || null, mcap,
    traders: s?.traders?.size ?? null, progress: s?.progress ?? null, chg1h: r?.chg_h1 ?? null, vol1h: r?.vol_h1 ?? null,
    bonded: Boolean(r?.graduated), dead: Boolean(fallback.dead) || r?.status === "dead",
    sinceCall: base && mcap ? +(mcap / base).toFixed(2) : null,
  };
}

// A later plain update can overwrite the model column with "radar", so Grok's read is recognised by its text too.
const looked = (n) => /^grok/i.test(n.model || "") || ((n.catalysts?.searches || 0) > 0) || (!!n.thesis && !/Not yet looked up on X/.test(n.thesis));

// ---------- ranking ----------
// Alive = buyers and volume right now, how fast launches are still coming, how sure Grok was, and how recent.
function heat(n, cl, coins, hasPost) {
  const traders = Math.max(cl?.traders || 0, coins.filter((c) => c.via === "burst").reduce((a, c) => a + (c.traders || 0), 0), n.catalysts?.burst?.traders || 0);
  const vol = cl?.volUsd || coins.filter((c) => c.via === "burst").reduce((a, c) => a + (c.vol1h || 0), 0);
  const topMc = Math.max(0, ...coins.filter((c) => c.via === "burst").map((c) => c.mcap || 0));
  const age = (now() - (n.updated_t || n.t)) / MIN;
  const raw = 14 * Math.log10(1 + traders) + 9 * Math.log10(1 + vol / 1000) + 8 * Math.log10(1 + topMc / 10_000) + (cl?.n10 || 0) * 2.5
    + (n.confidence || 0) * 0.25 + (looked(n) ? 18 : 0) + (hasPost ? 6 : 0) + (cl?.state === "forming" ? 10 : 0) - (n.stage === "dead" ? 30 : n.stage === "peaking" ? 8 : 0);
  // A story Grok has read and sourced stays relevant longer than a bare burst of copies.
  return Math.max(0, Math.round(raw * Math.exp(-age / (looked(n) ? 480 : 240))));
}

const grokRead = db.prepare("SELECT * FROM narrative_calls WHERE t > ? AND model LIKE 'grok%' ORDER BY t DESC LIMIT 40");
export function narrativeFeed() {
  const nb = narrativeBoard(), cb = clusterBoard();
  const byCall = new Map(cb.clusters.filter((c) => c.callId).map((c) => [c.callId, c]));
  // narrativeBoard() keeps the 60 most recently touched; Grok's reads from the last day are added so a busy hour of plain bursts cannot push them off.
  const have = new Set(nb.calls.map((n) => n.id));
  const extra = grokRead.all(now() - 24 * 60 * MIN).filter((n) => !have.has(n.id)).map((n) => ({ ...n, keywords: json(n.keywords, []), catalysts: json(n.catalysts, {}), matches: json(n.matches, []), examples: json(n.examples, []) }));
  const items = [...nb.calls, ...extra].filter((n) => n.status !== "dismissed").map((n) => {
    const cl = byCall.get(n.id) || null;
    const seen = new Set(), coins = [];
    // The burst's own coins first (biggest first); keyword matches after them, since a word match can be an unrelated coin.
    const add = (mint, fb, via) => { if (!mint || seen.has(mint) || coins.length >= 10) return; seen.add(mint); coins.push({ ...coin(mint, fb), via }); };
    for (const e of n.examples || []) add(e.mint, e, "burst");
    for (const c of cl?.coins || []) add(c.mint, c, "burst");
    const lead = n.lead_mint && (coins.find((c) => c.mint === n.lead_mint) || coin(n.lead_mint, {}));
    coins.sort((a, b) => (b.mcap || 0) - (a.mcap || 0));
    if (lead) { const i = coins.indexOf(lead); if (i > 0) coins.splice(i, 1); if (i !== 0) coins.unshift({ ...lead, via: "burst" }); lead.lead = true; coins[0].lead = coins[0].mint === n.lead_mint; seen.add(lead.mint); }
    for (const m of (n.matches || []).slice().sort((a, b) => (b.mcap || 0) - (a.mcap || 0))) add(m.mint, m, "match");
    const cat = n.catalysts || {};
    const sources = (cat.sources || []).map((s) => ({ url: safeUrl(s.url), what: s.what || "", when: s.when || "" })).filter((s) => s.url);
    const posts = sources.map((s) => postId(s.url)).filter(Boolean).slice(0, 3).map(post).filter(Boolean);
    return {
      id: n.id, name: n.name, stage: n.stage, confidence: n.confidence, grok: looked(n), model: n.model, thesis: n.thesis || "",
      risk: cat.risk || null, organic: cat.organic || null, real: cat.real ?? null, keywords: n.keywords || [], searches: cat.searches || 0,
      t: n.t, updated: n.updated_t || n.t, detectMs: n.detect_ms ?? null, source: n.source,
      burst: cl ? { n10: cl.n10, n60: cl.n60, devs: cl.devs, traders: cl.traders, volUsd: cl.volUsd, state: cl.state, lift: cl.lift } : cat.burst || null,
      coins, sources, posts, bestMult: n.best_mult ?? null, heat: heat(n, cl, coins, posts.length > 0 || sources.some((x) => postId(x.url))),
    };
  }).sort((a, b) => b.heat - a.heat);
  const named = new Set(cb.clusters.filter((c) => c.callId).map((c) => c.id));
  const g = grokStatus(), sp = grokSpend();
  return {
    t: now(), items,
    forming: cb.clusters.filter((c) => !named.has(c.id) && c.state === "forming").slice(0, 8).map((c) => ({ id: c.id, keys: c.keys, n10: c.n10, traders: c.traders, volUsd: c.volUsd, looking: c.looking, since: c.since, coins: c.coins.slice(-6).map((x) => coin(x.mint, x)) })),
    scanner: { launches: cb.stats.launches, forming: cb.stats.forming, armed: cb.armed.length, armedHits: cb.stats.armedHits, cards: cb.stats.cards, lastCardMs: cb.stats.lastCardMs },
    grok: { ready: grokReady("narrative"), installed: g.installed, blocked: Boolean(g.blockedUntil && g.blockedUntil > now()), spentToday: sp.today, budget: sp.budget, narrativeSpend: sp.lanes?.narrative ?? null },
    scout: nb.scout, record: nb.record.all,
  };
}
