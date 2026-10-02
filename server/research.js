// AI research desk: coins about to bond on pump.fun and coins that just bonded get researched
// (metadata, website, X account, linked tweets, news, copycats, holders, flow) and graded by Claude
// on how strong the narrative is and how high it could realistically go. All sources are free.
import { db, q, json, logEvent } from "./db.js";
import { settings } from "./settings.js";
import { ask, extractJson, claudeStatus, FAST_MODEL } from "./ai.js";
import { askFast, fastReady as groqReady, fastStatus as groqStatus } from "./fast.js";
import { askGrok, grokInstalled, grokStatus, grokBlocked } from "./grok.js";
import { trackGrade, considerCall, considerPick, playbookPrompt, playbook, evidence } from "./brain.js";
import { liveStats, live } from "./livetrades.js";
import { triageFor } from "./triage.js";
import { earlyFor } from "./early.js";
import { verdict, vet } from "./engine.js";
import { safeUrl, publicUrl, traction, tractionOfSources } from "./quality.js";
const grokDeep = () => settings.deepProvider !== "claude" && grokInstalled() && !grokBlocked();
const deepMin = () => playbook().tuning.deepMinScore ?? settings.deepMinScore;

// Fast lane: Grok on this PC's SuperGrok login (searches X live), Groq as the fallback when a key is set.
const grokOn = () => settings.fastProvider !== "groq" && settings.fastProvider !== "claude" && grokInstalled() && !grokBlocked();
// Last resort for speed: Claude Haiku on this PC's Claude login. No live X search, but a read takes seconds.
const claudeFast = () => settings.claudeFast && claudeStatus().ready;
const fastReady = () => grokOn() || groqReady() || claudeFast();
const fastStatus = () => {
  const g = grokStatus(), q2 = groqStatus();
  const provider = grokOn() ? "grok" : q2.ready ? "groq" : claudeFast() ? "claude" : null;
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
// enq_t: when the coin really joined the queue (`queued` is a sort key: now minus priority).
for (const c of ["tier TEXT", "model TEXT", "ms INTEGER", "fast TEXT", "enq_t INTEGER", "reads INTEGER DEFAULT 1", "enq_mcap REAL"]) try { db.exec(`ALTER TABLE research ADD COLUMN ${c}`); } catch {}

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

// Real memecoins with a believable price only.
const MEME = "quarantine IS NULL AND COALESCE(asset_class, 'meme') = 'meme'";
export function candidates() {
  const near = db.prepare(`SELECT * FROM tokens WHERE status = 'active' AND dex = 'pumpfun' AND pair IS NOT NULL AND ${MEME} ORDER BY mcap DESC LIMIT 200`).all()
    .map((t) => ({ ...t, progress: bondingProgress(t) })).filter((t) => t.progress >= 0.6 && t.progress < 0.995).sort((a, b) => b.progress - a.progress);
  const bonded = db.prepare(`SELECT * FROM tokens WHERE status = 'active' AND graduated = 1 AND pair IS NOT NULL AND ${MEME}
    AND COALESCE(pair_created, first_seen) > ? ORDER BY COALESCE(pair_created, first_seen) DESC LIMIT 80`).all(now() - 3 * 60 * MIN);
  return { near, bonded };
}

// ---------- gathering ----------
async function getText(target, ms = 7000) {
  // Coin websites and metadata links come from whoever launched the coin: public web addresses only.
  const url = publicUrl(target);
  if (!url) throw new Error("link not allowed");
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
    return { user: u.screen_name, url: `https://x.com/${u.screen_name}`, name: u.name, followers: u.followers, following: u.following, tweets: u.tweets, joined: u.joined, description: u.description?.slice(0, 280), avatar: safeUrl(u.avatar_url), verified: u.verification?.verified || false };
  } catch (e) { return { user, error: e.message }; }
}

async function xStatus(user, id) {
  try {
    const d = await getJson(`https://api.fxtwitter.com/${user}/status/${id}`);
    const tw = d.tweet;
    if (!tw) return null;
    return { url: `https://x.com/${user}/status/${id}`, author: tw.author?.screen_name, authorFollowers: tw.author?.followers, text: tw.text?.slice(0, 500), likes: tw.likes, retweets: tw.retweets, views: tw.views, created: tw.created_at };
  } catch { return null; }
}

