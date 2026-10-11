// The Narratives desk (#/narratives, "Today"): in-depth write-ups of the day's narratives and runners, the way a
// trader would want them explained. Two kinds of subject:
//   stories  the narratives running now (running.js: coins grouped by theme, shared word or copies of one coin)
//   runners  the coins of the day: the biggest 24-hour moves with real money behind them, copies folded in
// Each subject is researched and written by Grok (it searches X and the web for what actually happened: the post,
// the person, the event) into one article: what the thing is, what is happening, how it is trading, the coins and
// their roles, the case for and against, what to watch. An article is written once and rewritten only when its
// subject has moved a lot since, so the day's spend stays small: settings.deskBudget dollars a day (the owner asked
// for about 5% of the $100 Grok plan a day, 2026-10-10), paced through the day so the morning cannot spend the
// evening's share; lane "desk", the only Grok lane the owner left on (settings.grokLanes).
// Grok explains the story; the numbers are Blix's own and live (each read of /api/desk): the coins, a "right now"
// state of the narrative, and the known traders in it (Fomo holders and trades on its coins, fomo_coin/fomo_flow). A "day so far" column ties them
// together every 90 minutes. Subjects not written yet are still listed with Blix's own read of the numbers.
//
// GET /api/desk: { t, writer, lede, stories: [Entry], runners: [Entry], earlier: [Entry] }, kept 15 s.
import { db, json, logEvent } from "./db.js";
import { settings } from "./settings.js";
import { askGrok, grokReady, grokSpend, grokStatus } from "./grok.js";
import { runningNarratives } from "./running.js";
import { classifyAsset } from "./quality.js";
import { linksFor } from "./linkfill.js";
import { wantFomoFresh } from "./fomoboard.js";

const MIN = 60_000, HOUR = 60 * MIN;
const now = () => Date.now();
const LANE = "desk";
const MODEL = () => settings.deskModel || "grok-4.7";
const BUDGET = () => (settings.deskBudget == null ? 5 : +settings.deskBudget || 0);
const TICK_MS = 3 * MIN, AT_ONCE = 3, REWRITE_MIN_MS = 3 * HOUR, KEEP_MS = 3 * 24 * HOUR, LEDE_EVERY = 90 * MIN;

db.exec(`CREATE TABLE IF NOT EXISTS desk (key TEXT PRIMARY KEY, id TEXT, kind TEXT, name TEXT, t INTEGER, upd INTEGER, ver INTEGER,
  body TEXT, snap TEXT, mints TEXT, model TEXT, cost REAL, searches INTEGER)`);
db.exec("CREATE INDEX IF NOT EXISTS desk_upd ON desk(upd)");

export const deskStats = { on: false, runs: 0, written: 0, lastOk: 0, lastError: null, lastErrorAt: 0, writing: [], why: null };

// ---------- the subjects ----------
// A ticker with one "$" in front, whether or not the coin's own symbol starts with one ("$CAT" came out "$$CAT").
const tk = (sym) => `$${String(sym || "").replace(/^\$+/, "")}`;
const familyKey = (c) => String(c.symbol || c.name || c.mint).toLowerCase().replace(/^\$/, "").replace(/[^a-z0-9]/g, "") || c.mint;
const pegged = (c) => /^(usd|eur|gbp)[a-z0-9]{0,3}$/i.test(String(c.symbol || "")) || /\b(stable ?coin|dollar|treasury|yield)\b/i.test(String(c.name || ""));
const credible = (c) => (c.liquidity || 0) >= 10_000 && (c.mcap || 0) <= (c.liquidity || 0) * 25;
const COLS = `mint, symbol, name, description, image, links, dex, liquidity, mcap, peak_mcap, vol_h1, vol_h24, chg_m5, chg_h1, chg_h24,
  COALESCE(pair_created, first_seen) AS born, graduated, class_user, source`;
