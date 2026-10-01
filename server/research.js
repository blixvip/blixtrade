// AI research desk: coins about to bond on pump.fun and coins that just bonded get researched
// (metadata, website, X account, linked tweets, news, copycats, holders, flow) and graded by Claude
// on how strong the narrative is and how high it could realistically go. All sources are free.
import { db, q, json, logEvent } from "./db.js";
import { settings } from "./settings.js";
import { ask } from "./ai.js";
import { themesFor, computeNarratives } from "./narratives.js";

db.exec(`
CREATE TABLE IF NOT EXISTS research (
  mint TEXT PRIMARY KEY, stage TEXT, status TEXT, t INTEGER, queued INTEGER,
  grade TEXT, score INTEGER, ceiling TEXT, verdict TEXT, report TEXT, sources TEXT, error TEXT,
  mcap_at REAL
);
`);
try { db.exec("ALTER TABLE tokens ADD COLUMN uri TEXT"); } catch {}

const MIN = 60_000;
const now = () => Date.now();
const GATEWAY = "https://pump.mypinata.cloud/ipfs/";
export const ipfs = (u) => u ? String(u).replace(/^https?:\/\/[^/]+\/ipfs\//, GATEWAY).replace(/^ipfs:\/\//, GATEWAY) : u;

// ---------- bonding progress ----------
// pump.fun coins bond at roughly 440 SOL of market cap; learn the real figure from coins we saw graduate.
let solUsd = 120;
export function setSolPrice(v) { if (v > 0) solUsd = v; }
function gradMcapUsd() {
  const rows = db.prepare(`SELECT (SELECT mcap FROM snapshots s WHERE s.mint = t.mint AND s.mcap > 0 ORDER BY s.t LIMIT 1) m
    FROM tokens t WHERE t.source = 'pump-graduated' AND t.first_seen > ?`).all(now() - 24 * 60 * MIN).map((r) => r.m).filter((m) => m > 15000 && m < 200000).sort((a, b) => a - b);
  const learned = rows.length >= 10 ? rows[Math.floor(rows.length / 2)] : 0;
  return learned || 440 * solUsd;
}
export function bondingProgress(t) {
  if (t.dex !== "pumpfun" || !t.mcap) return null;
  const start = 28 * solUsd, end = gradMcapUsd();   // a fresh pump.fun coin starts near 28 SOL of mcap
  return Math.max(0, Math.min(1, (t.mcap - start) / (end - start)));
}

export function candidates() {
  const near = db.prepare(`SELECT * FROM tokens WHERE status = 'active' AND dex = 'pumpfun' AND pair IS NOT NULL ORDER BY mcap DESC LIMIT 200`).all()
    .map((t) => ({ ...t, progress: bondingProgress(t) })).filter((t) => t.progress >= 0.6).sort((a, b) => b.progress - a.progress);
  const bonded = db.prepare(`SELECT * FROM tokens WHERE status = 'active' AND graduated = 1 AND pair IS NOT NULL
    AND COALESCE(pair_created, first_seen) > ? ORDER BY COALESCE(pair_created, first_seen) DESC LIMIT 80`).all(now() - 3 * 60 * MIN);
  return { near, bonded };
}

// ---------- gathering ----------
async function getText(url, ms = 12000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { "user-agent": "Mozilla/5.0 meme-radar research", accept: "text/html,application/json,*/*" }, redirect: "follow" });
  if (!r.ok) throw new Error(`${r.status}`);
  return (await r.text()).slice(0, 400_000);
}
const getJson = async (url) => JSON.parse(await getText(url));
const strip = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&amp;|&#\d+;|&\w+;/g, " ").replace(/\s+/g, " ").trim();

function xHandle(url) {
  const m = String(url || "").match(/(?:x|twitter)\.com\/(?!i\/|intent|search|home)([A-Za-z0-9_]{1,15})(?:\/?$|\?|\/status\/(\d+))/i);
  return m ? { user: m[1], status: m[2] || null } : null;
}

async function metadata(t) {
  if (!t.uri) return null;
  try {
    const m = await getJson(ipfs(t.uri));
    return { name: m.name, symbol: m.symbol, description: m.description?.slice(0, 600), twitter: m.twitter, telegram: m.telegram, website: m.website, createdOn: m.createdOn };
  } catch { return null; }
}

async function website(url) {
  if (!url || /(x|twitter|t)\.(com|me)\//i.test(url)) return null;
  try {
    const html = await getText(url);
    const title = html.match(/<title[^>]*>([^<]{0,140})/i)?.[1]?.trim();
    const desc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{0,300})/i)?.[1];
    return { url, title, description: desc, text: strip(html).slice(0, 1800) };
  } catch (e) { return { url, error: `site did not load (${e.message})` }; }
}