async function news(term) {
  if (!term || term.length < 3) return [];
  try {
    const xml = await getText(`https://news.google.com/rss/search?q=${encodeURIComponent(`"${term}"`)}+when:7d&hl=en-US&gl=US&ceid=US:en`);
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 6).map((m) => {
      const tag = (n) => (m[1].match(new RegExp(`<${n}>([\\s\\S]*?)</${n}>`))?.[1] || "").replace(/<!\[CDATA\[|\]\]>/g, "").trim();
      return { title: tag("title"), date: tag("pubDate"), url: safeUrl(tag("link")) };
    }).filter((n) => n.title);
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
  const xUrl = safeUrl(meta?.twitter) || links.find((l) => /twitter|x\.com/i.test(`${l.type} ${l.url}`))?.url;
  const site = safeUrl(meta?.website) || links.find((l) => l.type === "website")?.url;
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
  const data = {
    stage, ticker: t.symbol, name: t.name, mint: t.mint, gatheredAt: new Date().toISOString(),
    liveTrading: (() => { const x = liveStats(t.mint); return x ? { mcapUsd: Math.round(x.mc), athUsd: Math.round(x.ath), buys: x.buys, sells: x.sells, uniqueTraders: x.traders, volumeUsd: Math.round(x.vol), change1mPct: x.chg1m && +x.chg1m.toFixed(1) } : null; })(),
    firstTriage: (() => { const x = triageFor(t.mint); return x?.model ? { label: x.label, score: x.score, why: x.why } : null; })(),
    description: meta?.description || t.description || null,
    market: {
      mcap: Math.round(t.mcap || liveStats(t.mint)?.mc || 0), peakMcap: Math.round(t.peak_mcap || 0), liquidity: Math.round(t.liquidity || 0),
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
  // Live demand, scored the same way for every coin, with how each band has actually done on this radar.
  const tr = tractionOfSources(data), ev = evidence(), el = earlyFor(t.mint);
  // The launch model's read of its first minutes, when it has one (it is tested on launches it never saw).
  if (el) data.earlySignal = { chanceOf2xPct: Math.round(el.p * 100), rank: el.top ? "top 5% of launches" : el.strong ? "top 10% of launches" : "ordinary", atSeconds: el.cp };
  data.traction = { score: tr.score, helping: tr.up, hurting: tr.down,
    measured: ev.traction.reduce((n, b) => n + b.n, 0) >= 60 ? ev.traction.filter((b) => b.n >= 8).map((b) => `traction ${b.label}: ${b.n} past coins, ${b.winPct}% won, average result ${b.avg}x`) : "not enough past results yet" };
  return data;
}

// The same score for any tracked coin from what is known this second: the live ranking on the dashboard.
export function liveTraction(t) {
  const x = !t.graduated ? liveStats(t.mint) : null, s = json(t.safety) || {};
  const fresh = x && now() - x.last < 15 * MIN;
  const mcap = (fresh ? x.mc : 0) || t.mcap || 0, prog = t.graduated ? 1 : (fresh ? x.progress : bondingProgress(t)) ?? 0;
  const ath = Math.max(t.peak_mcap || 0, fresh ? x.ath : 0);
  return traction({ stage: t.graduated ? "bonded" : prog >= 0.6 ? "near" : "new", mcap, vol5m: Math.round(t.vol_m5 || 0), traders: fresh ? x.traders : undefined, chg1m: fresh ? x.chg1m ?? undefined : undefined,
    chg5m: t.chg_m5 ?? undefined, chg1h: t.chg_h1 ?? undefined, holders: s.totalHolders ?? undefined, offAth: ath > 0 && mcap > 0 ? Math.min(1, mcap / ath) : undefined });
}

// ---------- grading ----------
// The read is a trade decision, reasoned step by step. It used to be a narrative grade; measured against
// what the coins did next, that grade had no link to winning trades, while live demand did.
const SYSTEM = `You are the analyst for a trader who buys Solana memecoins around pump.fun bonding and sells by one fixed rule: half at 2x, the rest on a 35% trailing stop, everything out at -40%.
A WIN is a coin that reaches 2x from its current price before it falls 40%. Roughly 1 coin in 5 that gets this far is a win. Most fall.
You get research gathered seconds ago about one coin. It includes "traction": a 0-100 score of live demand, what is helping and hurting it, and base rates measured on this radar's own past reads.

Work through these steps IN ORDER and write each one down briefly in "thinking" BEFORE you decide anything:
1. what - what this coin is in plain words, and who would want it.
2. demand - is real money arriving right now? Use traction, unique traders, buys against sells, the 1-minute and 5-minute change, volume against market cap. Quote the numbers.
3. buyersLeft - who is left to buy at this market cap, and who is sitting on profit ready to sell into them? Use age, distance below its high, how far it already ran this hour, holder count, top-10, dev and insider share.
4. edge - a specific reason strangers will find this coin in the next 30 minutes (a live catalyst, a large account, being the original of a meme that is spreading), or is it one of many copies? Use copycats, the linked tweet's real engagement, news, theme heat, followed wallets.
5. kill - the single most likely way this trade loses.

Rules for the decision:
- Measured on this radar: narrative quality alone has NOT predicted winners. Live demand has. A great meme with no buyers is not a buy.
- Strong demand with a weak meme can still be a short trade. Say so plainly instead of dismissing it.
- Already up more than about 130% this hour, or 40%+ below its high, or above $250k market cap: the easy move is usually gone. It needs an exceptional, specific reason.
- Under about $15k market cap with few traders: too early to tell. That is "watch", not "buy".
- Unknown is unknown. Never invent facts that are not in the data. A coin minutes old with no socials yet is normal, not a red flag by itself.
- Be calibrated. trade.pWin is your honest probability (0-100) of a WIN as defined above. Most coins belong between 5 and 35. Go above 50 only with strong demand AND a real edge. If your past numbers are in the playbook, correct for them.
- trade.action: "buy" = enter now. "watch" = decent but the entry or timing is not there. "avoid" = do not trade it. These coins cannot be shorted: never suggest it.
- Quote the measured base rates exactly as given ("won" and "average result"); do not rename them.
- grade and score describe the NARRATIVE only (meme strength, timeliness, originality, reach). Most coins are C or worse. They are shown to the user but do not decide the trade.

Reply with ONLY a JSON object, no prose around it, keys in this order:
{"thinking":{"what":"1 sentence","demand":"1-2 sentences with the numbers","buyersLeft":"1-2 sentences","edge":"1-2 sentences","kill":"1 sentence"},
"trade":{"action":"buy|watch|avoid","pWin":0-100,"why":"the case for or against this trade, 1-2 sentences"},
"grade":"A+|A|A-|B+|B|B-|C+|C|C-|D|F","score":0-100,"verdict":"one punchy sentence that says what to do and why",
"narrative":{"summary":"what the meme is, 1-2 sentences","theme":"one of: THEME_LIST","tag":"2-4 word name for the specific narrative, e.g. 'Trump tariff joke'","strength":0-10,"timeliness":0-10,"originality":0-10,"reach":0-10},
"catalyst":"the live catalyst, or 'none found'",
"evidence":[{"claim":"one factual claim your decision rests on","source":"where it comes from: a URL you were given or found, or the name of the data field (e.g. socials.linkedTweet, traction, holders)"}],
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
In this deep read the "trade" object is fuller. Use: "trade":{"action":"buy|watch|avoid","pWin":0-100,"conviction":0-100,"entry":"when/where to enter, e.g. 'now, under $90k' or 'wait for a dip to $60k'","maxEntryMcap":number_in_usd,
"takeProfits":[{"atMultiple":2,"sellPct":40},{"atMultiple":5,"sellPct":40}],"trailingStopPct":number_or_null,"stopLossPct":number,"timeStopHours":number,"why":"the case for this trade in 1-2 sentences"}

Reply with ONLY a JSON object`;
const SYSTEM_DEEP_GROK = () => SYSTEM_GROK.replace("Reply with ONLY a JSON object", DEEP_EXTRA) + playbookPrompt();
const SYSTEM_DEEP_CLAUDE = () => SYSTEM_FULL.replace("Reply with ONLY a JSON object", DEEP_EXTRA) + playbookPrompt();
const GRADES = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D", "F"];

export function parse(text) {
  const r = extractJson(text);
  // Models sometimes invent grades off the scale (D+, D-, E, F+): fold them onto it.
  let g = String(r.grade || "").trim().toUpperCase().replace(/\s+/g, "");
  if (/^D[+-]$/.test(g)) g = "D"; else if (/^(E|F[+-]?)$/.test(g)) g = "F";
  if (!GRADES.includes(g)) throw new Error(`the model returned an unusable grade "${String(r.grade).slice(0, 12)}"`);
  r.grade = g;
  r.score = Math.max(0, Math.min(100, Math.round(Number(r.score) || 0)));
  // The trade call: only the three known answers, and a chance between 0 and 100.
  if (r.trade && typeof r.trade === "object") {
    const a = String(r.trade.action || "").trim().toLowerCase();
    r.trade.action = ["buy", "watch", "avoid"].includes(a) ? a : null;
    r.trade.pWin = r.trade.pWin == null || !Number.isFinite(Number(r.trade.pWin)) ? null : Math.max(0, Math.min(100, Math.round(Number(r.trade.pWin))));
  } else delete r.trade;
  // Only real web links survive as evidence or post links.
  if (Array.isArray(r.evidence)) r.evidence = r.evidence.filter((e) => e?.claim).slice(0, 8).map((e) => ({ claim: String(e.claim).slice(0, 300), source: String(e.source || "").slice(0, 300), url: safeUrl(String(e.source || "").match(/https?:\/\/\S+/)?.[0]) }));
  if (r.xBuzz?.posts) r.xBuzz.posts = r.xBuzz.posts.filter(Boolean).slice(0, 6).map((p) => ({ ...p, url: /^https:\/\/(x|twitter)\.com\//.test(safeUrl(p.url) || "") ? safeUrl(p.url) : null }));
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
        { model: settings.grokModel, search, maxTokens: search ? 3000 : 1700 });
      return { ...parse(text), model, ms, searches, tier: "fast" };
    } catch (e) {
      if (!groqReady() && !claudeFast()) throw e;
    }
  }
  if (groqReady()) {
    try {
      const { text, model, ms } = await askFast(SYSTEM_FULL + playbookPrompt(), `Research (JSON):\n${JSON.stringify(slim(data))}`, 1400);
      return { ...parse(text), model, ms, tier: "fast" };
    } catch (e) {
      if (!claudeFast()) throw e;
    }
  }
  if (!claudeFast()) throw Object.assign(new Error("No fast AI is available right now"), { busy: true });
  const t0 = Date.now();
  const { text, model, truncated } = await ask(SYSTEM_FULL + playbookPrompt(), `Research (JSON):\n${JSON.stringify(slim(data))}`, 1600, { model: FAST_MODEL });
  if (truncated) throw new Error("the answer was cut off");
  return { ...parse(text), model, ms: Date.now() - t0, tier: "fast", searched: false };
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
      // Out of credits or rate limited: Claude takes the read. Any other failure is reported as it is.
      if (!e.blocked && !e.busy) throw e;
    }
  }
  const t0 = Date.now();
  const { text, model, truncated } = await ask(SYSTEM_DEEP_CLAUDE(), prompt, 3000);
  if (truncated) throw new Error("the answer was cut off");
  // Claude has no live search here: it judged only the sources the radar gathered.
  return { ...parse(text), model, ms: Date.now() - t0, tier: "deep", searched: false };
}