const dayPick = db.prepare(`SELECT ${COLS} FROM tokens WHERE vol_h24 >= 200000 AND mcap >= 150000 AND quarantine IS NULL AND updated > ? ORDER BY vol_h24 DESC LIMIT 300`);
const byMints = (mints) => (mints.length ? db.prepare(`SELECT ${COLS} FROM tokens WHERE mint IN (${mints.map(() => "?").join(",")})`).all(...mints) : []);

// Runners of the day: real memecoins up big on the day (or born today and already big), copies of one name folded
// into the most credible one, ranked by money times move. Volume over 80x the market cap is bots trading with
// themselves, not a runner.
function dayRunners(t = now()) {
  const fams = new Map();
  for (const c of dayPick.all(t - 2 * HOUR)) {
    if (classifyAsset(c) !== "meme" || pegged(c) || !credible(c) || (c.vol_h24 || 0) > (c.mcap || 1) * 80) continue;
    const young = t - (c.born || 0) < 24 * HOUR;
    if (!((c.chg_h24 ?? 0) >= 40 || (young && (c.peak_mcap || c.mcap || 0) >= 500_000))) continue;
    if (c.chg_h24 != null && Math.abs(c.chg_h24) > 1e6) continue;
    const k = familyKey(c);
    const f = fams.get(k) || { key: k, coins: [], vol: 0 };
    f.coins.push(c); f.vol += c.vol_h24 || 0; fams.set(k, f);
  }
  return [...fams.values()].map((f) => {
    f.coins.sort((a, b) => (b.mcap || 0) - (a.mcap || 0));
    const lead = f.coins[0], move = lead.chg_h24 ?? (t - (lead.born || 0) < 24 * HOUR ? 300 : 0);
    return { ...f, lead, copies: f.coins.length, score: f.vol * Math.min(4, Math.max(0.5, 1 + move / 300)) };
  }).sort((a, b) => b.score - a.score).slice(0, 14);
}

// The story's key stays the same while the story lasts (an AI read's index changes from read to read).
const storyKey = (s) => `story:${String(s.id).replace(/^ai:\d+:/, "ai:").toLowerCase()}`;
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

function subjects(t = now()) {
  const run = runningNarratives();
  const stories = (run.stories || []).slice(0, 10).map((s, i) => ({ kind: "story", key: storyKey(s), id: `n-${slug(s.name)}`, name: s.name, rank: i + 1, story: s,
    mints: s.coins.map((c) => c.mint), size: s.stats.volH1, lead: s.coins[0] || null }));
  const runners = dayRunners(t).map((f, i) => ({ kind: "runner", key: `runner:${f.key}`, id: `r-${slug(f.lead.symbol || f.key)}-${f.lead.mint.slice(0, 5).toLowerCase()}`,
    name: tk(f.lead.symbol || f.key), rank: i + 1, fam: f, mints: [f.lead.mint], size: f.vol, lead: f.lead }));
  return { stories, runners };
}

