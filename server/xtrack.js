// X tracker: follow X accounts and see every post they make within about a minute, free.
//
// X has no free read API, and the free mirrors are dead or hours late (FxTwitter's timelines missed Ansem's
// last three posts on 2026-10-05). So Blix reads X through the owner's Aside browser, logged in as @blix_vip,
// in one tab the owner keeps open for it (its address carries `blix=tracker`). Each check, run through the
// Aside CLI without touching the owner's other tabs or focus:
//   - a hook in that tab copies X's own SearchTimeline answers (X signs its API calls in-page, so a call made
//     from outside gets 404; X's own call works);
//   - X's router is sent to a "Latest" search of `from:a OR from:b …` in-page (no reload, works while the tab
//     is in the background, where X fetches but does not draw);
//   - the captured answer is read and trimmed to the posts.
// Posts are stored with the coins they mention (contract addresses, pump.fun / trading links, $tickers);
// contract addresses are handed to the radar so those coins get tracked. Profile changes (name, picture,
// bio) seen in the answers are recorded too. Account details when adding one come from FxTwitter (free).
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { db, logEvent } from "./db.js";

const ASIDE_EXE = path.join(process.env.LOCALAPPDATA || "", "Aside", "CLI", "current", "aside.exe");
const EVERY_MS = 45_000, QUERY_MAX = 450, MAX_ACCOUNTS = 200;
const now = () => Date.now();
export const TAB_URL = "https://x.com/search?q=from%3Ablknoiz06&f=live&blix=tracker";

db.exec(`
CREATE TABLE IF NOT EXISTS x_accounts (handle TEXT PRIMARY KEY COLLATE NOCASE, name TEXT, avatar TEXT, bio TEXT, followers INTEGER,
  added INTEGER, last_post INTEGER, alerts INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS x_posts (id TEXT PRIMARY KEY, handle TEXT COLLATE NOCASE, name TEXT, avatar TEXT, t INTEGER, text TEXT,
  data TEXT, mints TEXT, tickers TEXT, seen INTEGER);
CREATE INDEX IF NOT EXISTS x_posts_t ON x_posts(t);
CREATE INDEX IF NOT EXISTS x_posts_handle ON x_posts(handle, t);
CREATE TABLE IF NOT EXISTS x_changes (id INTEGER PRIMARY KEY, t INTEGER, handle TEXT, field TEXT, old TEXT, new TEXT);
`);

export const xState = { running: false, lastRun: 0, lastOk: 0, lastError: null, tab: null, posts: 0, runs: 0, chunk: 0, ms: null };
let onNew = null, onMints = null;
export const onXPosts = (fn) => { onNew = fn; };
export const onXMints = (fn) => { onMints = fn; };