// ---------- queue ----------
// status: queued (needs a first read) -> done, or deep (fast read liked it, waiting for Claude) -> done
let raiseFn = null;
const running = new Set();
const fastHour = [], deepHour = [];
const inHour = (list) => { while (list.length && list[0] < now() - 60 * MIN) list.shift(); return list.length; };
const FAST_WORKERS = 6;

// A read is only useful while the coin is still in the state that made it interesting.
const TTL = { new: 25 * MIN, near: 45 * MIN, bonded: 3 * 60 * MIN };
const MANUAL = 9e11;                                   // priorities at or above this are reads you asked for
const isManual = (job) => now() - job.queued >= MANUAL;
const expired = { hour: [] };

// Reads per hour the radar can actually do right now, with whichever AI is available.
const capacity = () => (fastReady() ? settings.fastPerHour : grokDeep() ? settings.deepPerHour : settings.researchPerHour);
// Never queue more than about 90 minutes of work: anything behind that would be stale when it was read.
const queueCap = () => Math.max(8, Math.min(settings.queueMax, Math.round(capacity() * 1.5)));

export function enqueue(mint, stage, priority = 0) {
  const cur = db.prepare("SELECT * FROM research WHERE mint = ?").get(mint);
  if (cur && ["queued", "running", "deep"].includes(cur.status)) return;
  if (cur && cur.stage === stage && cur.status === "done") return;
  if (priority < MANUAL) {
    // Recently dropped as stale or outranked: don't bounce it straight back in.
    if (cur?.status === "expired" && cur.stage === stage && now() - cur.t < 20 * MIN) return;
    // Without a fast AI, brand-new launches only get a slot when the queue is nearly empty.
    if (stage === "new" && !fastReady() && queueSize() >= queueCap() / 2) return;
  }
  // The market cap when it was first noticed is kept: it is how "did the radar have it early?" gets answered.
  const x = liveStats(mint), mc = (x && now() - x.last < 15 * MIN ? x.mc : 0) || db.prepare("SELECT mcap FROM tokens WHERE mint = ?").get(mint)?.mcap || null;
  db.prepare(`INSERT INTO research (mint, stage, status, queued, enq_t, enq_mcap) VALUES (?, ?, 'queued', ?, ?, ?)
    ON CONFLICT(mint) DO UPDATE SET stage = excluded.stage, status = 'queued', queued = excluded.queued, enq_t = excluded.enq_t, error = NULL, fast = NULL, tier = NULL`).run(mint, stage, now() - priority, now(), mc);
}
const queueSize = () => db.prepare("SELECT COUNT(*) n FROM research WHERE status = 'queued'").get().n;