// ---------- writing ----------
const usd = (n) => (n == null ? "?" : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`);
const pct = (n) => (n == null ? "?" : `${n >= 0 ? "+" : "−"}${Math.abs(Math.round(n)).toLocaleString("en-US")}%`);
const age = (born, t = now()) => { if (!born) return "?"; const m = Math.max(0, Math.round((t - born) / MIN)); return m < 120 ? `${m}m` : m < 48 * 60 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };
const linkLine = (c) => {
  const ls = linksFor(c.mint, json(c.links, [])).filter((l) => l?.url).slice(0, 4);
  return ls.length ? ` · links: ${ls.map((l) => l.url).join(" ")}` : "";
};
const coinLine = (c, extra = "") => `${tk(c.symbol)} "${c.name || ""}" (mint ${c.mint}) · mc ${usd(c.mcap)}${c.peak_mcap ? ` (peak ${usd(c.peak_mcap)})` : ""} · liq ${usd(c.liquidity)} · vol 1h ${usd(c.vol_h1)} · vol 24h ${usd(c.vol_h24)} · 5m ${pct(c.chg_m5)} · 1h ${pct(c.chg_h1)} · 24h ${pct(c.chg_h24)} · ${age(c.born)} old${c.graduated ? " · bonded" : c.dex === "pumpfun" ? " · on the pump.fun curve" : ""}${extra}${c.description ? ` · description: "${String(c.description).replace(/\s+/g, " ").slice(0, 220)}"` : ""}${linkLine(c)}`;

const SYSTEM = `You are the narratives editor at Blix, a Solana memecoin trading terminal. Readers come to the Narratives page to understand what is actually going on today: which stories traders are playing, what each coin refers to, and what happened to make it run. You write in-depth, readable analysis.

Research first. Search X and the web for the coins' tickers and names, and for the thing they refer to (a person, a post, a product, an event, a meme, a news story). Find what actually happened, who posted it, and when. Read what traders on X are saying about the coins right now.

Rules:
- Only state facts you found in your searches or that are in the data given. Never invent posts, quotes, people, numbers or dates. If you could not find what started it, say so plainly ("Blix could not find a clear trigger on X") and explain what the coins themselves show.
- Plain English, short sentences. Someone who has never traded a memecoin should follow it. Explain any slang the first time (bonding, CTO, KOL...).
- No hype or advice: never "moon", "gem", "100x", "send it", "NFA", no emojis, no price targets, no "buy" or "sell".
- Numbers come from the data given; round them the way a person would ($1.2M, up about 340%).
- Be specific: names, handles (@...), times (in UTC), amounts.
- Blix shows the live market numbers next to your article, so prices go stale in your text: keep market caps and percentage moves out of "headline", "dek" and "what"; in "happening" a number needs its time ("about $190K at 22:10 UTC"). Write the ticker with a $ in front ($UZICAT) every time you name a coin, and people with their @handle.

Answer with one JSON object only, no text around it.`;

const SHAPE = `{
 "headline": "under 80 characters: says what is happening, not clickbait",
 "dek": "one sentence under 190 characters: the short version",
 "tag": "1 to 3 words for the kind of story (Celebrity, AI, Breaking news, Politics, Culture, Platform, Copycat wave, Community takeover, Animal, Gaming...)",
 "status": "one of: new, heating, peaking, cooling, fading",
 "what": "one paragraph: what the thing is, for someone who has never heard of it",
 "happening": ["2 to 4 paragraphs: what actually happened and when, the trigger, who is posting about it, what X is saying now"],
 "trading": "one paragraph: how the coins were trading at the time of writing, using the numbers: who leads, the followers and copies, the move, the money",
 "coins": [{"symbol": "TICKER without $", "role": "one line: this coin's place in the story (the original, the biggest, a copy, the newest...)"}],
 "bull": ["2 or 3 short points: why it could keep going"],
 "bear": ["2 or 3 short points: why it could fade, risks"],
 "watch": "one or two sentences: what to watch next",
 "posts": [{"handle": "@handle", "text": "what the post says, under 160 characters", "url": "https://x.com/..."}]
}
"posts": 0 to 3 real posts you found that matter to the story, with their real links; an empty list if none.`;

function storyPrompt(sub) {
  const s = sub.story, rows = new Map(byMints(sub.mints).map((c) => [c.mint, c]));
  const lines = s.coins.map((c, i) => { const r = rows.get(c.mint); return `${i + 1}. ${r ? coinLine(r, c.copies > 1 ? ` · ${c.copies} coins trade under this name (volume counts them all: ${usd(c.volH1)} in the hour)` : "") : `${tk(c.symbol)} "${c.name || ""}" · mc ${usd(c.mcap)} · vol 1h ${usd(c.volH1)} · 1h ${pct(c.chg1h)}`}`; });
  return `Today is ${new Date().toISOString().slice(0, 10)}, ${new Date().toISOString().slice(11, 16)} UTC.
Write the article for this narrative running on Solana right now.

Narrative: ${s.name}
How Blix grouped it: ${s.source === "theme" ? "by theme" : s.source === "words" ? "the same word in the coins' names" : s.source === "copies" ? "one coin and the copies launched under its name" : "by an AI read"}${s.why ? ` (${s.why})` : ""}
The numbers: ${s.facts}

Its coins (most traded first):
${lines.join("\n")}

Explain what ties these coins together and what is really going on. If they are several separate things sharing a theme, say which one is driving it today and treat the rest briefly.

Shape:
${SHAPE}`;
}

function runnerPrompt(sub) {
  const f = sub.fam, c = f.lead;
  return `Today is ${new Date().toISOString().slice(0, 10)}, ${new Date().toISOString().slice(11, 16)} UTC.
Write the article on one of today's biggest runners on Solana: what this coin is, why it ran, and where it stands now.

The coin:
${coinLine(c)}
${f.copies > 1 ? `Other coins under the same name (copies, smaller): ${f.coins.slice(1, 6).map((x) => `${tk(x.symbol)} mc ${usd(x.mcap)} 24h ${pct(x.chg_h24)}`).join("; ")}` : "No copies under the same name with real money."}

Find the story: what the name refers to, who launched or pushed it, the posts or news that sent it, how the day went (when it ran, how high, pullbacks), and what traders on X say about it now. "coins" lists just this coin (and a copy only if it matters).

Shape:
${SHAPE}`;
}

const cut = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const list = (v, n, len) => (Array.isArray(v) ? v : []).map((x) => cut(x, len)).filter(Boolean).slice(0, n);
const STATUS = new Set(["new", "heating", "peaking", "cooling", "fading"]);
function clean(j, citations) {
  if (!j || typeof j !== "object" || !cut(j.headline, 10)) return null;
  const xurl = (u) => (typeof u === "string" && /^https:\/\/(x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/\d+/.test(u) ? u : null);
  return {
    headline: cut(j.headline, 110), dek: cut(j.dek, 260), tag: cut(j.tag, 30), status: STATUS.has(j.status) ? j.status : null,
    what: cut(j.what, 1400), happening: list(j.happening, 5, 1600), trading: cut(j.trading, 1400),
    coins: (Array.isArray(j.coins) ? j.coins : []).slice(0, 12).map((c) => ({ symbol: cut(c?.symbol, 20).replace(/^\$/, ""), role: cut(c?.role, 220) })).filter((c) => c.symbol),
    bull: list(j.bull, 4, 260), bear: list(j.bear, 4, 260), watch: cut(j.watch, 500),
    posts: (Array.isArray(j.posts) ? j.posts : []).slice(0, 3).map((p) => ({ handle: cut(p?.handle, 40), text: cut(p?.text, 240), url: xurl(p?.url) })).filter((p) => p.handle && p.text),
    sources: (citations || []).slice(0, 12),
  };
}
function parse(text) {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(text.slice(a, b + 1)); } catch { return null; }
}

const getRow = db.prepare("SELECT * FROM desk WHERE key = ?");
const putRow = db.prepare(`INSERT INTO desk (key, id, kind, name, t, upd, ver, body, snap, mints, model, cost, searches) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET id = excluded.id, name = excluded.name, upd = excluded.upd, ver = desk.ver + 1, body = excluded.body, snap = excluded.snap,
  mints = excluded.mints, model = excluded.model, cost = COALESCE(desk.cost, 0) + excluded.cost, searches = excluded.searches`);

// What the subject looked like when it was written: its size, its lead coin and the lead's market cap.
const snapOf = (sub) => ({ size: sub.size, lead: sub.lead?.mint || null, leadMc: sub.lead?.mcap ?? null, coins: sub.mints.length });
// Rewrite when it has moved a lot since (money doubled or halved, the lead's cap up 60% or halved, a new lead),
// and not more often than every 3 hours.
function needs(sub, row, t) {
  if (!row) return true;
  if (t - row.upd < REWRITE_MIN_MS) return false;
  if (t - row.upd > 20 * HOUR) return true;
  const s = json(row.snap, {}), r = (a, b) => (a && b ? a / b : 1);
  const size = r(sub.size, s.size), mc = r(sub.lead?.mcap, s.leadMc);
  return size >= 2 || size <= 0.5 || mc >= 1.6 || mc <= 0.5 || (s.lead && sub.lead && s.lead !== sub.lead.mint && sub.kind === "story");
}

async function write(sub) {
  const r = await askGrok(SYSTEM, sub.kind === "story" ? storyPrompt(sub) : runnerPrompt(sub),
    { model: MODEL(), lane: LANE, search: true, maxSearches: 6, effort: "low", maxTokens: 2800, timeout: 170_000 });
  const body = clean(parse(r.text), r.citations);
  if (!body) throw new Error(`the answer for ${sub.name} was not an article`);
  const t = now();
  putRow.run(sub.key, sub.id, sub.kind, sub.name, t, t, JSON.stringify(body), JSON.stringify(snapOf(sub)), JSON.stringify(sub.mints), r.model, r.cost || 0, r.searches || 0);
  deskStats.written++;
  memo = null;
  return body;
}

// The day so far: one column over the day's articles, no searching (it reads what the desk already found).
async function writeLede(rows) {
  const items = rows.slice(0, 18).map((w) => { const b = json(w.body, {}); return `- [${w.kind === "story" ? "narrative" : "runner"}] ${w.name}: ${b.headline}. ${b.dek} (status: ${b.status || "?"}, written ${age(w.upd)} ago)`; });
  const run = runningNarratives();
  const prompt = `Today is ${new Date().toISOString().slice(0, 10)}, ${new Date().toISOString().slice(11, 16)} UTC. Blix tracks ${run.universe?.coins || "?"} Solana memecoins with real money moving this hour.
Today's articles from the desk:
${items.join("\n")}

Write "The day so far": the front-page column that ties today's narratives and runners together for a trader opening the page. What is the market playing today, which stories lead, what is new, what is fading, and the common thread if there is one. Only use what is in the articles above.
Answer with JSON only: {"headline": "under 80 characters", "body": ["3 or 4 short paragraphs"], "themes": ["3 to 6 two-word labels for today's main currents"]}`;
  const r = await askGrok(SYSTEM, prompt, { model: MODEL(), lane: LANE, search: false, maxTokens: 1600, timeout: 120_000 });
  const j = parse(r.text);
  if (!j || !cut(j.headline, 5)) throw new Error("the day column was not an answer");
  const body = { headline: cut(j.headline, 110), body: list(j.body, 5, 1400), themes: list(j.themes, 6, 30) };
  const t = now();
  putRow.run("lede", "lede", "lede", "The day so far", t, t, JSON.stringify(body), "{}", "[]", r.model, r.cost || 0, 0);
  memo = null;
}

function spentToday() { return grokSpend().lanes?.[LANE]?.usd || 0; }
// What the desk may have spent by now: the day's budget opens up hour by hour (a tenth of it from midnight), the
// same day grok.js counts spend in.
function allowedNow() {
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  return BUDGET() * Math.min(1, (now() - d0.getTime()) / 864e5 + 0.1);
}
function whyNot() {
  if (!(Array.isArray(settings.grokLanes) && settings.grokLanes.includes(LANE)) && settings.grokOff) return "Grok is switched off for the desk (settings.grokLanes)";
  if (!grokReady(LANE)) return grokStatus().blocked || "Grok is not available";
  if (BUDGET() && spentToday() >= BUDGET()) return `today's desk budget of $${BUDGET().toFixed(2)} is spent`;
  if (BUDGET() && spentToday() >= allowedNow()) return `pacing: $${spentToday().toFixed(2)} of today's $${BUDGET().toFixed(2)} spent, more opens up through the day`;
  return null;
}