// ---------- accounts ----------
const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
export const accounts = () => db.prepare("SELECT * FROM x_accounts ORDER BY COALESCE(last_post, 0) DESC, added DESC").all();
export async function addAccount(raw) {
  const handle = String(raw || "").trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, "").split(/[/?#]/)[0];
  if (!HANDLE.test(handle)) throw Object.assign(new Error("That is not an X handle."), { status: 400 });
  if (db.prepare("SELECT COUNT(*) n FROM x_accounts").get().n >= MAX_ACCOUNTS) throw Object.assign(new Error(`At most ${MAX_ACCOUNTS} accounts.`), { status: 400 });
  let u = null;
  try {
    const r = await fetch(`https://api.fxtwitter.com/${handle}`, { headers: { "user-agent": "blix/1.0" }, signal: AbortSignal.timeout(8000) });
    u = (await r.json())?.user || null;
  } catch { /* added without details; the first post fills them in */ }
  db.prepare(`INSERT INTO x_accounts (handle, name, avatar, bio, followers, added) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(handle) DO UPDATE SET name = COALESCE(excluded.name, name), avatar = COALESCE(excluded.avatar, avatar), bio = COALESCE(excluded.bio, bio), followers = COALESCE(excluded.followers, followers)`)
    .run(u?.screen_name || handle, u?.name || null, u?.avatar_url || null, u?.description || null, u?.followers ?? null, now());
  queueSoon();
  return db.prepare("SELECT * FROM x_accounts WHERE handle = ?").get(handle);
}
export const removeAccount = (handle) => db.prepare("DELETE FROM x_accounts WHERE handle = ?").run(String(handle));
export const setAlerts = (handle, on) => db.prepare("UPDATE x_accounts SET alerts = ? WHERE handle = ?").run(on ? 1 : 0, String(handle));

// ---------- the feed ----------
const parseRow = (r) => ({ ...r, data: r.data ? JSON.parse(r.data) : {}, mints: r.mints ? JSON.parse(r.mints) : [], tickers: r.tickers ? JSON.parse(r.tickers) : [] });
export function feed({ handle = null, limit = 100, coins = false, since = 0 } = {}) {
  const where = ["t > ?"], args = [since];
  if (handle) { where.push("handle = ?"); args.push(handle); }
  if (coins) where.push("(mints != '[]' OR tickers != '[]')");
  return db.prepare(`SELECT * FROM x_posts WHERE ${where.join(" AND ")} ORDER BY t DESC LIMIT ?`).all(...args, Math.min(+limit || 100, 300)).map(parseRow);
}
export const changes = (limit = 50) => db.prepare("SELECT * FROM x_changes ORDER BY id DESC LIMIT ?").all(limit);

// Coins in a post: contract addresses (bare, or inside pump.fun / Axiom / GMGN / Photon / Birdeye / DexScreener
// token links) and $tickers. A 32-44 character base58 word is a Solana address; it is kept as a coin when it
// ends in "pump" (pump.fun) or sits in a trading link, so wallet addresses in a post are not called coins.
const B58 = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
const TRADE_LINK = /(pump\.fun|axiom\.trade|gmgn\.ai|photon-sol|birdeye\.so|dexscreener\.com|jup\.ag|bullx|padre|fomo\.family|solscan\.io\/token|neo\.bullx)/i;
export function coinsIn(text, urls = []) {
  const mints = new Set(), tickers = new Set();
  for (const m of String(text).match(B58) || []) if (/pump$/i.test(m)) mints.add(m);
  for (const u of urls) if (TRADE_LINK.test(u)) for (const m of u.match(B58) || []) mints.add(m);
  for (const m of String(text).matchAll(/(?:^|[\s(])\$([A-Za-z][A-Za-z0-9]{1,11})\b/g)) tickers.add(m[1].toUpperCase());
  return { mints: [...mints].slice(0, 6), tickers: [...tickers].filter((t) => !["USD", "USDC", "USDT"].includes(t)).slice(0, 8) };
}

// ---------- reading X through Aside ----------
// Runs inside the tracker tab. Installs the hook once per page load, sends X to the search, waits for X's
// answer and returns the posts trimmed to what Blix keeps.
const IN_TAB = (query) => `
  const q = ${JSON.stringify(query)};
  if (!window.__blixX) {
    window.__blixX = [];
    const keep = (u, text) => { if (/SearchTimeline/.test(String(u))) { window.__blixX.push({ t: Date.now(), text }); if (window.__blixX.length > 4) window.__blixX.shift(); } };
    const of = window.fetch;
    window.fetch = async (...a) => { const r = await of(...a); try { const u = String(a[0]?.url || a[0]); if (/SearchTimeline/.test(u)) r.clone().text().then((t) => keep(u, t)).catch(() => {}); } catch {} return r; };
    const oo = XMLHttpRequest.prototype.open, os = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u, ...rest) { this.__u = u; return oo.call(this, m, u, ...rest); };
    XMLHttpRequest.prototype.send = function (...a) { this.addEventListener("load", () => { try { keep(this.__u, this.responseText); } catch {} }); return os.apply(this, a); };
  }
  const startedAt = Date.now();
  // X answers a search it has seen from its own cache (no request, nothing to copy), so each check adds a
  // made-up word to leave out: the results are the same, the search is new.
  history.pushState({}, "", "/search?q=" + encodeURIComponent(q + " -blix" + Date.now().toString(36)) + "&f=live&blix=tracker");
  dispatchEvent(new PopStateEvent("popstate", { state: {} }));
  return startedAt;`;

const READ = `
  const x = (window.__blixX || []).filter((c) => c.t >= since).pop();
  if (!x) return null;
  let j; try { j = JSON.parse(x.text); } catch { return { error: "X answered with something that is not JSON." }; }
  const ins = j?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions || [];
  const items = ins.flatMap((i) => i.entries || []).flatMap((e) => e.content?.itemContent ? [e.content.itemContent] : (e.content?.items || []).map((it) => it.item?.itemContent)).filter(Boolean);
  const user = (u) => { u = u?.result || u; if (!u) return null; return { handle: u.core?.screen_name || u.legacy?.screen_name, name: u.core?.name || u.legacy?.name,
    avatar: u.avatar?.image_url || u.legacy?.profile_image_url_https, bio: u.legacy?.description ?? u.profile_bio?.description ?? null, followers: u.legacy?.followers_count ?? null }; };
  const tweet = (t) => {
    t = t?.tweet || t; if (!t?.legacy) return null;
    const L = t.legacy, note = t.note_tweet?.note_tweet_results?.result;
    let text = note?.text || L.full_text || "";
    // X hides the leading @mentions of a reply (display_text_range, in code points); so does Blix.
    if (!note && Array.isArray(L.display_text_range)) text = Array.from(text).slice(L.display_text_range[0], L.display_text_range[1]).join("");
    const urls = [...(note?.entity_set?.urls || []), ...(L.entities?.urls || [])];
    for (const u of urls) if (u.url && u.expanded_url) text = text.split(u.url).join(u.expanded_url);
    const media = (L.extended_entities?.media || L.entities?.media || []).map((m) => { text = text.split(m.url).join(""); return { type: m.type, url: m.media_url_https, video: m.video_info?.variants?.filter((v) => v.content_type === "video/mp4").sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0]?.url || null }; });
    return { id: t.rest_id, t: Date.parse(L.created_at), user: user(t.core?.user_results), text: text.trim(), urls: urls.map((u) => u.expanded_url).filter(Boolean),
      media, replyTo: L.in_reply_to_screen_name || null, likes: L.favorite_count, reposts: L.retweet_count, replies: L.reply_count, views: +t.views?.count || null };
  };
  const out = [];
  for (const it of items) {
    const r = it.tweet_results?.result; const t = tweet(r); if (!t) continue;
    const rt = r?.legacy?.retweeted_status_result?.result || r?.tweet?.legacy?.retweeted_status_result?.result;
    const qt = r?.quoted_status_result?.result || r?.tweet?.quoted_status_result?.result;
    if (rt) t.repost = tweet(rt);
    if (qt) t.quote = tweet(qt);
    out.push(t);
  }
  return { posts: out };`;

function aside(script, timeoutMs = 100_000) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(ASIDE_EXE)) return reject(new Error("Aside isn't installed (its CLI was not found)."));
    const code = `await eval("(async () => {" + atob("${Buffer.from(script, "utf8").toString("base64")}") + "})()");`;
    const child = spawn(ASIDE_EXE, ["repl", code], { windowsHide: true });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d)); child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => { child.kill(); reject(new Error("Aside took too long reading X.")); }, timeoutMs);
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", () => {
      clearTimeout(timer);
      const line = out.split(/\r?\n/).reverse().find((l) => l.trim().startsWith('{"xtrack"'));
      if (!line) return reject(new Error((out + err).replace(/\x1b\[[0-9;]*m/g, "").trim().slice(0, 300) || "No answer from Aside."));
      try { resolve(JSON.parse(line)); } catch { reject(new Error("Aside's answer could not be read.")); }
    });
  });
}