// How much a waiting coin deserves the next read, from what it is doing right now (not when it was queued).
function rank(job, t) {
  if (isManual(job)) return 1e9;
  const x = liveStats(job.mint);
  const vol = Math.max(t.vol_h1 || 0, x?.vol || 0);
  let s = Math.log10(vol + 1) * 12 + Math.min(30, (x?.traders || 0) / 4) + Math.max(-15, Math.min(25, (t.chg_h1 || 0) / 8));
  if (job.stage === "near") s += (bondingProgress(t) || 0) * 30;
  if (job.stage === "bonded") s += 12;
  const pr = now() - job.queued;
  if (pr >= 5e11) s += 40;                              // lead coin of a narrative the scout just found
  else if (pr >= 2e11) s += (pr - 2e11) / 1e6 / 3;      // triage score, a third of its weight
  return s - ((now() - (job.enq_t || 0)) / MIN) * 0.6;  // waiting makes it less timely, not more deserving
}

// Keep the queue honest: drop reads that went stale, coins that died, and whatever does not fit capacity.
function trimQueue() {
  const drop = (mint, why) => { db.prepare("UPDATE research SET status = 'expired', t = ?, error = ? WHERE mint = ? AND status = 'queued'").run(now(), why, mint); expired.hour.push(now()); };
  const rows = db.prepare("SELECT r.mint, r.stage, r.queued, r.enq_t, t.status tstatus, t.quarantine, t.asset_class, t.vol_h1, t.chg_h1, t.mcap, t.dex, t.graduated FROM research r LEFT JOIN tokens t ON t.mint = r.mint WHERE r.status = 'queued'").all();
  const keep = [];
  for (const j of rows) {
    if (isManual(j)) { keep.push(j); continue; }
    if (!j.tstatus) drop(j.mint, "the radar stopped tracking this coin");
    else if (j.tstatus === "dead") drop(j.mint, "the coin died before it could be read");
    else if (j.quarantine || (j.asset_class && j.asset_class !== "meme")) drop(j.mint, "not a tradable memecoin");
    else if (!j.enq_t || now() - j.enq_t > (TTL[j.stage] || TTL.near)) drop(j.mint, `waited more than ${Math.round((TTL[j.stage] || TTL.near) / MIN)} minutes; a read that late would be out of date`);
    else keep.push(j);
  }
  const cap = queueCap();
  if (keep.length > cap) {
    const ranked = keep.map((j) => ({ j, s: rank(j, j) })).sort((a, b) => b.s - a.s);
    for (const { j } of ranked.slice(cap)) drop(j.mint, "outranked: more coins were waiting than the AI can read in time");
  }
  // A coin still waiting for its deep read after an hour keeps its fast read and moves on.
  db.prepare("UPDATE research SET status = 'done', error = 'deep read skipped: it waited over an hour' WHERE status = 'deep' AND t < ?").run(now() - 60 * MIN);
  db.prepare("DELETE FROM research WHERE status = 'expired' AND t < ?").run(now() - 24 * 60 * MIN);
}