let busy = false, lastLede = 0;
async function tick() {
  if (busy || settings.desk === false) return;
  const why = whyNot();
  deskStats.on = !why; deskStats.why = why;
  if (why) return;
  busy = true; deskStats.runs++;
  try {
    const t = now(), { stories, runners } = subjects(t);
    // Alternate the two kinds so neither waits on the other; biggest first.
    const queue = [], s1 = stories.filter((s) => needs(s, getRow.get(s.key), t)), r1 = runners.filter((s) => needs(s, getRow.get(s.key), t));
    while (s1.length || r1.length) { if (s1.length) queue.push(s1.shift()); if (r1.length) queue.push(r1.shift()); }
    // One at a time until Grok has answered once since the start (askGrok turns a second call away while the
    // first checks the credits are there).
    const batch = queue.slice(0, grokStatus().lastOk ? AT_ONCE : 1);
    deskStats.writing = batch.map((s) => s.name);
    const done = await Promise.allSettled(batch.map(write));
    for (const [i, d] of done.entries()) if (d.status === "rejected") { deskStats.lastError = `${batch[i].name}: ${d.reason?.message || d.reason}`; deskStats.lastErrorAt = now(); logEvent("error", `Narratives desk: ${deskStats.lastError}`); }
    if (done.some((d) => d.status === "fulfilled")) { deskStats.lastOk = now(); }
    // The day column once a few articles are in, then every 90 minutes while there is something new.
    const rows = db.prepare("SELECT * FROM desk WHERE kind != 'lede' AND upd > ? ORDER BY upd DESC").all(now() - 24 * HOUR);
    const lede = getRow.get("lede");
    if (rows.length >= 3 && (!lede || (now() - lede.upd > LEDE_EVERY && rows.some((w) => w.upd > lede.upd))) && now() - lastLede > 10 * MIN && !whyNot()) {
      lastLede = now();
      await writeLede(rows).catch((e) => { deskStats.lastError = `day column: ${e.message}`; deskStats.lastErrorAt = now(); });
    }
  } catch (e) {
    deskStats.lastError = e.message; deskStats.lastErrorAt = now();
  } finally { busy = false; deskStats.writing = []; }
  db.prepare("DELETE FROM desk WHERE upd < ?").run(now() - KEEP_MS);
}