async function xProfile(user) {
  try {
    const d = await getJson(`https://api.fxtwitter.com/${user}`);
    const u = d.user;
    if (!u) return { user, error: "account not found" };
    return { user: u.screen_name, name: u.name, followers: u.followers, following: u.following, tweets: u.tweets, joined: u.joined, description: u.description?.slice(0, 280), avatar: u.avatar_url, verified: u.verification?.verified || false };
  } catch (e) { return { user, error: e.message }; }
}

async function xStatus(user, id) {
  try {
    const d = await getJson(`https://api.fxtwitter.com/${user}/status/${id}`);
    const tw = d.tweet;
    if (!tw) return null;
    return { author: tw.author?.screen_name, authorFollowers: tw.author?.followers, text: tw.text?.slice(0, 500), likes: tw.likes, retweets: tw.retweets, views: tw.views, created: tw.created_at };
  } catch { return null; }
}

async function news(term) {
  if (!term || term.length < 3) return [];
  try {
    const xml = await getText(`https://news.google.com/rss/search?q=${encodeURIComponent(`"${term}"`)}+when:7d&hl=en-US&gl=US&ceid=US:en`);
    return [...xml.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<pubDate>([\s\S]*?)<\/pubDate>[\s\S]*?<\/item>/g)]
      .slice(0, 6).map((m) => ({ title: m[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim(), date: m[2].trim() }));
  } catch { return []; }
}