function save(mint, t, r, data, status = "done") {
  db.prepare(`UPDATE research SET status = ?, t = ?, grade = ?, score = ?, ceiling = ?, verdict = ?, report = ?, sources = ?, mcap_at = ?,
    tier = ?, model = ?, ms = ?, error = NULL WHERE mint = ?`)
    .run(status, now(), r.grade, r.score, r.ceiling?.tier || null, r.verdict, JSON.stringify(r), JSON.stringify(data), t.mcap || liveStats(mint)?.mc || null, r.tier, r.model, r.ms, mint);
}

function alertIfStrong(t, stage, r) {
  if (!["A+", "A", "A-"].includes(r.grade) || !raiseFn) return;
  const last = q.lastSignal.get(t.mint, "research");
  if (last && now() - last.t < 6 * 60 * MIN) return;
  // A strong narrative on a coin that fails safety is still not an approved signal.
  const v = verdict(q.getToken.get(t.mint) || t);
  const who = r.tier === "fast" ? "Fast read" : "Deep read";
  raiseFn(t, "research", `${who}: $${t.symbol} ${r.grade}${stage === "near" ? " before bonding" : stage === "new" ? " on a fresh launch" : " after bonding"}${v.ok ? "" : " (failed safety)"}`,
    `${r.verdict} Ceiling ${r.ceiling?.tier || "?"}. ${r.narrative?.summary || ""}`.slice(0, 400) + (v.ok ? "" : ` Not safety-screened: ${v.reasons.join("; ")}.`),
    0, v.ok ? {} : { safe: false, why: v.reasons.join("; ") });
}