// ---------- reading ----------
const liveCoin = (c) => ({ mint: c.mint, symbol: c.symbol, name: c.name, mcap: credible(c) ? c.mcap : null, peak: c.peak_mcap || null, liq: c.liquidity,
  volH1: c.vol_h1, volH24: c.vol_h24, chg5m: c.chg_m5, chg1h: c.chg_h1, chg24h: c.chg_h24, born: c.born, bonded: Boolean(c.graduated) });
// Blix's own read of a subject's numbers: what the list shows before (or without) an article.
function autoRead(sub) {
  if (sub.kind === "story") return [sub.story.link || sub.story.why, sub.story.facts].filter(Boolean).join(" ");
  const f = sub.fam, c = f.lead, young = now() - (c.born || 0) < 24 * HOUR;
  return `${tk(c.symbol)}${c.name && c.name !== c.symbol ? ` (${c.name})` : ""} ${young ? `launched ${age(c.born)} ago and` : "is"} ${c.chg_h24 != null ? `${c.chg_h24 >= 0 ? "up" : "down"} ${pct(c.chg_h24).replace(/^[+−]/, "")} on the day` : "running today"}, with ${usd(f.vol)} traded in 24 hours. It is worth ${usd(c.mcap)} now${c.peak_mcap && c.peak_mcap > c.mcap * 1.15 ? `, off a high of ${usd(c.peak_mcap)}` : ""}. Over the last hour it moved ${pct(c.chg_h1)}.${f.copies > 1 ? ` ${f.copies - 1} cop${f.copies === 2 ? "y trades" : "ies trade"} under the same name.` : ""}`;
}
// Where the subject is heading right now, from the live numbers (the article's own status was its state when written).
function liveState(sub) {
  if (sub.kind === "story") return { state: sub.story.heat || "steady", offHigh: 0 };
  const c = sub.fam.lead, h1 = c.chg_h1 ?? 0, m5 = c.chg_m5 ?? 0, off = c.peak_mcap && c.mcap ? c.mcap / c.peak_mcap : 1;
  return { state: m5 >= 3 && h1 >= 0 ? "heating" : m5 <= -3 || h1 <= -15 ? "cooling" : "steady", offHigh: off < 0.95 ? Math.round((1 - off) * 100) : 0 };
}