async function copycats(t) {
  try {
    const d = await getJson(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(t.symbol || t.name)}`);
    const same = (d.pairs || []).filter((p) => p.chainId === "solana" && (p.baseToken?.symbol || "").toLowerCase() === (t.symbol || "").toLowerCase());
    const byMint = new Map();
    for (const p of same) { const m = p.baseToken.address; if (!byMint.has(m) || (p.marketCap || 0) > (byMint.get(m).marketCap || 0)) byMint.set(m, p); }
    const list = [...byMint.values()].sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0));
    const rank = list.findIndex((p) => p.baseToken.address === t.mint);
    const oldest = [...list].sort((a, b) => (a.pairCreatedAt || 9e15) - (b.pairCreatedAt || 9e15))[0];
    return { sameTicker: list.length, rankByMcap: rank >= 0 ? rank + 1 : null, isOldest: oldest?.baseToken.address === t.mint, biggest: list[0] ? { mcap: Math.round(list[0].marketCap || 0), isThis: list[0].baseToken.address === t.mint } : null };
  } catch { return null; }
}

async function gather(t, stage) {
  const meta = await metadata(t);
  const links = json(t.links, []);
  const xUrl = meta?.twitter || links.find((l) => /twitter|x\.com/i.test(`${l.type} ${l.url}`))?.url;
  const site = meta?.website || links.find((l) => l.type === "website")?.url;
  const xh = xHandle(xUrl);
  const statusLinks = [meta?.twitter, meta?.website, meta?.description, t.description].join(" ").match(/(?:x|twitter)\.com\/[A-Za-z0-9_]+\/status\/\d+/gi) || [];
  const [profile, siteInfo, tweet, headlines, cats] = await Promise.all([
    xh && !xh.status ? xProfile(xh.user) : null,
    website(site),
    xh?.status ? xStatus(xh.user, xh.status) : statusLinks[0] ? xStatus(...statusLinks[0].split(/\.com\/|\/status\//).slice(1, 3)) : null,
    news(t.name && t.name.length > 3 ? t.name : t.symbol),
    copycats(t),
  ]);
  const s = json(t.safety) || {};
  const nar = computeNarratives({});
  const themes = themesFor({ ...t, description: meta?.description || t.description });
  const flow = db.prepare(`SELECT COUNT(DISTINCT CASE WHEN side = 'buy' THEN wallet END) buyers, COUNT(DISTINCT CASE WHEN side = 'sell' THEN wallet END) sellers
    FROM fomo_flow WHERE mint = ? AND t > ?`).get(t.mint, now() - 60 * MIN);
  const smart = db.prepare(`SELECT COUNT(DISTINCT wt.wallet) n FROM wallet_trades wt JOIN wallets w ON w.address = wt.wallet WHERE wt.mint = ? AND wt.side = 'buy' AND w.watching = 1`).get(t.mint).n;
  return {
    stage, ticker: t.symbol, name: t.name, mint: t.mint,
    description: meta?.description || t.description || null,
    market: {
      mcap: Math.round(t.mcap || 0), peakMcap: Math.round(t.peak_mcap || 0), liquidity: Math.round(t.liquidity || 0),
      vol5m: Math.round(t.vol_m5 || 0), vol1h: Math.round(t.vol_h1 || 0), chg5m: t.chg_m5, chg1h: t.chg_h1,
      buys1h: t.buys_h1, sells1h: t.sells_h1, ageMinutes: Math.round((now() - (t.pair_created || t.first_seen)) / MIN),
      bondingProgressPct: stage === "near" ? Math.round((bondingProgress(t) || 0) * 100) : 100,
    },
    holders: { total: s.totalHolders ?? null, top10Pct: s.top10 ?? null, insiderPct: s.insiderPct ?? null, devPct: s.devPct ?? null, devOtherLaunches: s.devLaunches ?? null, safetyScore: t.safety_score, dangerRisks: (s.risks || []).filter((r) => r.level === "danger").map((r) => r.name) },
    socials: { x: profile, website: siteInfo, linkedTweet: tweet, telegram: meta?.telegram || links.find((l) => l.type === "telegram")?.url || null },
    news: headlines,
    copycats: cats,
    themes,
    themeHeat: nar.themes.filter((x) => themes.includes(x.name)).map((x) => ({ theme: x.name, heat: x.heat, launchSharePct: +(x.launchShare * 100).toFixed(1) })),
    hottestThemesNow: nar.themes.slice(0, 5).map((x) => x.name),
    fomoTradersLastHour: flow, followedWalletsBought: smart,
  };
}

// ---------- grading ----------
const SYSTEM = `You are a sharp memecoin narrative analyst. The user trades Solana memecoins right around pump.fun bonding.
You get research gathered seconds ago about one coin. Judge how strong and how big its NARRATIVE is, and how high it could realistically go.

Grade on:
- Narrative strength: is the meme instantly understandable, funny, emotional, tied to a culture moment or a big name?
- Timeliness: is there a live catalyst (news, viral tweet, event) right now, or is it stale?
- Originality: is this the original/first coin for this meme, or a late copycat? (copycats data: rankByMcap, isOldest)
- Reach: who is talking about it (X account followers, linked tweet engagement, news coverage)?
- Momentum and holders: real buying, holder spread, dev and insider behaviour.
Be blunt. Most coins are C or worse. Give A only to coins with a genuinely strong, timely, original narrative AND healthy trading. Never invent facts that are not in the data; say "unknown" instead.

Reply with ONLY a JSON object, no prose around it:
{"grade":"A+|A|A-|B+|B|B-|C+|C|C-|D|F","score":0-100,"verdict":"one punchy sentence",
"narrative":{"summary":"what the meme is, 1-2 sentences","strength":0-10,"timeliness":0-10,"originality":0-10,"reach":0-10},
"catalyst":"the live catalyst, or 'none found'",
"ceiling":{"tier":"<$250k|$250k-$1M|$1M-$10M|$10M-$100M|$100M+","why":"1-2 sentences"},
"bull":["..."],"bear":["..."],"redFlags":["..."],"confidence":"low|medium|high"}`;

const GRADES = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D", "F"];

async function grade(data) {
  const { text, model } = await ask(SYSTEM, `Research (JSON):\n${JSON.stringify(data)}`, 1200);
  const raw = text.match(/\{[\s\S]*\}/)?.[0];
  const r = JSON.parse(raw);
  if (!GRADES.includes(r.grade)) throw new Error(`bad grade ${r.grade}`);
  return { ...r, model };
}

// ---------- queue ----------
let busy = false, hourCount = [], raiseFn = null;
export function enqueue(mint, stage, priority = 0) {
  const cur = db.prepare("SELECT * FROM research WHERE mint = ?").get(mint);
  if (cur && (cur.status === "queued" || cur.status === "running")) return;
  if (cur && cur.stage === stage && cur.status === "done") return;
  db.prepare(`INSERT INTO research (mint, stage, status, queued) VALUES (?, ?, 'queued', ?)
    ON CONFLICT(mint) DO UPDATE SET stage = excluded.stage, status = 'queued', queued = excluded.queued, error = NULL`).run(mint, stage, now() - priority);
}

async function work() {
  if (busy) return;
  hourCount = hourCount.filter((t) => t > now() - 60 * MIN);
  if (hourCount.length >= settings.researchPerHour) return;
  const job = db.prepare("SELECT * FROM research WHERE status = 'queued' ORDER BY queued ASC LIMIT 1").get();
  if (!job) return;
  const t = q.getToken.get(job.mint);
  if (!t) { db.prepare("DELETE FROM research WHERE mint = ?").run(job.mint); return; }
  busy = true;
  hourCount.push(now());
  db.prepare("UPDATE research SET status = 'running' WHERE mint = ?").run(job.mint);
  try {
    const data = await gather(t, job.stage);
    const r = await grade(data);
    db.prepare(`UPDATE research SET status = 'done', t = ?, grade = ?, score = ?, ceiling = ?, verdict = ?, report = ?, sources = ?, mcap_at = ?, error = NULL WHERE mint = ?`)
      .run(now(), r.grade, r.score, r.ceiling?.tier || null, r.verdict, JSON.stringify(r), JSON.stringify(data), t.mcap, job.mint);
    logEvent("research", `$${t.symbol} graded ${r.grade}: ${r.verdict}`);
    if (["A+", "A", "A-"].includes(r.grade) && raiseFn) {
      const last = q.lastSignal.get(t.mint, "research");
      if (!last || now() - last.t > 6 * 60 * MIN)
        raiseFn(t, "research", `AI grades $${t.symbol} ${r.grade}${job.stage === "near" ? " before bonding" : " after bonding"}`, `${r.verdict} Ceiling ${r.ceiling?.tier || "?"}. ${r.narrative?.summary || ""}`.slice(0, 400));
    }
  } catch (e) {
    // One automatic retry a minute later (a flaky site or a malformed answer usually clears up).
    if (!String(job.error || "").startsWith("retry:")) {
      db.prepare("UPDATE research SET status = 'queued', queued = ?, error = ? WHERE mint = ?").run(now() + 60_000, `retry: ${String(e.message).slice(0, 280)}`, job.mint);
      return;
    }
    db.prepare("UPDATE research SET status = 'error', t = ?, error = ? WHERE mint = ?").run(now(), String(e.message).slice(0, 300).replace(/^retry: /, ""), job.mint);
    logEvent("error", `research $${t.symbol}: ${e.message}`);
  } finally {
    busy = false;
  }
}

// Pick up new candidates: near-bond coins once they're 80%+ there, bonded coins once they have real volume.
function scout() {
  if (!settings.researchAuto) return;
  const { near, bonded } = candidates();
  for (const t of near) {
    if (t.progress < 0.8 || (t.vol_h1 || 0) < 8000 || json(t.safety)?.danger > 0) continue;
    enqueue(t.mint, "near", Math.round(t.progress * 100) * 1000);
  }
  for (const t of bonded) {
    if ((t.mcap || 0) < 35000 || (t.vol_h1 || 0) < 15000 || json(t.safety)?.danger > 0) continue;
    enqueue(t.mint, "bonded", Math.round((t.vol_h1 || 0) / 1000));
  }
}

export function researchFor(mint) {
  const r = db.prepare("SELECT * FROM research WHERE mint = ?").get(mint);
  return r && { ...r, report: json(r.report), sources: json(r.sources) };
}

export function desk() {
  const { near, bonded } = candidates();
  const attach = (t) => {
    const r = db.prepare("SELECT status, grade, score, ceiling, verdict, stage, t FROM research WHERE mint = ?").get(t.mint);
    return { mint: t.mint, symbol: t.symbol, name: t.name, image: t.image, mcap: t.mcap, vol_h1: t.vol_h1, chg_h1: t.chg_h1, buys_h1: t.buys_h1, sells_h1: t.sells_h1,
      safety_score: t.safety_score, progress: t.progress ?? null, bonded_at: t.pair_created || t.first_seen, research: r || null, themes: json(t.themes, []) };
  };
  const top = db.prepare(`SELECT r.mint, r.grade, r.score, r.ceiling, r.verdict, r.stage, r.t, r.mcap_at, t.symbol, t.name, t.image, t.mcap, t.chg_h1
    FROM research r JOIN tokens t ON t.mint = r.mint WHERE r.status = 'done' AND r.t > ? ORDER BY r.score DESC LIMIT 12`).all(now() - 12 * 60 * MIN);
  const stats = db.prepare("SELECT status, COUNT(*) n FROM research GROUP BY status").all();
  return { near: near.slice(0, 30).map(attach), bonded: bonded.slice(0, 30).map(attach), top, stats, perHour: settings.researchPerHour, auto: settings.researchAuto };
}

export function startResearch(raise) {
  raiseFn = raise;
  const timers = [setInterval(scout, 60_000), setInterval(() => work().catch(() => {}), 8_000)];
  setTimeout(scout, 15_000);
  return () => timers.forEach(clearInterval);
}
