// AI research desk: coins about to bond on pump.fun and coins that just bonded get researched
// (metadata, website, X account, linked tweets, news, copycats, holders, flow) and graded by Claude
// on how strong the narrative is and how high it could realistically go. All sources are free.
import { db, q, json, logEvent } from "./db.js";
import { settings } from "./settings.js";
import { ask } from "./ai.js";
import { askFast, fastReady as groqReady, fastStatus as groqStatus } from "./fast.js";
import { askGrok, grokInstalled, grokStatus } from "./grok.js";
import { trackGrade, considerCall, playbookPrompt, playbook } from "./brain.js";
const grokDeep = () => settings.deepProvider !== "claude" && grokInstalled();
const deepMin = () => playbook().tuning.deepMinScore ?? settings.deepMinScore;

// Fast lane: Grok on this PC's SuperGrok login (searches X live), Groq as the fallback when a key is set.
const grokOn = () => settings.fastProvider !== "groq" && grokInstalled();
const fastReady = () => grokOn() || groqReady();
const fastStatus = () => {
  const g = grokStatus(), q2 = groqStatus();
  const provider = grokOn() ? "grok" : q2.ready ? "groq" : null;
  const cur = provider === "grok" ? g : q2;
  return { ready: Boolean(provider), provider, search: provider === "grok" && settings.grokSearch, avgMs: cur.avgMs, lastError: cur.lastError,
    limits: provider === "grok" ? g.limits : null, cooling: provider === "grok" ? (g.coolingSecs ? [{ model: "Grok", secs: g.coolingSecs }] : []) : q2.cooling, grok: g, groq: q2 };
};
import { THEMES, themesFor, computeNarratives } from "./narratives.js";

db.exec(`
CREATE TABLE IF NOT EXISTS research (
  mint TEXT PRIMARY KEY, stage TEXT, status TEXT, t INTEGER, queued INTEGER,
  grade TEXT, score INTEGER, ceiling TEXT, verdict TEXT, report TEXT, sources TEXT, error TEXT,
  mcap_at REAL
);
`);
try { db.exec("ALTER TABLE tokens ADD COLUMN uri TEXT"); } catch {}
for (const c of ["tier TEXT", "model TEXT", "ms INTEGER", "fast TEXT"]) try { db.exec(`ALTER TABLE research ADD COLUMN ${c}`); } catch {}