// The known traders in a narrative: Fomo's holders and trades on its coins (fomo_coin, as the coin pages read it),
// one row per person across all of its coins: what they hold now, their profit on it, what they bought and sold
// today. And the hour's flow from every wallet Blix follows on Fomo (fomo_flow): buyers, sellers, dollars each way.
const fomoRow = db.prepare("SELECT data, t FROM fomo_coin WHERE mint = ?");
const flowOf = (mints) => db.prepare(`SELECT COUNT(DISTINCT CASE WHEN side = 'buy' THEN wallet END) buyers, COUNT(DISTINCT CASE WHEN side = 'sell' THEN wallet END) sellers,
  SUM(CASE WHEN side = 'buy' THEN usd ELSE 0 END) bought, SUM(CASE WHEN side = 'sell' THEN usd ELSE 0 END) sold FROM fomo_flow WHERE mint IN (${mints.map(() => "?").join(",")}) AND t > ?`).get(...mints, now() - HOUR);
const fomoAsked = new Map();
function tradersOf(coins) {
  const people = new Map(), t0 = now() - 24 * HOUR;
  let read = 0, newest = 0;
  for (const c of coins) {
    // Someone is reading the desk: each coin's Fomo read is kept under 5 minutes old (asked once a minute at most).
    if (now() - (fomoAsked.get(c.mint) || 0) > MIN) { fomoAsked.set(c.mint, now()); try { wantFomoFresh(c.mint, 5 * MIN); } catch {} }
    const r = fomoRow.get(c.mint), d = r ? json(r.data, null) : null;
    if (!d) continue;
    read++; newest = Math.max(newest, r.t);
    const sym = String(c.symbol || "").replace(/^\$+/, "");
    const who = (x) => {
      let p = people.get(x.handle);
      if (!p) people.set(x.handle, (p = { handle: x.handle, name: x.name || x.handle, pic: x.pic || null, followers: x.followers ?? null, verified: Boolean(x.verified),
        value: 0, pnl: 0, cost: 0, bought: 0, sold: 0, buys: 0, sells: 0, last: 0, coins: [], thesis: null, dev: false }));
      if (x.followers != null) p.followers = Math.max(p.followers ?? 0, x.followers);
      if (x.pic && !p.pic) p.pic = x.pic;
      if (!p.coins.includes(sym)) p.coins.push(sym);
      p.dev ||= Boolean(x.dev);
      return p;
    };
    for (const h of d.holders || []) {
      if (!h?.handle || h.external) continue;
      const p = who(h);
      p.value += h.value || 0; p.pnl += h.pnl || 0; p.cost += h.cost || 0;
      // A thesis is Fomo's { id, text, likes, mcap, t }.
      const th = typeof h.thesis === "string" ? h.thesis : h.thesis?.text;
      if (th && !p.thesis) p.thesis = String(th).replace(/\s+/g, " ").trim().slice(0, 220) || null;
    }
    for (const s of d.swaps || []) {
      const t = Date.parse(s?.t);
      if (!s?.handle || !(t > t0)) continue;
      const p = who(s);
      if (s.buy) { p.bought += s.usd || 0; p.buys++; } else { p.sold += s.usd || 0; p.sells++; }
      p.last = Math.max(p.last, t);
    }
  }
  const all = [...people.values()].filter((p) => p.value >= 1 || p.bought + p.sold >= 1);
  // The ones a reader cares about first: big positions and big hands, then followers.
  const rank = (p) => p.value + (p.bought + p.sold) * 0.5 + Math.min(p.followers || 0, 50_000) * 0.2;
  const holding = all.filter((p) => p.value >= 1);
  const top = all.sort((a, b) => rank(b) - rank(a)).slice(0, 14)
    .map((p) => ({ ...p, value: Math.round(p.value), pnl: Math.round(p.pnl), cost: Math.round(p.cost), bought: Math.round(p.bought), sold: Math.round(p.sold) }));
  const f = coins.length ? flowOf(coins.map((c) => c.mint)) : null;
  return {
    top, known: all.length, holders: holding.length, held: Math.round(holding.reduce((s, p) => s + p.value, 0)),
    inProfit: holding.filter((p) => p.pnl > 0).length, coinsRead: read, coins: coins.length, readAt: newest || null,
    flow: f ? { buyers: f.buyers || 0, sellers: f.sellers || 0, bought: Math.round(f.bought || 0), sold: Math.round(f.sold || 0) } : null,
  };
}