// One check: find the tracker tab, run the search, wait (up to 60 s; a background tab is slow) for X's answer.
async function readX(query) {
  const script = `
const all = await listBrowserTabs();
const tab = all.find((t) => /^https:\\/\\/(x|twitter)\\.com\\//.test(t.url || "") && /[?&]blix=tracker/.test(t.url || ""));
if (!tab) { console.log(JSON.stringify({ xtrack: 1, error: "no-tab" })); return; }
const pg = await attachBrowserTab(tab.targetId);
const since = await pg.evaluate(() => { ${IN_TAB(query)} });
let res = null;
const t0 = Date.now();
while (!res && Date.now() - t0 < 60000) { await sleep(700); res = await pg.evaluate((since) => { ${READ} }, since); }
console.log(JSON.stringify({ xtrack: 1, ...(res || { error: "X did not answer the search within a minute (is the tab still signed in?)" }) }));
`;
  return aside(script);
}

// ---------- fallback: FxTwitter ----------
// Free and needs no browser, but its timelines can be about an hour behind. Used for a check whenever the
// Aside tab cannot be read (no tab, Aside stuck), so the feed keeps filling, just later.
const fxUser = (u) => u && { handle: u.screen_name, name: u.name, avatar: u.avatar_url || null, bio: u.description ?? null, followers: u.followers ?? null };
const fxMedia = (m) => [...(m?.photos || []).map((x) => ({ type: "photo", url: x.url, video: null })), ...(m?.videos || []).map((x) => ({ type: "video", url: x.thumbnail_url || x.url, video: x.url }))];
const fxTweet = (t) => t && { id: t.id, t: (t.created_timestamp || 0) * 1000, user: fxUser(t.author), text: t.text || t.raw_text?.text || "", urls: (String(t.text || "").match(/https?:\/\/\S+/g) || []),
  media: fxMedia(t.media), replyTo: t.replying_to?.screen_name || t.replying_to || null, likes: t.likes, reposts: t.reposts, replies: t.replies, views: t.views ?? null };