const MIN = 60_000;
const now = () => Date.now();
const GATEWAY = "https://pump.mypinata.cloud/ipfs/";
export const ipfs = (u) => u ? String(u).replace(/^https?:\/\/[^/]+\/ipfs\//, GATEWAY).replace(/^ipfs:\/\//, GATEWAY) : u;

// ---------- bonding progress ----------
// pump.fun coins bond at roughly 440 SOL of market cap; learn the real figure from coins we saw graduate.
let solUsd = 120;
export function setSolPrice(v) { if (v > 0) solUsd = v; }
// Cached: it scans snapshots, and bondingProgress() calls it once per coin.
let gradCache = { t: 0, v: 0 };
function gradMcapUsd() {
  if (Date.now() - gradCache.t < 5 * MIN && gradCache.v) return gradCache.v;
  gradCache = { t: Date.now(), v: computeGradMcap() };
  return gradCache.v;
}
function computeGradMcap() {
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
    .map((t) => ({ ...t, progress: bondingProgress(t) })).filter((t) => t.progress >= 0.6 && t.progress < 0.995).sort((a, b) => b.progress - a.progress);
  const bonded = db.prepare(`SELECT * FROM tokens WHERE status = 'active' AND graduated = 1 AND pair IS NOT NULL
    AND COALESCE(pair_created, first_seen) > ? ORDER BY COALESCE(pair_created, first_seen) DESC LIMIT 80`).all(now() - 3 * 60 * MIN);
  return { near, bonded };
}

// ---------- gathering ----------
async function getText(url, ms = 7000) {
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

export async function gather(t, stage) {
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
      bondingProgressPct: stage === "bonded" ? 100 : Math.round((bondingProgress(t) || 0) * 100),
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
"narrative":{"summary":"what the meme is, 1-2 sentences","theme":"one of: THEME_LIST","tag":"2-4 word name for the specific narrative, e.g. 'Trump tariff joke'","strength":0-10,"timeliness":0-10,"originality":0-10,"reach":0-10},
"catalyst":"the live catalyst, or 'none found'",
"ceiling":{"tier":"<$250k|$250k-$1M|$1M-$10M|$10M-$100M|$100M+","why":"1-2 sentences"},
"bull":["..."],"bear":["..."],"redFlags":["..."],"confidence":"low|medium|high"}`;

const SYSTEM_FULL = SYSTEM.replace("THEME_LIST", [...THEMES.map(([n]) => n), "Viral moment", "Other"].join(" | "));
// Grok can search X itself, so it also reports what X is actually saying about the coin.
const SYSTEM_GROK = SYSTEM_FULL.replace("Reply with ONLY a JSON object", `Before grading, use x_search to look the coin up on X by its contract address (mint) and by $TICKER: posts from the last 24 hours, who is posting (follower counts, known traders/KOLs), real engagement, and whether it is spreading organically or only bots, raid groups and "AI signal" accounts are posting it. If the narrative is tied to a news story, person or trend, use web or X search to confirm that story is real and current. Count what you found as evidence in the grade.
Add to the JSON: "xBuzz":{"summary":"what X is saying, 1-2 sentences","sentiment":"bullish|mixed|bearish|none","organic":"organic|mixed|botted|none","notable":["@handle (followers) - what they said"],"posts":[{"handle":"","text":"short quote","url":"https://x.com/..."}]} with up to 4 real posts you actually found (never invent posts or URLs; empty list if none).

Reply with ONLY a JSON object`);
// The deep read: Grok's smartest model, more searching, and a trade decision with an exit plan.
const DEEP_EXTRA = `This is the DEEP read on a coin that passed the first screen. Dig further than a quick read: check the coin's own X account history and whether it is real, whether accounts with real followings (not bots, raid groups or paid "signal" accounts) are posting it, whether the story behind it is spreading beyond crypto, what the first-pass read may have missed, and how earlier coins on the same narrative did.
Then decide whether to buy RIGHT NOW at the current market cap. Only say "buy" when the narrative is genuinely strong and early enough that a 2x+ is realistic from here; otherwise "watch" (good but wrong entry/timing) or "avoid".
Add to the JSON: "trade":{"action":"buy|watch|avoid","conviction":0-100,"entry":"when/where to enter, e.g. 'now, under $90k' or 'wait for a dip to $60k'","maxEntryMcap":number_in_usd,
"takeProfits":[{"atMultiple":2,"sellPct":40},{"atMultiple":5,"sellPct":40}],"trailingStopPct":number_or_null,"stopLossPct":number,"timeStopHours":number,"why":"the case for this trade in 1-2 sentences"}

Reply with ONLY a JSON object`;
const SYSTEM_DEEP_GROK = () => SYSTEM_GROK.replace("Reply with ONLY a JSON object", DEEP_EXTRA) + playbookPrompt();
const SYSTEM_DEEP_CLAUDE = () => SYSTEM_FULL.replace("Reply with ONLY a JSON object", DEEP_EXTRA) + playbookPrompt();
const GRADES = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D", "F"];

function parse(text) {
  const r = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0]);
  r.grade = String(r.grade || "").trim().toUpperCase();
  if (!GRADES.includes(r.grade)) throw new Error(`bad grade ${r.grade}`);
  r.score = Math.max(0, Math.min(100, Math.round(Number(r.score) || 0)));
  return r;
}

// Groq: the fast first read. Smaller payload so it stays quick and inside the free quota.
function slim(data) {
  const d = structuredClone(data);
  if (d.socials?.website?.text) d.socials.website.text = d.socials.website.text.slice(0, 700);
  if (d.news) d.news = d.news.slice(0, 4);
  return d;
}
export async function gradeFast(data) {
  if (grokOn()) {
    try {
      const search = settings.grokSearch;
      const { text, model, ms, searches } = await askGrok((search ? SYSTEM_GROK : SYSTEM_FULL) + playbookPrompt(), `Research (JSON):\n${JSON.stringify(slim(data))}`,
        { model: settings.grokModel, search, maxTokens: search ? 2500 : 1200 });
      return { ...parse(text), model, ms, searches, tier: "fast" };
    } catch (e) {
      if (!groqReady()) throw e;
    }
  }
  const { text, model, ms } = await askFast(SYSTEM_FULL, `Research (JSON):\n${JSON.stringify(slim(data))}`, 900);
  return { ...parse(text), model, ms, tier: "fast" };
}
// Claude: the slower, deeper second opinion for coins the fast read liked (or everything, without a Groq key).
async function gradeDeep(data, fast) {
  const extra = fast ? `\n\nA fast first-pass model graded it ${fast.grade} (${fast.score}): "${fast.verdict}". Check that read against the data; disagree if it is wrong.${fast.xBuzz ? `\nIt also searched X live and found (JSON): ${JSON.stringify(fast.xBuzz)}` : ""}` : "";
  const prompt = `Research (JSON):\n${JSON.stringify(data)}${extra}`;
  if (grokDeep()) {
    try {
      const { text, model, ms, searches } = await askGrok(SYSTEM_DEEP_GROK(), prompt,
        { model: settings.deepModel, search: true, maxSearches: settings.deepSearches, effort: "high", maxTokens: 5000, timeout: 300_000 });
      return { ...parse(text), model, ms, searches, tier: "deep" };
    } catch (e) {
      if (settings.deepProvider === "grok") throw e;
    }
  }
  const t0 = Date.now();
  const { text, model } = await ask(SYSTEM_DEEP_CLAUDE(), prompt, 1600);
  return { ...parse(text), model, ms: Date.now() - t0, tier: "deep" };
}

// ---------- queue ----------
// status: queued (needs a first read) -> done, or deep (fast read liked it, waiting for Claude) -> done
let raiseFn = null;
const running = new Set();
const fastHour = [], deepHour = [];
const inHour = (list) => { while (list.length && list[0] < now() - 60 * MIN) list.shift(); return list.length; };
const FAST_WORKERS = 4;

export function enqueue(mint, stage, priority = 0) {
  const cur = db.prepare("SELECT * FROM research WHERE mint = ?").get(mint);
  if (cur && ["queued", "running", "deep"].includes(cur.status)) return;
  if (cur && cur.stage === stage && cur.status === "done") return;
  db.prepare(`INSERT INTO research (mint, stage, status, queued) VALUES (?, ?, 'queued', ?)
    ON CONFLICT(mint) DO UPDATE SET stage = excluded.stage, status = 'queued', queued = excluded.queued, error = NULL, fast = NULL, tier = NULL`).run(mint, stage, now() - priority);
}

function save(mint, t, r, data, status = "done") {
  db.prepare(`UPDATE research SET status = ?, t = ?, grade = ?, score = ?, ceiling = ?, verdict = ?, report = ?, sources = ?, mcap_at = ?,
    tier = ?, model = ?, ms = ?, error = NULL WHERE mint = ?`)
    .run(status, now(), r.grade, r.score, r.ceiling?.tier || null, r.verdict, JSON.stringify(r), JSON.stringify(data), t.mcap, r.tier, r.model, r.ms, mint);
}

function alertIfStrong(t, stage, r) {
  if (!["A+", "A", "A-"].includes(r.grade) || !raiseFn) return;
  const last = q.lastSignal.get(t.mint, "research");
  if (last && now() - last.t < 6 * 60 * MIN) return;
  const who = r.tier === "fast" ? "Fast read" : "Deep read";
  raiseFn(t, "research", `${who}: $${t.symbol} ${r.grade}${stage === "near" ? " before bonding" : stage === "new" ? " on a fresh launch" : " after bonding"}`,
    `${r.verdict} Ceiling ${r.ceiling?.tier || "?"}. ${r.narrative?.summary || ""}`.slice(0, 400));
}

function fail(job, t, e) {
  // One automatic retry a minute later (a flaky site or a malformed answer usually clears up).
  if (!String(job.error || "").startsWith("retry:")) {
    db.prepare("UPDATE research SET status = ?, queued = ?, error = ? WHERE mint = ?").run(job.status, now() + 60_000, `retry: ${String(e.message).slice(0, 280)}`, job.mint);
    return;
  }
  db.prepare("UPDATE research SET status = 'error', t = ?, error = ? WHERE mint = ?").run(now(), String(e.message).slice(0, 300).replace(/^retry: /, ""), job.mint);
  logEvent("error", `research $${t?.symbol}: ${e.message}`);
}

const nextJob = (status) => db.prepare(`SELECT * FROM research WHERE status = ? AND queued <= ? ${quotaLow() ? "AND stage != 'new'" : ""} ${running.size ? `AND mint NOT IN (${[...running].map(() => "?").join(",")})` : ""}
  ORDER BY queued ASC LIMIT 1`).get(status, now(), ...running);

async function runFast(job) {
  const t = q.getToken.get(job.mint);
  if (!t) { db.prepare("DELETE FROM research WHERE mint = ?").run(job.mint); return; }
  fastHour.push(now());
  db.prepare("UPDATE research SET status = 'running' WHERE mint = ?").run(job.mint);
  try {
    const data = await gather(t, job.stage);
    const r = await gradeFast(data);
    const wantsDeep = r.score >= deepMin();
    save(job.mint, t, r, data, wantsDeep ? "deep" : "done");
    trackGrade(t, r, job.stage);
    if (wantsDeep) db.prepare("UPDATE research SET fast = ?, queued = ? WHERE mint = ?").run(JSON.stringify(r), now() - r.score * 1000, job.mint);
    logEvent("research", `$${t.symbol} fast ${r.grade} in ${r.ms}ms (${r.model.split("/").pop()}): ${r.verdict}`);
    alertIfStrong(t, job.stage, r);
  } catch (e) { fail({ ...job, status: "queued" }, t, e); }
}

async function runDeep(job) {
  const t = q.getToken.get(job.mint);
  if (!t) { db.prepare("DELETE FROM research WHERE mint = ?").run(job.mint); return; }
  deepHour.push(now());
  const fast = json(job.fast);
  db.prepare("UPDATE research SET status = 'running' WHERE mint = ?").run(job.mint);
  try {
    // Fast read just gathered the sources; refresh them only if they're getting old.
    const data = fast && job.t > now() - 10 * MIN ? json(job.sources) : await gather(t, job.stage);
    const r = await gradeDeep(data, fast);
    if (fast) { r.fast = { grade: fast.grade, score: fast.score, verdict: fast.verdict, model: fast.model, ms: fast.ms }; r.xBuzz ||= fast.xBuzz; }
    save(job.mint, t, r, data);
    trackGrade(t, r, job.stage);
    considerCall(t, r, job.stage);
    logEvent("research", `$${t.symbol} ${fast ? `deep ${r.grade} (fast said ${fast.grade})` : `graded ${r.grade}`}: ${r.verdict}`);
    if (!fast || !["A+", "A", "A-"].includes(fast.grade)) alertIfStrong(t, job.stage, r);
  } catch (e) {
    // Claude failed or is out of quota: keep the fast read rather than losing the coin.
    if (fast && String(job.error || "").startsWith("retry:")) {
      db.prepare("UPDATE research SET status = 'done', error = ? WHERE mint = ?").run(`deep read failed: ${String(e.message).slice(0, 200)}`, job.mint);
      return;
    }
    fail({ ...job, status: fast ? "deep" : "queued" }, t, e);
  }
}

function pump() {
  // Fast lane: several Groq reads in parallel (gathering is the slow part, the model answers in ~1s).
  if (fastReady()) {
    while (running.size < FAST_WORKERS && inHour(fastHour) < settings.fastPerHour) {
      const job = nextJob("queued");
      if (!job) break;
      running.add(job.mint);
      runFast(job).finally(() => running.delete(job.mint));
    }
  }
  // Deep lane: Grok (2 at a time) or Claude (1 at a time), capped per hour.
  const slots = grokDeep() ? 2 : 1, cap = grokDeep() ? settings.deepPerHour : settings.researchPerHour;
  for (let i = 0; i < slots; i++) {
    const slot = `__deep${i}`;
    if (running.has(slot) || inHour(deepHour) >= cap) continue;
    const job = nextJob("deep") || (!fastReady() ? nextJob("queued") : null);
    if (!job) break;
    running.add(slot); running.add(job.mint);
    runDeep(job).finally(() => { running.delete(slot); running.delete(job.mint); });
  }
}

// Pick up new candidates. With the fast lane on, rate every coin close to bonding or freshly bonded;
// without it, only the strongest (Claude's hourly budget is small).
function scout() {
  if (!settings.researchAuto) return;
  const fast = fastReady();
  const { near, bonded } = candidates();
  for (const t of near) {
    if (t.progress < (fast ? 0.6 : 0.8) || (t.vol_h1 || 0) < (fast ? 3000 : 8000) || json(t.safety)?.danger > 0) continue;
    enqueue(t.mint, "near", Math.round(t.progress * 100) * 1000);
  }
  for (const t of bonded) {
    if ((t.mcap || 0) < (fast ? 25000 : 35000) || (t.vol_h1 || 0) < (fast ? 5000 : 15000) || json(t.safety)?.danger > 0) continue;
    enqueue(t.mint, "bonded", Math.round((t.vol_h1 || 0) / 1000));
  }
  // Fast lane only: young coins that survived their first minutes with real trading get a first read too.
  if (fast && !quotaLow()) {
    const young = db.prepare(`SELECT * FROM tokens WHERE status = 'active' AND dex = 'pumpfun' AND graduated = 0 AND first_seen > ? AND mcap >= 15000 AND vol_h1 >= 4000
      ORDER BY vol_h1 DESC LIMIT 25`).all(now() - 30 * MIN);
    for (const t of young) {
      if (json(t.safety)?.danger > 0 || (bondingProgress(t) || 0) >= 0.6) continue;
      if (db.prepare("SELECT 1 FROM research WHERE mint = ?").get(t.mint)) continue;
      enqueue(t.mint, "new", Math.round((t.vol_h1 || 0) / 2000));
    }
  }
}

// Grok's rate-limit headers: when under 15% of requests are left, skip reads on brand-new coins.
function quotaLow() {
  const l = grokStatus().limits;
  return Boolean(l?.requestsLimit && l.requestsLeft < l.requestsLimit * 0.15);
}

export function researchFor(mint) {
  const r = db.prepare("SELECT * FROM research WHERE mint = ?").get(mint);
  return r && { ...r, report: json(r.report), sources: json(r.sources) };
}

export function desk() {
  const { near, bonded } = candidates();
  const attach = (t) => {
    const r = db.prepare("SELECT status, grade, score, ceiling, verdict, stage, t, tier, ms FROM research WHERE mint = ?").get(t.mint);
    return { mint: t.mint, symbol: t.symbol, name: t.name, image: t.image, mcap: t.mcap, vol_h1: t.vol_h1, chg_h1: t.chg_h1, buys_h1: t.buys_h1, sells_h1: t.sells_h1,
      safety_score: t.safety_score, progress: t.progress ?? null, bonded_at: t.pair_created || t.first_seen, research: r || null, themes: json(t.themes, []) };
  };
  const graded = db.prepare(`SELECT r.mint, r.grade, r.score, r.ceiling, r.verdict, r.stage, r.t, r.mcap_at, r.tier, r.ms, r.model, r.status, r.report,
    t.symbol, t.name, t.image, t.mcap, t.chg_h1, t.peak_mcap, t.themes, t.description
    FROM research r JOIN tokens t ON t.mint = r.mint WHERE r.status IN ('done', 'deep') AND r.t > ? ORDER BY r.score DESC`).all(now() - 12 * 60 * MIN);
  const top = graded.slice(0, 12).map(({ report, themes, description, ...r }) => ({ ...r, summary: json(report)?.narrative?.summary || null, tag: json(report)?.narrative?.tag || null, fast: json(report)?.fast || null }));
  // Narratives ranked by what the AI thought of the coins carrying them.
  const byTheme = new Map();
  for (const g of graded) {
    const ai = json(g.report)?.narrative?.theme;
    const themes = ai && ai !== "Other" ? [ai] : (json(g.themes, null) || themesFor(g));
    for (const th of themes.length ? themes : ["Other"]) {
      const e = byTheme.get(th) || { theme: th, coins: 0, total: 0, best: null, strong: 0 };
      e.coins++; e.total += g.score;
      if (g.score >= 70) e.strong++;
      if (!e.best || g.score > e.best.score) e.best = { mint: g.mint, symbol: g.symbol, image: g.image, grade: g.grade, score: g.score };
      byTheme.set(th, e);
    }
  }
  const narratives = [...byTheme.values()].filter((e) => e.theme !== "Other" || byTheme.size === 1).map((e) => ({ ...e, avg: Math.round(e.total / e.coins), rank: Math.round(e.total / e.coins) + Math.min(15, e.strong * 5) }))
    .sort((a, b) => b.rank - a.rank).slice(0, 10);
  const stats = db.prepare("SELECT status, COUNT(*) n FROM research GROUP BY status").all();
  const hour = { fast: inHour(fastHour), deep: inHour(deepHour) };
  return { near: near.slice(0, 30).map(attach), bonded: bonded.slice(0, 30).map(attach), top, narratives, stats, hour,
    perHour: grokDeep() ? settings.deepPerHour : settings.researchPerHour, deepProvider: grokDeep() ? "grok" : "claude", deepMin: deepMin(), fastPerHour: settings.fastPerHour, auto: settings.researchAuto, fast: fastStatus() };
}

export function startResearch(raise) {
  raiseFn = raise;
  // Jobs that were mid-read when the radar stopped go back in the queue.
  db.prepare("UPDATE research SET status = CASE WHEN fast IS NOT NULL THEN 'deep' ELSE 'queued' END WHERE status = 'running'").run();
  const timers = [setInterval(scout, 20_000), setInterval(pump, 2_000)];
  setTimeout(scout, 15_000);
  return () => timers.forEach(clearInterval);
}