function entry(sub, row, live) {
  const mints = sub ? sub.mints : json(row.mints, []);
  const coins = mints.map((m) => live.get(m)).filter(Boolean).map(liveCoin);
  const snap = row ? json(row.snap, {}) : null;
  return {
    id: sub?.id || row.id, key: sub?.key || row.key, kind: sub?.kind || row.kind, name: sub?.name || row.name, rank: sub?.rank ?? null, live: Boolean(sub),
    auto: sub ? autoRead(sub) : "", stats: sub?.kind === "story" ? sub.story.stats : sub ? { vol24: Math.round(sub.fam.vol), copies: sub.fam.copies } : null,
    heat: sub?.kind === "story" ? sub.story.heat || null : null, source: sub?.kind === "story" ? sub.story.source : null,
    article: row ? { ...json(row.body, {}), t: row.t, upd: row.upd, ver: row.ver, model: row.model, searches: row.searches, leadMcAt: snap?.leadMc ?? null, leadAt: snap?.lead ?? null } : null,
    coins, traders: tradersOf(coins.slice(0, 8)), now: sub ? liveState(sub) : null,
  };
}

let memo = null;
export function deskView() {
  if (memo && now() - memo.t < 15_000) return memo;
  const t = now(), { stories, runners } = subjects(t);
  const rows = db.prepare("SELECT * FROM desk WHERE upd > ? ORDER BY upd DESC").all(t - 24 * HOUR);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const allMints = new Set([...stories, ...runners].flatMap((s) => s.mints));
  for (const r of rows) for (const m of json(r.mints, [])) allMints.add(m);
  const live = new Map(byMints([...allMints].slice(0, 600)).map((c) => [c.mint, c]));
  const liveKeys = new Set([...stories, ...runners].map((s) => s.key));
  const lede = byKey.get("lede");
  memo = {
    t,
    writer: { on: deskStats.on, why: deskStats.why, model: MODEL(), lastOk: deskStats.lastOk || null, writing: deskStats.writing, spentToday: +spentToday().toFixed(3), budget: BUDGET(), allowedNow: +allowedNow().toFixed(2) },
    lede: lede ? { ...json(lede.body, {}), upd: lede.upd } : null,
    stories: stories.map((s) => entry(s, byKey.get(s.key), live)),
    runners: runners.map((s) => entry(s, byKey.get(s.key), live)),
    // Written earlier today, no longer in today's lists: still worth reading.
    earlier: rows.filter((r) => r.kind !== "lede" && !liveKeys.has(r.key)).slice(0, 24).map((r) => entry(null, r, live)),
  };
  return memo;
}

// Not for a copy on its own data folder (the tests), nor where the owner switched the desk off.
if (!process.env.RADAR_DATA) {
  setTimeout(tick, 20_000).unref();
  setInterval(tick, TICK_MS).unref();
}