function fail(job, t, e) {
  // The AI being out of credits or rate limited is not the coin's fault: put it back without using its retry.
  if (e.busy || e.blocked) {
    db.prepare("UPDATE research SET status = ?, queued = queued + 60000 WHERE mint = ?").run(job.status, job.mint);
    return;
  }
  // One automatic retry a minute later (a flaky site or a malformed answer usually clears up).
  if (!String(job.error || "").startsWith("retry:")) {
    db.prepare("UPDATE research SET status = ?, queued = ?, error = ? WHERE mint = ?").run(job.status, now() + 60_000, `retry: ${String(e.message).slice(0, 280)}`, job.mint);
    return;
  }
  db.prepare("UPDATE research SET status = 'error', t = ?, error = ? WHERE mint = ?").run(now(), String(e.message).slice(0, 300).replace(/^retry: /, ""), job.mint);
  logEvent("error", `research $${t?.symbol}: ${e.message}`);
}

// Deep reads go best-fast-score first. First reads go to whichever waiting coin is doing the most right now.
function nextJob(status) {
  const rows = db.prepare(`SELECT * FROM research WHERE status = ? AND queued <= ? ${quotaLow() ? "AND stage != 'new'" : ""} ORDER BY queued ASC LIMIT 200`).all(status, now())
    .filter((j) => !running.has(j.mint));
  if (status !== "queued" || rows.length < 2) return rows[0];
  let best = null, top = -Infinity;
  for (const j of rows) { const t = q.getToken.get(j.mint); const s = t ? rank(j, t) : -1e9; if (s > top) { top = s; best = j; } }
  return best;
}