async function readFx(handles) {
  const posts = [];
  for (const h of handles.slice(0, 10)) {
    try {
      const r = await fetch(`https://api.fxtwitter.com/2/profile/${h}/statuses`, { headers: { "user-agent": "blix/1.0" }, signal: AbortSignal.timeout(8000) });
      for (const t of (await r.json())?.results || []) {
        const p = fxTweet(t);
        if (t.reposted_by) { const by = fxUser(t.reposted_by); posts.push({ ...p, user: by, text: "", repost: p, media: [] }); }
        else { if (t.quote) p.quote = fxTweet(t.quote); posts.push(p); }
      }
    } catch { /* next account */ }
  }
  return posts;
}

// ---------- the loop ----------
const insertPost = db.prepare(`INSERT OR IGNORE INTO x_posts (id, handle, name, avatar, t, text, data, mints, tickers, seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const getAcc = db.prepare("SELECT * FROM x_accounts WHERE handle = ?");
function store(posts, tracked) {
  const fresh = [], allMints = new Set();
  for (const p of posts) {
    const author = p.user?.handle;
    if (!p.id || !author || !tracked.has(author.toLowerCase())) continue;
    const body = [p.text, p.quote?.text, p.repost?.text].filter(Boolean).join("\n");
    const { mints, tickers } = coinsIn(body, [...(p.urls || []), ...(p.quote?.urls || []), ...(p.repost?.urls || [])]);
    const data = { urls: p.urls, media: p.media, replyTo: p.replyTo, likes: p.likes, reposts: p.reposts, replies: p.replies, views: p.views,
      quote: p.quote ? { id: p.quote.id, t: p.quote.t, user: p.quote.user, text: p.quote.text, media: p.quote.media } : null,
      repost: p.repost ? { id: p.repost.id, t: p.repost.t, user: p.repost.user, text: p.repost.text, media: p.repost.media } : null };
    const r = insertPost.run(p.id, author, p.user.name, p.user.avatar, p.t || now(), p.text, JSON.stringify(data), JSON.stringify(mints), JSON.stringify(tickers), now());
    if (r.changes) { fresh.push({ id: p.id, handle: author, name: p.user.name, avatar: p.user.avatar, t: p.t, text: p.text, data, mints, tickers }); mints.forEach((m) => allMints.add(m)); }
    // Profile changes, from the copy of the profile every post carries.
    const a = getAcc.get(author);
    if (a) {
      for (const [field, val] of [["name", p.user.name], ["avatar", p.user.avatar], ["bio", p.user.bio]]) {
        // Bios come back with t.co links from X but expanded links from FxTwitter: compare them without links.
        const bare = (v) => String(v).replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
        // The same picture comes in several sizes (_normal, _200x200, _400x400): compare it without the size.
        const pic = (v) => String(v).replace(/_(normal|bigger|mini|\d+x\d+)(\.\w+)$/, "$2");
        if (val == null || a[field] == null || a[field] === val || (field === "bio" && bare(a[field]) === bare(val)) || (field === "avatar" && pic(a[field]) === pic(val))) continue;
        db.prepare("INSERT INTO x_changes (t, handle, field, old, new) VALUES (?, ?, ?, ?, ?)").run(now(), author, field, a[field], val);
        logEvent("x", `@${author} changed ${field === "avatar" ? "profile picture" : field}${field === "avatar" ? "" : `: "${String(val).slice(0, 80)}"`}`);
      }
      db.prepare("UPDATE x_accounts SET name = COALESCE(?, name), avatar = COALESCE(?, avatar), bio = COALESCE(?, bio), followers = COALESCE(?, followers), last_post = MAX(COALESCE(last_post, 0), ?) WHERE handle = ?")
        .run(p.user.name, p.user.avatar, p.user.bio, p.user.followers, p.t || 0, author);
    }
  }
  return { fresh, mints: [...allMints] };
}

// Searches of at most QUERY_MAX characters; each check reads the next one, so 200 accounts take ~10 checks.
function chunks(handles) {
  const out = []; let cur = [];
  for (const h of handles) {
    const next = [...cur, h];
    if (cur.length && next.map((x) => `from:${x}`).join(" OR ").length > QUERY_MAX) { out.push(cur); cur = [h]; } else cur = next;
  }
  if (cur.length) out.push(cur);
  return out;
}

let timer = null, soon = false, asideBackoff = 0;
const queueSoon = () => { soon = true; };
export async function runOnce() {
  if (xState.running) return xState;
  const list = accounts();
  if (!list.length) return xState;
  xState.running = true; xState.lastRun = now(); const t0 = now();
  try {
    const parts = chunks(list.map((a) => a.handle));
    const part = parts[xState.chunk % parts.length]; xState.chunk++;
    let posts = null, problem = null;
    if (now() >= asideBackoff) {
      try {
        const r = await readX(part.map((h) => `from:${h}`).join(" OR "));
        if (r.error === "no-tab") { xState.tab = false; problem = "no-tab"; }
        else if (r.error) problem = r.error;
        else { xState.tab = true; posts = r.posts || []; }
      } catch (e) { problem = e.message; }
      // Aside's automation can jam (every tab answers "CDP command timeout"); stop asking it for 5 minutes.
      if (problem && problem !== "no-tab") asideBackoff = now() + 5 * 60_000;
    } else problem = xState.lastAsideError || "Aside paused after an error";
    if (problem) xState.lastAsideError = problem;
    xState.source = posts ? "aside" : "fxtwitter";
    if (!posts) posts = await readFx(part);
    const { fresh, mints } = store(posts, new Set(list.map((a) => a.handle.toLowerCase())));
    if (problem && xState.source === "fxtwitter" && !posts.length) throw new Error(problem);
    xState.posts += fresh.length; xState.lastOk = now(); xState.lastError = null;
    if (xState.source === "aside") xState.lastAsideError = null;
    if (fresh.length) {
      onNew?.(fresh);
      for (const p of fresh.filter((x) => x.mints.length)) logEvent("x", `@${p.handle} posted ${p.mints.map((m) => m.slice(0, 4) + "…" + m.slice(-4)).join(", ")}: ${p.text.slice(0, 100)}`);
    }
    if (mints.length) onMints?.(mints);
  } catch (e) { xState.lastError = e.message; }
  finally { xState.running = false; xState.runs++; xState.ms = now() - t0; }
  return xState;
}

export function startXTrack() {
  let last = 0;
  timer = setInterval(() => {
    if (xState.running) return;
    if (!soon && now() - last < (xState.tab === false ? 15_000 : EVERY_MS)) return;
    soon = false; last = now();
    runOnce().catch(() => {});
  }, 3000);
  timer.unref?.();
  // Keep the table small: posts older than 14 days go.
  setInterval(() => db.prepare("DELETE FROM x_posts WHERE t < ?").run(now() - 14 * 864e5), 3600e3).unref?.();
}

export function status() {
  const n = db.prepare("SELECT COUNT(*) n FROM x_accounts").get().n;
  return { ...xState, accounts: n, tabUrl: TAB_URL, everySec: EVERY_MS / 1000,
    asidePausedFor: Math.max(0, asideBackoff - now()),
    state: !n ? "empty" : xState.tab === false && xState.source !== "fxtwitter" ? "no-tab" : xState.lastError ? "error" : xState.lastOk ? (xState.source === "fxtwitter" ? "fallback" : "ok") : "starting" };
}