async function runFast(job) {
  const t = q.getToken.get(job.mint);
  if (!t) { db.prepare("DELETE FROM research WHERE mint = ?").run(job.mint); return; }
  fastHour.push(now());
  db.prepare("UPDATE research SET status = 'running' WHERE mint = ?").run(job.mint);
  // The safety check runs alongside the read, so a coin that rates well can be entered without waiting for it.
  if (!t.safety_checked) vet(job.mint).catch(() => {});
  try {
    const data = await gather(t, job.stage);
    const r = await gradeFast(data);
    // A coin seconds old may have no stored price yet: take the live one so its rating is still tracked.
    if (!t.mcap) t.mcap = liveStats(job.mint)?.mc || 0;
    r.traction = data.traction?.score ?? null;
    r.early = earlyFor(job.mint);
    r.stage = job.stage;
    r.live = data.liveTrading ? { traders: data.liveTrading.uniqueTraders, buys: data.liveTrading.buys, sells: data.liveTrading.sells } : null;
    // A second, deeper opinion for anything the first read would trade, or whose narrative stands out.
    const wantsDeep = r.score >= deepMin() || (r.trade?.action && r.trade.action !== "avoid" && (r.traction ?? 0) >= 50);
    save(job.mint, t, r, data, wantsDeep ? "deep" : "done");
    trackGrade(t, r, job.stage);
    considerPick(t, r, job.stage);
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
    r.traction = tractionOfSources(data)?.score ?? null;
    if (fast) { r.fast = { grade: fast.grade, score: fast.score, verdict: fast.verdict, model: fast.model, ms: fast.ms }; r.xBuzz ||= fast.xBuzz; }
    save(job.mint, t, r, data);
    trackGrade(t, r, job.stage);
    considerPick(t, r, job.stage);
    considerCall(t, r, job.stage);
    logEvent("research", `$${t.symbol} ${fast ? `deep ${r.grade} (fast said ${fast.grade})` : `graded ${r.grade}`}: ${r.verdict}`);
    if (!fast || !["A+", "A", "A-"].includes(fast.grade)) alertIfStrong(t, job.stage, r);
  } catch (e) {
    // Claude failed or is out of quota: keep the fast read rather than losing the coin.
    if (!e.busy && !e.blocked && fast && String(job.error || "").startsWith("retry:")) {
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
export const scoutStats = { runs: 0, lastMs: 0, maxMs: 0 };
function scout() {
  const t0 = now();
  try { scoutOnce(); } finally { scoutStats.runs++; scoutStats.lastMs = now() - t0; scoutStats.maxMs = Math.max(scoutStats.maxMs * 0.99, scoutStats.lastMs); }
}
function scoutOnce() {
  trimQueue();
  if (!settings.researchAuto) return;
  const fast = fastReady();
  // Straight from the live trade feed: a coin is queued the second it crosses 60% bonded with real buyers,
  // not at the next stored price refresh (which can be half a minute behind).
  if (fast) {
    for (const [mint, s] of live) {
      if (!(s.progress >= 0.6 && s.progress < 0.995) || now() - s.last > 60_000 || s.traders.size < 20) continue;
      const t = q.getToken.get(mint);
      if (!t || t.status !== "active" || t.quarantine || (t.asset_class && t.asset_class !== "meme") || json(t.safety)?.danger > 0) continue;
      enqueue(mint, "near", Math.round(s.progress * 100) * 1000);
    }
  }
  // A coin read earlier that has since taken off gets a fresh read: the first one judged a different coin.
  if (fast && scoutStats.runs % 5 === 0) {
    for (const r of db.prepare("SELECT mint, mcap_at, COALESCE(reads, 1) reads FROM research WHERE status = 'done' AND t > ? AND t < ?").all(now() - 60 * MIN, now() - 4 * MIN)) {
      if (r.reads >= 3) continue;
      const t = q.getToken.get(r.mint);
      if (!t || t.status !== "active" || t.quarantine || json(t.safety)?.danger > 0) continue;
      const m = (!t.graduated && liveStats(r.mint)?.mc) || t.mcap || 0;
      if (m < settings.pickMinMcap || m > settings.pickMaxMcap || (r.mcap_at > 0 && m < r.mcap_at * 1.5)) continue;
      const tr = liveTraction(t).score;
      if (tr < 65) continue;
      const stage = t.graduated ? "bonded" : (bondingProgress(t) || 0) >= 0.6 ? "near" : "new";
      db.prepare("UPDATE research SET status = 'queued', stage = ?, queued = ?, enq_t = ?, error = NULL, fast = NULL, tier = NULL, reads = COALESCE(reads, 1) + 1 WHERE mint = ? AND status = 'done'").run(stage, now() - tr * 1000, now(), r.mint);
      logEvent("research", `$${t.symbol} is taking off (traction ${tr}, ${r.mcap_at > 0 ? `${(m / r.mcap_at).toFixed(1)}x since its last read` : "no price at its last read"}): reading it again`);
    }
  }
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
    const young = db.prepare(`SELECT * FROM tokens WHERE status = 'active' AND dex = 'pumpfun' AND graduated = 0 AND first_seen > ? AND mcap >= 15000 AND vol_h1 >= 4000 AND ${MEME}
      ORDER BY vol_h1 DESC LIMIT 25`).all(now() - 30 * MIN);
    for (const t of young) {
      if (json(t.safety)?.danger > 0 || (bondingProgress(t) || 0) >= 0.6) continue;
      if (db.prepare("SELECT 1 FROM research WHERE mint = ?").get(t.mint)) continue;
      if (triageFor(t.mint)?.label === "slop") continue;   // the triage already ruled it out
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
  return { near: near.slice(0, 30).map(attach), bonded: bonded.slice(0, 30).map(attach), top, narratives, stats, hour, queue: queueStatus(), providers: providers(),
    perHour: grokDeep() ? settings.deepPerHour : settings.researchPerHour, deepProvider: grokDeep() ? "grok" : "claude", deepMin: deepMin(), fastPerHour: settings.fastPerHour, auto: settings.researchAuto, fast: fastStatus() };
}

// The queue as it really is: how many wait, how long the oldest has waited, and how long it would take to clear.
export function queueStatus() {
  const waits = db.prepare("SELECT enq_t FROM research WHERE status = 'queued' AND enq_t IS NOT NULL").all().map((r) => now() - r.enq_t).sort((a, b) => a - b);
  const size = queueSize(), cap = capacity();
  return { size, cap: queueCap(), perHour: cap, deepWaiting: db.prepare("SELECT COUNT(*) n FROM research WHERE status = 'deep'").get().n,
    oldestMin: waits.length ? Math.round(waits[waits.length - 1] / MIN) : 0, medianMin: waits.length ? Math.round(waits[waits.length >> 1] / MIN) : 0,
    etaMin: cap ? Math.round((size / cap) * 60) : null, expiredHour: inHour(expired.hour),
    errors: db.prepare("SELECT COUNT(*) n FROM research WHERE status = 'error' AND t > ?").get(now() - 24 * 60 * MIN).n };
}

// Which AI is really doing each job right now, what was configured, and why they differ.
export function providers() {
  const g = grokStatus(), c = claudeStatus(), k = groqStatus();
  const name = { grok: "Grok", groq: "Groq", claude: "Claude", haiku: "Claude Haiku" };
  const fastWant = settings.fastProvider === "groq" ? "groq" : settings.fastProvider === "claude" ? "haiku" : "grok";
  const fastNow = grokOn() ? "grok" : groqReady() && settings.fastProvider !== "claude" ? "groq" : claudeFast() ? "haiku" : null;
  const deepWant = settings.deepProvider === "claude" ? "claude" : "grok";
  const deepNow = grokDeep() ? "grok" : c.ready ? "claude" : null;
  const grokWhy = !g.installed ? "Grok is not logged in on this PC (run `grok login`)" : g.blocked ? `${g.blocked}; re-checked ${g.blockedUntil ? `in ${Math.max(1, Math.round((g.blockedUntil - now()) / MIN))} min` : "soon"}` : g.coolingSecs ? `Grok is rate limited for ${g.coolingSecs}s` : null;
  const lane = (want, cur, why) => ({ configured: want, configuredName: name[want], actual: cur, actualName: cur ? name[cur] : null, fallback: want !== cur, reason: want !== cur ? why : null });
  return {
    fast: { ...lane(fastWant, fastNow, fastWant === "grok" ? grokWhy : "no Groq key is saved"), search: fastNow === "grok" && settings.grokSearch,
      note: fastNow === "haiku" ? "Claude Haiku is doing the first reads: seconds per coin, but it only sees what the radar gathered and cannot search X live." : fastNow ? null : "No fast AI is available, so first reads go straight to the deep lane at its slower pace." },
    deep: { ...lane(deepWant, deepNow, deepWant === "grok" ? grokWhy : c.loginError), search: deepNow === "grok",
      note: deepNow === "claude" ? "Claude reads only what the radar gathered (X profile, linked tweet, website, news). It does not search X live." : null },
    grok: { installed: g.installed, ok: g.installed && !g.blocked && !g.coolingSecs, blocked: g.blocked, blockedUntil: g.blockedUntil, blockedSince: g.blockedSince, errors: g.errors, calls: g.calls, lastError: g.lastError, lastErrorAt: g.lastErrorAt, lastOk: g.lastOk, tier: g.tier, limits: g.limits },
    groq: { configured: k.ready, errors: k.errors, calls: k.calls, lastError: k.lastError, cooling: k.cooling },
    claude: { ok: c.ready, loginError: c.loginError, errors: c.errors, calls: c.calls, truncated: c.truncated, lastError: c.lastError, lastErrorAt: c.lastErrorAt, lastOk: c.lastOk, usedThisHour: grokDeep() ? 0 : inHour(deepHour), perHour: settings.researchPerHour },
    recovery: !g.installed ? "Run `grok login` once to use your SuperGrok subscription, or add a free Groq key in Settings."
      : g.blocked ? "Grok's subscription credits are spent for this billing period. The radar re-checks every 30 minutes and switches back by itself. Until then: add a free Groq key in Settings for fast reads, or leave it on Claude (slower, no live X search)." : null,
  };
}

export function startResearch(raise) {
  raiseFn = raise;
  // Jobs that were mid-read when the radar stopped go back in the queue.
  db.prepare("UPDATE research SET status = CASE WHEN fast IS NOT NULL THEN 'deep' ELSE 'queued' END WHERE status = 'running'").run();
  try { trimQueue(); } catch (e) { logEvent("error", `queue: ${e.message}`); }
  // Both run every second: a new candidate is noticed, queued and handed to a free reader within about a second.
  const timers = [setInterval(scout, 1000), setInterval(pump, 1000)];
  return () => timers.forEach(clearInterval);
}
