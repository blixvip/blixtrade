// Fomo's leaderboard (fomo.family/leaderboard) and its traders' profiles, read through the user's own Aside
// browser, where they are signed in to Fomo. Fomo serves the leaderboard and profiles only to signed-in
// accounts, so Blix opens a fomo.family tab in Aside for a few seconds and asks Fomo's own web client (its
// fomoFetch module, which carries the session) for the data. Nothing is guessed: each row is what Fomo
// showed, stored per day so the page can show any day's board.
//
// Once a day: the four leaderboards (24h, 7d, 30d, all time) and the clans, then the profiles of the traders
// worth following (top FOLLOW_24H by 24h PnL, top FOLLOW_7D by 7d PnL). A profile opened on the Top traders
// page is read on demand and kept PROFILE_TTL.
//
// Wallets: the "address" Fomo shows is its own account id, not the wallet that trades (fomoresolve.js), so
// each followed trader's real wallet is found on chain from their swaps and only that wallet is followed
// (source 'fomo', with their handle). A wallet Blix followed this way is paused after PAUSE_DAYS off both
// lists; wallets you follow or unfollow yourself are left as you set them.
import { canBrowse, hasAside, runRepl as runScript, signedOutText } from "./browser.js";
import { fomoFetch, fomoToken, fomoTokenKnown } from "./fomochart.js";
import { db, logEvent } from "./db.js";
import * as sol from "./solana.js";
import { resolveAndStore, walletFor } from "./fomoresolve.js";
import { offChain, offSwap } from "./chains.js";
import { warmBoard } from "./feedwarm.js";
import { holderSummary, parseKnownTokens, knownKey, SOL_NETWORK } from "./known-holders.js";

export const RANGES = ["24h", "7d", "30d", "all-time"];
const FOLLOW_24H = 15, FOLLOW_7D = 10, PAUSE_DAYS = 7;
const HOUR = 3600e3, DAY = 24 * HOUR, PROFILE_TTL = 6 * HOUR, PER_CALL = 3;
const now = () => Date.now();
const today = (t = now()) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

db.exec(`
CREATE TABLE IF NOT EXISTS fomo_board (
  day TEXT, range TEXT, rank INTEGER, address TEXT, handle TEXT, name TEXT, pic TEXT, pnl REAL, volume REAL,
  trades INTEGER, followers INTEGER, holdings INTEGER, top TEXT, clan TEXT, t INTEGER,
  PRIMARY KEY (day, range, rank)
);
CREATE INDEX IF NOT EXISTS fomo_board_addr ON fomo_board(address, day);
CREATE TABLE IF NOT EXISTS fomo_board_runs (t INTEGER PRIMARY KEY, ok INTEGER, rows INTEGER, followed INTEGER, error TEXT, ms INTEGER);
CREATE TABLE IF NOT EXISTS fomo_clans (
  day TEXT, range TEXT, rank INTEGER, id TEXT, name TEXT, icon TEXT, pnl REAL, members INTEGER, top TEXT, t INTEGER,
  PRIMARY KEY (day, range, rank)
);
CREATE TABLE IF NOT EXISTS fomo_board_follows (address TEXT PRIMARY KEY, first INTEGER, last_top INTEGER, paused INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS fomo_profiles (uid TEXT PRIMARY KEY, handle TEXT, data TEXT, t INTEGER);
CREATE INDEX IF NOT EXISTS fomo_profiles_handle ON fomo_profiles(handle);
`);
for (const col of ["uid TEXT", "badge TEXT", "verified INTEGER"]) { try { db.exec(`ALTER TABLE fomo_board ADD COLUMN ${col}`); } catch {} }
try { db.exec("CREATE INDEX IF NOT EXISTS fomo_board_handle ON fomo_board(handle, day)"); } catch {}

// ---------- talking to Fomo through Aside ----------
// `body` runs inside a fomo.family tab with `fn` = Fomo's own fetch (path, init) and must return a JSON-able
// value. Returns that value, or throws { signedOut } when Fomo says the session is gone.
const FIND_FN = `
    const man = JSON.stringify(window.__reactRouterManifest || {});
    const urls = [...performance.getEntriesByType("resource").map((e) => e.name), ...[...document.querySelectorAll("link[rel=modulepreload],script[src]")].map((l) => l.href || l.src), ...(man.match(/\\/assets\\/[^"]+\\.js/g) || [])];
    const ff = urls.find((n) => /\\/fomoFetch-[^/]*\\.js/.test(n));
    if (!ff) return null;
    const m = await import(ff);
    const fn = Object.values(m).find((v) => typeof v === "function" && /statusCode:401|Authorization|timing:\{|timeoutMs/.test(String(v)));
    if (!fn) return { error: "Fomo's web client changed: its fetch function was not found." };
    const get = async (p) => { const x = await fn(p, { method: "GET" }); if (x.statusCode === 401) throw new Error("signed-out"); return x.statusCode === 200 ? x.responseObject : null; };`;

// The same body run here, with Fomo's API answering the server's own Fomo token (fomochart.js): no tab, no
// queue. Only when the token is at hand; otherwise the tab way below.
const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
async function here(body) {
  const fn = (p, init = {}) => fomoFetch(p, { method: init.method || "GET", body: init.body });
  const get = async (p) => { const x = await fn(p, { method: "GET" }); if (x.statusCode === 401) throw new Error("signed-out"); return x.statusCode === 200 ? x.responseObject : null; };
  try {
    const value = await new AsyncFn("fn", "get", body)(fn, get);
    boardState.signedOut = false;
    return value;
  } catch (e) {
    if (e.message === "signed-out") { boardState.signedOut = true; throw Object.assign(new Error(signedOutText()), { signedOut: true }); }
    throw e;
  }
}
export function inFomo(body, url = "https://fomo.family/leaderboard", { pri = 1, timeoutMs = 115e3 } = {}) {
  // Fomo answers the server's own Node fetch with 430 "unauthorized" (2026-10-08, lists and board too), yet the same
  // token works from the headless browser's fomo.family tab: there, read through the tab.
  if (fomoTokenKnown()) return hasAside() ? here(body) : inFomoTab(body, { pri, timeoutMs });
  // A fomo.family tab that is already open and working is used as is (only read from; nothing in it changes),
  // because a fresh Aside tab sometimes never starts Fomo's sign-in layer ("No global PrivyClient instance").
  // Otherwise a new tab opens for this call and closes with it.
  const script = `
const run = async (page, tries) => {
  let res = null;
  for (let i = 0; i < tries && !res; i++) {
    if (i) await new Promise((r) => setTimeout(r, 1500));
    try {
      res = await page.evaluate(async () => {
        ${FIND_FN}
        try { return { value: await (async () => { ${body} })() }; } catch (e) { return { error: e.message === "signed-out" ? "signed-out" : e.message }; }
      });
    } catch (e) { res = null; }
    if (res && res.error && /PrivyClient|Privy/i.test(res.error)) res = null;
  }
  return res;
};
let res = null, via = "tab";
const all = await listBrowserTabs();
// Blix's own Fomo tab first (opened from Blix's "Connect Fomo" button: fomo.family/?blix=fomo), then any.
const fomoTabs = all.filter((t) => String(t.url || "").startsWith("https://fomo.family/")).sort((a, b) => (String(b.url).includes("blix=fomo") ? 1 : 0) - (String(a.url).includes("blix=fomo") ? 1 : 0));
for (const t of fomoTabs.slice(0, 3)) {
  try { res = await run(await attachBrowserTab(String(t.id).replace(/^tab:/, "")), 1); } catch (e) { res = null; }
  if (res) break;
}
if (!res) {
  // No working Fomo tab: open one for this call (it closes when the call ends), then put the tab the user
  // was looking at back in front, since opening a tab brings it forward.
  via = "opened";
  const prev = all.find((t) => t.active);
  res = await run(await openTab(${JSON.stringify(url)}), 12);
  if (prev) { try { await (await attachBrowserTab(String(prev.id).replace(/^tab:/, ""))).bringToFront(); } catch (e) {} }
}
console.log(JSON.stringify({ fomoboard: 1, via, ...(res || { error: "fomo.family did not load in Aside." }) }));
`;
  return repl(script, timeoutMs, pri).then((r) => {
    if (r.error === "signed-out") { boardState.signedOut = true; throw Object.assign(new Error(signedOutText()), { signedOut: true }); }
    asideState.hasTab = r.via !== "opened";
    if (r.error) throw new Error(r.error);
    boardState.signedOut = false;
    return r.value;
  });
}

// Fomo's /hodlers and /feed/token turn the server's own fetch away (430 "unauthorized") even with a good token,
// yet answer the same token from a real browser (checked 2026-10-08 on the VM: 200 in ~0.5 s). So on the server
// (headless Chromium, no Aside) the coin reads run in the kept fomo.family tab with the token the PC relays
// (fomorelay.js): no sign-in needed in that tab. Through the same one-at-a-time queue as every browser read.
async function inFomoTab(body, { pri = 1, timeoutMs = 60e3 } = {}) {
  // The same 60 s as fomoTokenKnown: with fomoToken's default 5 min, a token with 1-5 min left and a failed renewal
  // sent this back into inFomo, which sent it straight back here, a loop with no real wait that froze the radar.
  const tok = await fomoToken(60_000).catch(() => null);
  if (!tok) throw new Error("No usable Fomo sign-in token right now.");
  const script = `
const page = await openTab("https://fomo.family/");
const res = await page.evaluate(async ({ tok }) => {
  const fn = async (p, init = {}) => {
    const r = await fetch("https://prod-api.fomo.family" + p, { method: init.method || "GET", headers: { Authorization: "Bearer " + tok } });
    let j = null; try { j = await r.json(); } catch (e) {}
    return { statusCode: r.status === 431 ? 401 : r.status, responseObject: j && j.responseObject !== undefined ? j.responseObject : null };
  };
  const get = async (p) => { const x = await fn(p); if (x.statusCode === 401) throw new Error("signed-out"); return x.statusCode === 200 ? x.responseObject : null; };
  try { return { value: await (async () => { ${body} })() }; } catch (e) { return { error: e.message === "signed-out" ? "signed-out" : e.message }; }
}, { tok: ${JSON.stringify(tok)} }).catch((e) => ({ error: String(e.message).slice(0, 200) }));
console.log(JSON.stringify({ fomoboard: 1, via: "tab", ...res }));
`;
  const r = await repl(script, timeoutMs, pri);
  if (r.error === "signed-out") { boardState.signedOut = true; throw Object.assign(new Error(signedOutText()), { signedOut: true }); }
  if (r.error) throw new Error(r.error);
  boardState.signedOut = false;
  return r.value;
}
// The coin reads: in the browser with the relayed token on the server; through Aside's signed-in tab on the PC.
const coinRead = (body, opts) => (!hasAside() && fomoTokenKnown() ? inFomoTab(body, opts) : inFomo(body, undefined, opts));

// One Aside call at a time (Fomo should see one reader, and Aside jams when it is driven from several
// places at once), highest priority first: 0 = a page someone is looking at, 1 = background (the daily
// board, profiles). Background work comes in short batches, so a page waits for one batch at most.
const queue = [];
let running = false;
function repl(inner, timeoutMs = 115e3, pri = 1) {
  return new Promise((resolve, reject) => {
    queue.push({ inner, timeoutMs, pri, resolve, reject, t: now() });
    queue.sort((a, b) => a.pri - b.pri || a.t - b.t);
    pump();
  });
}
// When Aside's automation jams ("CDP command timeout", seen after heavy use from several places), every
// call fails for a while and more calls make it worse: pause two minutes, failing calls at once meanwhile.
export const asideState = { pausedUntil: 0, lastError: null, hasTab: null };
function pump() {
  if (running || !queue.length) return;
  const job = queue.shift();
  if (now() < asideState.pausedUntil) { job.reject(new Error("Aside is busy; Blix tries again in a minute or two.")); return pump(); }
  running = true;
  runRepl(job.inner, job.timeoutMs).then(job.resolve, (e) => {
    asideState.lastError = e.message;
    if (/CDP command timeout|Page\.enable|isn't running|other side closed|took too long/i.test(e.message)) asideState.pausedUntil = now() + 2 * 60_000;
    job.reject(e);
  }).finally(() => { running = false; pump(); });
}
export const asideQueue = () => ({ running, waiting: queue.length, paused: now() < asideState.pausedUntil, hasTab: asideState.hasTab });
// In Aside on the owner's PC, in the server's own headless browser elsewhere (browser.js).
const runRepl = (inner, timeoutMs) => runScript(inner, { marker: "fomoboard", timeoutMs, what: "Fomo" });

// The leaderboards and clans. Fomo's clan windows are named 24h, 7d, 30d, all.
const BOARD_BODY = `
    const ranges = ${JSON.stringify(RANGES)};
    const lists = {}, clans = {};
    for (const r of ranges) {
      const o = await get(r === "all-time" ? "/v2/leaderboard" : "/v2/leaderboard/" + r);
      if (!o) throw new Error("Fomo did not answer for the " + r + " leaderboard.");
      lists[r] = (o.leaderboard || []).map((u) => ({
        uid: u.id, address: u.address, handle: u.userHandle, name: u.displayName, pic: u.profilePictureLink, verified: u.verified,
        pnl: r === "24h" ? u.pnl24h : r === "7d" ? u.pnl7d : r === "30d" ? u.pnl30d : u.totalPnL,
        volume: u.totalVolume, trades: u.numTrades, followers: u.followers, holdings: u.totalHoldings, clan: u.clan?.name || null, badge: u.badge?.title || null,
        top: (u.topHoldings || []).slice(0, 3).map((h) => ({ mint: h.tokenAddress, chain: h.networkId, img: h.imageUrl, value: h.value, pnl: h.pnl })),
      }));
      const c = await get("/v2/clans/leaderboard?window=" + (r === "all-time" ? "all" : r) + "&limit=50");
      clans[r] = ((c && c.leaderboard) || []).map((x, i) => ({
        id: x.id, name: x.name, icon: x.iconLink, rank: x.rank ?? i + 1, pnl: x.pnl, members: x.memberCount,
        top: (x.topMembers || []).slice(0, 3).map((m) => ({ handle: m.user?.userHandle, name: m.user?.displayName, pic: m.user?.profilePictureLink })),
      }));
    }
    return { lists, clans };`;

// Profiles: everything a Fomo profile page shows, trimmed to what Blix draws. uids/handles are inlined.
const profileBody = (who) => `
    const who = ${JSON.stringify(who)};
    const out = [];
    const iso = (ms) => new Date(Date.now() - ms).toISOString();
    for (const w of who) {
      const u = w.uid ? await get("/v2/users/" + w.uid) : await get("/v2/users/userHandle/" + encodeURIComponent(w.handle));
      if (!u) { out.push({ handle: w.handle, missing: true }); continue; }
      const id = u.id;
      const [spot, bal, swaps, s24, s7, s30, sall] = await Promise.all([
        get("/v2/users/" + id + "/spotlight"), get("/v2/users/" + id + "/balances"), get("/v2/users/" + id + "/swaps"),
        get("/v2/userTokens/aggregatedSnapshot?userId=" + id + "&timestamp=" + iso(864e5)),
        get("/v2/userTokens/aggregatedSnapshot?userId=" + id + "&timestamp=" + iso(7 * 864e5)),
        get("/v2/userTokens/aggregatedSnapshot?userId=" + id + "&timestamp=" + iso(30 * 864e5) + "&interval=4"),
        get("/v2/userTokens/aggregatedSnapshot/interval?userId=" + id),
      ]);
      // Solana swaps for finding the wallet on chain: page back (Fomo's cursor is the last swap id) until 25 or 4 pages.
      const sol = [];
      let page = swaps, pages = 0;
      while (page && pages < 4) {
        for (const s of page.swaps || []) if (s.networkId === 1399811149 && (s.inNetworkId ?? 1399811149) === 1399811149 && (s.outNetworkId ?? 1399811149) === 1399811149) sol.push(s);
        const lastId = (page.swaps || []).slice(-1)[0]?.id;
        if (sol.length >= 25 || !page.hasNextPage || !lastId) break;
        page = await get("/v2/users/" + id + "/swaps?lastSwapIdV2=" + lastId); pages++;
      }
      const pts = (a) => (a || []).map((p) => [p.snapshotId, p.pnl, p.equity]).sort((x, y) => x[0] - y[0]);
      out.push({
        uid: id, handle: u.userHandle, name: u.displayName, pic: u.profilePictureLink, cover: u.coverPhotoLink, bio: u.description,
        address: u.address, evm: u.evmAddress, joined: u.createdAt, verified: u.verified, followers: u.followers, following: u.following,
        trades: u.numTrades, swaps: u.swapCount, volume: u.totalVolume, avgHold: u.averageHoldTimeSeconds, twitter: u.twitter,
        clan: u.clan ? { id: u.clan.id, name: u.clan.name, icon: u.clan.iconLink } : null,
        badge: u.badge ? { title: u.badge.title, rank: u.badge.metadata?.rank ?? null, pnl: u.badge.metadata?.totalPnL ?? null } : null,
        best: ((spot && spot.bestTrades) || []).map((b) => { const t = b.trade || {}, m = t.tokenMetadata || {}; return {
          mint: t.tokenAddress, chain: t.networkId, symbol: m.symbol, img: m.imageLargeUrl, opened: t.createdAt, closed: t.closedAt,
          realized: t.realizedPnlUsd, unrealized: t.unrealizedPnlUsd, cost: t.totalCostBasis, entry: t.avgEntryPrice, exit: t.avgExitPrice, price: m.currentPrice,
          comment: b.comment?.comment || null }; }),
        positions: ((bal && bal.balances) || []).map((b) => { const f = b.tokenFilterResult || {}, tk = f.token || {}, ut = b.userToken || {}; return {
          mint: tk.address || b.balance?.tokenAddress, chain: tk.networkId, symbol: tk.symbol, name: tk.name, img: tk.info?.imageThumbUrl || tk.info?.imageSmallUrl,
          amount: b.balance?.shiftedBalance ?? ut.humanAmountRemaining, price: +f.priceUSD || null, mcap: +f.marketCap || null, change24: f.change24 != null ? +f.change24 : null,
          entry: ut.averageEntryPriceUsd ?? null, cost: ut.currentCostBasisUsd ?? null, realized: ut.totalRealizedPnlUsd ?? null, since: ut.holdingSince || null,
          launchpad: tk.launchpad?.launchpadIconUrl || null }; }),
        recent: ((swaps && swaps.swaps) || []).slice(0, 40).map((s) => ({ t: s.createdAt, in: s.inTokenAddress, inAmt: s.inHumanAmount, out: s.outTokenAddress, outAmt: s.outHumanAmount,
          usd: s.humanUsdAmountIn, chain: s.networkId, inChain: s.inNetworkId, outChain: s.outNetworkId })),
        rawSwaps: sol.slice(0, 25),
        chart: { "24h": pts(s24), "7d": pts(s7), "30d": pts(s30), "all-time": pts(sall) },
      });
    }
    return out;`;

// ---------- storing ----------
export const boardState = { running: false, last: null, error: null, signedOut: false, next: null, profiles: { queued: 0, done: 0 }, wallets: { queued: 0, done: 0, current: null } };
const num = (v) => (v == null || !isFinite(+v) ? null : +v);
const int = (v) => (v == null || !isFinite(+v) ? null : Math.round(+v));
const safeJson = (s, d = []) => { try { return JSON.parse(s ?? "null") ?? d; } catch { return d; } };

function store(lists, clans, t) {
  const day = today(t);
  const ins = db.prepare(`INSERT INTO fomo_board (day, range, rank, address, handle, name, pic, pnl, volume, trades, followers, holdings, top, clan, t, uid, badge, verified)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insC = db.prepare("INSERT INTO fomo_clans (day, range, rank, id, name, icon, pnl, members, top, t) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  let n = 0;
  db.exec("BEGIN");
  try {
    for (const r of RANGES) {
      const list = lists[r] || [];
      if (list.length) {
        db.prepare("DELETE FROM fomo_board WHERE day = ? AND range = ?").run(day, r);
        list.forEach((u, i) => { ins.run(day, r, i + 1, u.address || null, u.handle || null, u.name || null, u.pic || null, num(u.pnl), num(u.volume), int(u.trades), int(u.followers), int(u.holdings), JSON.stringify(u.top || []), u.clan, t, u.uid || null, u.badge || null, u.verified ? 1 : 0); n++; });
      }
      const cl = clans?.[r] || [];
      if (cl.length) {
        db.prepare("DELETE FROM fomo_clans WHERE day = ? AND range = ?").run(day, r);
        cl.forEach((c, i) => insC.run(day, r, i + 1, c.id, c.name, c.icon || null, num(c.pnl), int(c.members), JSON.stringify(c.top || []), t));
      }
    }
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  return n;
}

function storeProfile(p) {
  if (!p?.uid) return;
  db.prepare("INSERT INTO fomo_profiles (uid, handle, data, t) VALUES (?, ?, ?, ?) ON CONFLICT(uid) DO UPDATE SET handle = excluded.handle, data = excluded.data, t = excluded.t")
    .run(p.uid, p.handle || null, JSON.stringify(p), now());
}
const profileRow = (uid) => db.prepare("SELECT * FROM fomo_profiles WHERE uid = ?").get(uid);

export async function fetchProfiles(who, pri = 1) {
  for (let i = 0; i < who.length; i += PER_CALL) {
    const part = who.slice(i, i + PER_CALL);
    const got = await inFomo(profileBody(part), undefined, { pri, timeoutMs: pri ? 115e3 : 40e3 });
    for (const p of got || []) storeProfile(p);
    boardState.profiles.done += part.length;
  }
}

// ---------- following the real wallets ----------
// The traders worth following on the latest board: top FOLLOW_24H by 24h PnL, top FOLLOW_7D by 7d PnL.
function followSet(day) {
  const q = (range, n) => db.prepare("SELECT uid, handle, name, address FROM fomo_board WHERE day = ? AND range = ? AND uid IS NOT NULL ORDER BY rank LIMIT ?").all(day, range, n);
  const seen = new Set(), out = [];
  for (const u of [...q("24h", FOLLOW_24H), ...q("7d", FOLLOW_7D)]) if (!seen.has(u.uid)) { seen.add(u.uid); out.push(u); }
  return out;
}

function followWallet(u, wallet, addWallet, t) {
  if (!wallet || !sol.validAddress(wallet)) return false;
  const had = db.prepare("SELECT source, watching FROM wallets WHERE address = ?").get(wallet);
  // Turned off on purpose (you unfollowed it, or Blix paused it as a bot): leave it off. Only a wallet this
  // module paused itself for falling off the board comes back.
  if (had && !had.watching && !db.prepare("SELECT 1 FROM fomo_board_follows WHERE address = ? AND paused = 1").get(wallet)) return false;
  try { addWallet(wallet, u.handle ? `@${u.handle}` : u.name || "Fomo top trader", "fomo"); } catch { return false; }
  db.prepare("UPDATE wallets SET fomo = 1 WHERE address = ?").run(wallet);
  if (u.handle) db.prepare("INSERT INTO fomo_handles (wallet, handle) VALUES (?, ?) ON CONFLICT(wallet) DO UPDATE SET handle = excluded.handle").run(wallet, u.handle);
  if (!had || had.source !== "you") {
    db.prepare(`INSERT INTO fomo_board_follows (address, first, last_top, paused) VALUES (?, ?, ?, 0)
      ON CONFLICT(address) DO UPDATE SET last_top = excluded.last_top, paused = 0`).run(wallet, t, t);
  }
  return true;
}

// Fomo account ids that an earlier version followed as if they were wallets: they never trade on chain.
function dropAccountIds(removeWallet) {
  const ids = db.prepare(`SELECT f.address FROM fomo_board_follows f JOIN wallets w ON w.address = f.address
    WHERE w.source = 'fomo' AND EXISTS (SELECT 1 FROM fomo_board b WHERE b.address = f.address)
    AND NOT EXISTS (SELECT 1 FROM fomo_wallets x WHERE x.wallet = f.address)`).all();
  for (const { address } of ids) {
    const traded = db.prepare("SELECT COUNT(*) n FROM wallet_trades WHERE wallet = ?").get(address).n;
    if (traded) continue;
    removeWallet(address);
    db.prepare("DELETE FROM fomo_board_follows WHERE address = ?").run(address);
  }
  return ids.length;
}

// Profiles, then wallets one trader at a time (each wallet search reads the chain for a minute or two),
// then follow the ones found. Runs in the background after the board is read.
let following = false;
async function followTop(addWallet, removeWallet) {
  if (following) return;
  following = true;
  try {
    const day = db.prepare("SELECT MAX(day) d FROM fomo_board").get().d;
    if (!day) return;
    const set = followSet(day);
    const stale = set.filter((u) => { const p = profileRow(u.uid); return !p || now() - p.t > DAY - HOUR; });
    boardState.profiles = { queued: stale.length, done: 0 };
    await fetchProfiles(stale.map((u) => ({ uid: u.uid, handle: u.handle })));
    dropAccountIds(removeWallet);
    const t = now();
    for (const u of set) followWallet(u, walletFor(u.uid)?.wallet, addWallet, t);   // the ones found earlier first
    // Each trader is searched at most once a day: an unverified or missing wallet is retried the next day.
    const todo = set.filter((u) => { const w = walletFor(u.uid); return !w || (now() - (w.checked || 0) > DAY && (!w.wallet || (w.matches || 0) < 2)); });
    boardState.wallets = { queued: todo.length, done: 0, current: null };
    for (const u of todo) {
      boardState.wallets.current = u.handle;
      const p = safeJson(profileRow(u.uid)?.data, null);
      if (p?.rawSwaps?.length) await resolveAndStore({ uid: u.uid, handle: u.handle, address: u.address, swaps: p.rawSwaps }).catch((e) => logEvent("error", `fomo wallet for @${u.handle}: ${e.message}`));
      followWallet(u, walletFor(u.uid)?.wallet, addWallet, t);   // follow each one as soon as it is found
      boardState.wallets.done++;
    }
    boardState.wallets.current = null;
    let n = 0;
    for (const u of set) if (followWallet(u, walletFor(u.uid)?.wallet, addWallet, t)) n++;
    // Off both lists for a week: stop following it (only the ones followed from the board, and only while still 'fomo').
    for (const f of db.prepare("SELECT address FROM fomo_board_follows WHERE paused = 0 AND last_top < ?").all(t - PAUSE_DAYS * DAY)) {
      db.prepare("UPDATE wallets SET watching = 0 WHERE address = ? AND source = 'fomo'").run(f.address);
      db.prepare("UPDATE fomo_board_follows SET paused = 1 WHERE address = ?").run(f.address);
    }
    logEvent("fomo", `Fomo top traders: ${n} real wallets followed of ${set.length}`);
  } catch (e) {
    boardState.error = e.message;
  } finally { following = false; }
}

let deps = null;
// `live`: a read for someone looking at the board now (boardLive below): the board only, the wallets and follows
// are left to the hourly schedule.
export async function refreshBoard(addWallet, removeWallet, { live = false } = {}) {
  deps = { addWallet, removeWallet };
  if (boardState.running) return boardState;
  boardState.running = true;
  const t0 = now();
  try {
    const r = await inFomo(BOARD_BODY);
    const rows = store(r.lists, r.clans, t0);
    if (!rows) throw new Error("Fomo returned empty leaderboards.");
    db.prepare("INSERT INTO fomo_board_runs (t, ok, rows, followed, error, ms) VALUES (?, 1, ?, ?, NULL, ?)").run(t0, rows, 0, now() - t0);
    logEvent("fomo", `Fomo leaderboard read: ${rows} rows`);
    boardState.last = t0; boardState.error = null;
    // Every range's avatars onto the page server's disk now, so the board opens with its pictures (feedwarm.js).
    try { warmBoard(db.prepare("SELECT pic, top FROM fomo_board WHERE day = (SELECT MAX(day) FROM fomo_board)").all()); } catch {}
    if (!live) followTop(addWallet, removeWallet);   // background: profiles, wallets, follows
  } catch (e) {
    db.prepare("INSERT INTO fomo_board_runs (t, ok, rows, followed, error, ms) VALUES (?, 0, 0, 0, ?, ?)").run(t0, e.message, now() - t0);
    boardState.error = e.message;
  } finally { boardState.running = false; }
  return boardState;
}

// While someone has the Top traders page open (each GET /api/fomo/board), Fomo's board is read again every BOARD_LIVE_MS
// (a read takes ~13 s and replaces today's rows), so the page follows Fomo's ranks through the day instead of the
// one morning read. After a failed read (Aside closed, signed out), every BOARD_LIVE_ERROR_MS.
const BOARD_LIVE_MS = 60_000, BOARD_LIVE_ERROR_MS = 5 * 60_000;
let liveTried = 0;
export function boardLive() {
  if (boardState.running || !deps) return;
  if (now() - Math.max(boardState.last || 0, liveTried) < (boardState.error ? BOARD_LIVE_ERROR_MS : BOARD_LIVE_MS)) return;
  liveTried = now();
  refreshBoard(deps.addWallet, deps.removeWallet, { live: true }).catch(() => {});
}

// ---------- reading it back ----------
function walletInfo(uid) {
  const w = uid ? walletFor(uid) : null;
  if (!w?.wallet) return { wallet: null, walletNote: w?.note || null };
  const t = db.prepare("SELECT watching FROM wallets WHERE address = ?").get(w.wallet);
  return { wallet: w.wallet, walletVerified: (w.matches || 0) >= 2, walletNote: w.note, tracked: Boolean(t?.watching) };
}

export function board({ range = "24h", day } = {}) {
  if (!RANGES.includes(range)) range = "24h";
  const days = db.prepare("SELECT DISTINCT day FROM fomo_board ORDER BY day DESC LIMIT 60").all().map((r) => r.day);
  const d = day && days.includes(day) ? day : days[0] || null;
  const rows = d ? db.prepare("SELECT * FROM fomo_board WHERE day = ? AND range = ? ORDER BY rank").all(d, range) : [];
  const prevDay = d ? days[days.indexOf(d) + 1] : null;
  const prev = new Map(prevDay ? db.prepare("SELECT handle, rank FROM fomo_board WHERE day = ? AND range = ?").all(prevDay, range).map((r) => [r.handle, r.rank]) : []);
  const lastRun = db.prepare("SELECT * FROM fomo_board_runs ORDER BY t DESC LIMIT 1").get() || null;
  const lastOk = db.prepare("SELECT t FROM fomo_board_runs WHERE ok = 1 ORDER BY t DESC LIMIT 1").get()?.t ?? null;
  const clans = d ? db.prepare("SELECT * FROM fomo_clans WHERE day = ? AND range = ? ORDER BY rank").all(d, range).map((c) => ({ ...c, top: safeJson(c.top) })) : [];
  const set = d ? followSet(d) : [];
  return {
    range, day: d, days, ranges: RANGES, prevDay, clans,
    rows: rows.map((r) => ({ ...r, top: (safeJson(r.top) || []).filter((h) => !offChain(h.chain)), prevRank: prev.get(r.handle) ?? null, days: daysOnBoard(r.handle, range), tracked: false, ...walletInfo(r.uid) })),
    status: { running: boardState.running, error: boardState.error, signedOut: boardState.signedOut, lastRun, lastOk, next: boardState.next, aside: hasAside(), browser: canBrowse(), profiles: boardState.profiles, wallets: boardState.wallets, working: following },
    follow: { top24h: FOLLOW_24H, top7d: FOLLOW_7D, pauseDays: PAUSE_DAYS, picked: set.length,
      resolved: set.filter((u) => walletFor(u.uid)?.wallet).length,
      following: db.prepare("SELECT COUNT(*) n FROM fomo_board_follows f JOIN wallets w ON w.address = f.address WHERE f.paused = 0 AND w.watching = 1").get().n },
  };
}
const daysOnBoard = (handle, range) => db.prepare("SELECT COUNT(*) n FROM fomo_board WHERE handle = ? AND range = ?").get(handle, range).n;

// One trader's page: their profile (read through Aside when missing or older than PROFILE_TTL, or on
// ?fresh=1), where they rank on each of today's boards, and their real wallet if found.
const inflight = new Map();
export async function trader(handle, { fresh = false } = {}) {
  handle = String(handle || "").replace(/^@/, "").trim();
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(handle)) throw Object.assign(new Error("Not a Fomo handle."), { status: 400 });
  const known = db.prepare("SELECT uid FROM fomo_board WHERE handle = ? COLLATE NOCASE AND uid IS NOT NULL ORDER BY day DESC LIMIT 1").get(handle)?.uid
    || db.prepare("SELECT uid FROM fomo_profiles WHERE handle = ? COLLATE NOCASE").get(handle)?.uid || null;
  let row = known ? profileRow(known) : null;
  if (fresh || !row || now() - row.t > PROFILE_TTL) {
    const key = known || handle.toLowerCase();
    if (!inflight.has(key)) inflight.set(key, fetchProfiles([{ uid: known, handle }], 0).finally(() => inflight.delete(key)));
    try { await inflight.get(key); } catch (e) { if (!row) throw e; }
    row = profileRow(known) || db.prepare("SELECT * FROM fomo_profiles WHERE handle = ? COLLATE NOCASE").get(handle);
  }
  const p = safeJson(row?.data, null);
  if (!p || p.missing) throw Object.assign(new Error(`Fomo has no trader @${handle}.`), { status: 404 });
  delete p.rawSwaps;
  // BNB Chain and Robinhood Chain coins stay off Blix (chains.js), in stored profiles too.
  if (Array.isArray(p.best)) p.best = p.best.filter((x) => !offChain(x.chain));
  if (Array.isArray(p.positions)) p.positions = p.positions.filter((x) => !offChain(x.chain));
  if (Array.isArray(p.recent)) p.recent = p.recent.filter((x) => !offSwap(x));
  const day = db.prepare("SELECT MAX(day) d FROM fomo_board").get().d;
  const ranks = {};
  for (const r of RANGES) {
    const x = day ? db.prepare("SELECT rank, pnl FROM fomo_board WHERE day = ? AND range = ? AND uid = ?").get(day, r, p.uid) : null;
    ranks[r] = x ? { rank: x.rank, pnl: x.pnl } : null;
  }
  const history = db.prepare("SELECT day, range, rank, pnl FROM fomo_board WHERE uid = ? ORDER BY day").all(p.uid);
  // Wallet: resolve in the background the first time someone opens this trader.
  const w = walletFor(p.uid);
  if (!w && deps && row) {
    const swaps = safeJson(row.data, {})?.rawSwaps;
    if (swaps?.length && !resolving.has(p.uid)) { resolving.add(p.uid); resolveAndStore({ uid: p.uid, handle: p.handle, address: p.address, swaps }).catch(() => {}).finally(() => resolving.delete(p.uid)); }
  }
  return { ...p, read: row?.t ?? null, ranks, day, history, ...walletInfo(p.uid), resolving: resolving.has(p.uid) };
}
const resolving = new Set();

// ---------- one coin: Fomo's known holders and theses ----------
// What Fomo's own coin page shows: the Fomo traders holding the coin (/hodlers/top: up to 99, biggest first,
// each with their position, PnL, average entry and the thesis they pinned) and the coin's theses (the
// "thesis" posts in /feed/token, newest first, each with the author's position). Read through Aside when a
// coin page asks, kept COIN_TTL, never awaited by the page: the first answer says it is loading.
const COIN_TTL = 3 * 60_000, SOL_NET = 1399811149;
db.exec("CREATE TABLE IF NOT EXISTS fomo_coin (mint TEXT PRIMARY KEY, data TEXT, t INTEGER)");
// One Fomo holder row as Blix keeps it (both the full coin read and the quick holders-only read below).
const HOLDER_FNS = `
    const thesis = (c) => c && c.comment ? { id: c.id, text: c.comment, likes: c.numLikes ?? c.reactions?.counts?.likeCount ?? 0, mcap: c.marketCapAtCreation ?? null, price: c.priceUsdAtCreation ?? null, t: c.createdAt } : null;
    const holder = (x) => ({
      handle: x.user?.userHandle, name: x.user?.displayName, pic: x.user?.profilePictureLink, followers: x.user?.followers ?? null, verified: !!x.user?.verified,
      amount: x.humanAmount ?? null, value: x.value ?? null, pnl: x.pnl ?? null, unrealized: x.unrealizedPnl ?? null, realized: x.realizedPnl ?? null,
      cost: x.costBasis ?? null, entry: x.averageEntryPrice ?? null, external: !!x.isExternallyReceived, dev: !!x.isDev, avgHold: x.averageHoldTimeSeconds ?? null,
      thesis: x.showComment === false ? null : thesis(x.comment) });`;
const coinBody = (mints) => `
    const net = ${SOL_NET};${HOLDER_FNS}
    // Every coin's holders in one request, then each coin's thesis feed, all at once.
    const h = await get("/hodlers/top?tokens=" + encodeURIComponent(JSON.stringify(${JSON.stringify(mints)}.map((address) => ({ address, networkId: net })))));
    if (!Array.isArray(h)) throw new Error("Fomo did not answer for the holders.");
    const one = async (mint) => {
      const top = h.find((x) => x.tokenAddress === mint) || {};
      const holders = (top.topHolders || []).map(holder);
      const theses = [], swaps = [];
      let lastId = null;
      // Three pages of the coin's feed (every size of trade): theses, and each Fomo trader's buys and sells for the
      // chart's faces (chartpeople.js). Most theses are the holders' pinned ones below.
      for (let page = 0; page < 3; page++) {
        const f = await get("/feed/token?tokenAddress=" + mint + "&networkId=" + net + "&threshold=0" + (lastId ? "&lastId=" + lastId : ""));
        const items = (f && f.items) || [];
        for (const i of items) if ((i.type === "swap_buy" || i.type === "swap_sell") && i.userHandle) swaps.push({ t: i.createdAt, buy: i.type === "swap_buy", usd: i.usdAmount ?? null,
          mc: i.marketCap ?? i.fdv ?? null, handle: i.userHandle, name: i.displayName, pic: i.profilePictureLink || null, dev: !!i.isDev });
        for (const i of items) if (i.type === "thesis" && i.comment) theses.push({ ...thesis(i.comment), handle: i.userHandle, name: i.displayName, pic: i.profilePictureLink, verified: !!i.verified, dev: !!i.isDev,
          replies: i.numReplies ?? 0, position: i.authorTrade ? { amount: i.authorTrade.humanTokenAmount, value: i.authorTrade.usdValue, unrealized: i.authorTrade.unrealizedPnlUsd, realized: i.authorTrade.realizedPnlUsd, pct: i.authorTrade.percentageUnrealizedPnl, closed: i.authorTrade.closedAt } : null });
        if (!f || !f.hasNextPage || !items.length) break;
        lastId = items[items.length - 1].id;
      }
      // Holders' pinned theses count too (Fomo shows them on the holder rows); one entry per thesis.
      const seen = new Set(theses.map((x) => x.id));
      for (const x of holders) if (x.thesis && !seen.has(x.thesis.id)) { seen.add(x.thesis.id); theses.push({ ...x.thesis, handle: x.handle, name: x.name, pic: x.pic, verified: x.verified, dev: x.dev, replies: 0,
        position: { amount: x.amount, value: x.value, unrealized: x.unrealized, realized: x.realized, pct: x.cost ? (x.unrealized / x.cost) * 100 : null, closed: null } }); }
      theses.sort((a, b) => (b.likes || 0) - (a.likes || 0) || String(b.t).localeCompare(String(a.t)));
      return [mint, { holders, totalHolders: top.totalHolders ?? null, theses, swaps }];
    };
    return Object.fromEntries(await Promise.all(${JSON.stringify(mints)}.map(one)));`;

// Coins waiting for a read: pages first (someone is looking), then coins on screen in lists (prefetch, so
// opening one is instant). Up to 8 coins go in one Aside call; a page's coin never waits behind a prefetch.
const coinState = new Map();   // mint -> { busy, error, tried }
const wantPage = new Set(), wantList = new Set(), urgent = new Set();   // urgent: read even if fresh (wantFomoFresh)
let coinLoop = null;
const fresh = (mint) => { const t = db.prepare("SELECT t FROM fomo_coin WHERE mint = ?").get(mint)?.t; return t && now() - t < COIN_TTL; };
function scheduleCoins() {
  if (coinLoop) return;
  coinLoop = setTimeout(async () => {
    coinLoop = null;
    const page = [...wantPage].filter((m) => !fresh(m) || urgent.has(m)), list = [...wantList].filter((m) => !fresh(m) && !wantPage.has(m));
    const ok = (m) => { const st = coinState.get(m); return !st?.busy && now() - (st?.tried || 0) > (st?.error ? 60_000 : 0); };
    // A page's coins go alone (fast); prefetches go two at a time, so a page never waits long behind one.
    const pages = page.filter(ok);
    const batch = pages.length ? pages.slice(0, 8) : list.filter(ok).slice(0, 2);
    if (!batch.length) { wantPage.clear(); wantList.clear(); return; }
    const pri = batch.some((m) => wantPage.has(m)) ? 0 : 1;
    for (const m of batch) { wantPage.delete(m); wantList.delete(m); urgent.delete(m); coinState.set(m, { busy: true, error: null, tried: now() }); }
    try {
      const got = await coinRead(coinBody(batch), { pri, timeoutMs: 45e3 });
      const put = db.prepare("INSERT INTO fomo_coin (mint, data, t) VALUES (?, ?, ?) ON CONFLICT(mint) DO UPDATE SET data = excluded.data, t = excluded.t");
      for (const m of batch) { if (got?.[m]) put.run(m, JSON.stringify(got[m]), now()); coinState.set(m, { busy: false, error: got?.[m] ? null : "Fomo had nothing for this coin.", tried: now() }); }
    } catch (e) {
      for (const m of batch) coinState.set(m, { busy: false, error: e.message, tried: now() });
    }
    if (wantPage.size || wantList.size) scheduleCoins();
  }, 50);
}
// Coins shown in a list (Discover, Pulse): read in the background so their pages open with Fomo's data ready.
export function prefetchCoins(mints) {
  // Only while Aside is idle and healthy: a prefetch never adds to a queue or to a jam.
  if (!canBrowse() || boardState.signedOut || queue.length > 1 || now() < asideState.pausedUntil) return;
  for (const m of mints.slice(0, 28)) if (!fresh(m)) wantList.add(m);
  if (wantList.size) scheduleCoins();
}

// ---------- new pairs: who is in them, kept current ----------
// The Pulse's newest coins (New pairs, and Final stretch) change by the second, so their Fomo holders are read
// every LIVE_MS while someone has the Pulse open: one /hodlers/top call covers LIVE_CHUNK coins (holders only;
// the theses feed is read when a coin's page opens or it is on Discover). Each read is merged into the coin's
// stored Fomo data (holders, their pinned theses), so its page's Known holders tab is current too, and a short
// summary per coin (count, top faces) goes to the Pulse rows (pulseKnown).
const LIVE_MS = 15_000, LIVE_CHUNK = 20, LIVE_SEEN_MS = 2 * 60_000;
let liveMints = () => [], pulseSeen = 0, liveBusy = false;
export const setLiveMints = (fn) => { liveMints = fn; };
// Discover's shared lists (server.js discoverLists): their coins' faces are kept read whether or not anyone has a
// page open, every DISCOVER_MS, so /api/discover can carry them and the page draws every row complete at once.
const DISCOVER_MS = 60_000;
let discoverMints = () => [];
export const setDiscoverMints = (fn) => { discoverMints = fn; };
// One coin's last reading, for rows that carry it ([count, faces]), or null when there is none in the last 10 min.
// After a restart the map is empty: the coin's stored reading (fomo_coin, written by every read) fills it, so the
// list does not lose its faces for the minutes the background reads take to come round again.
let knownRow = null;
export function knownOf(mint) {
  const key = knownKey({ address: mint, networkId: SOL_NETWORK });
  let k = known.get(key);
  if (!k || now() - k.t >= 10 * 60_000) {
    try {
      knownRow ??= db.prepare("SELECT data, t FROM fomo_coin WHERE mint = ?");
      const row = knownRow.get(mint), data = safeJson(row?.data, null), t = data?.ht || row?.t || 0;
      if (data && now() - t < 10 * 60_000) { const [n, faces] = holderSummary(data); k = { n, faces, t }; known.set(key, k); }
    } catch {}
  }
  return k && now() - k.t < 10 * 60_000 ? [k.n, k.faces] : null;
}
export const notePulseSeen = () => { pulseSeen = now(); };
export const liveKnownStats = { runs: 0, coins: 0, withPeople: 0, last: 0, lastError: null };
const known = new Map();   // mint -> { n, faces: [[handle, pic, value]], t }
const knownWanted = new Map(); // chain-scoped visible rows, expiring after the viewer leaves
const knownTried = new Map();
const liveBody = (mints, network = SOL_NET) => `
    const net = ${network};${HOLDER_FNS}
    const h = await get("/hodlers/top?tokens=" + encodeURIComponent(JSON.stringify(${JSON.stringify(mints)}.map((address) => ({ address, networkId: net })))));
    if (!Array.isArray(h)) throw new Error("Fomo did not answer for the holders.");
    return Object.fromEntries(h.map((x) => [x.tokenAddress, { holders: (x.topHolders || []).map(holder), totalHolders: x.totalHolders ?? null }]));`;
async function liveTick() {
  let disc = [];
  try { disc = [...new Set(discoverMints())].slice(0, 300); } catch {}
  if (liveBusy || (now() - pulseSeen > LIVE_SEEN_MS && !disc.length) || !canBrowse() || boardState.signedOut || now() < asideState.pausedUntil) return;
  liveBusy = true;
  try {
    for (const [key, target] of knownWanted) if (now() - target.seen > LIVE_SEEN_MS) knownWanted.delete(key);
    const pulseOn = now() - pulseSeen <= LIVE_SEEN_MS;
    const targets = new Map(pulseOn ? [...new Set(liveMints())].slice(0, 60).map(address => [address, { address, networkId: SOL_NETWORK }]) : []);
    for (const [key, target] of knownWanted) targets.set(key, target);
    // Discover's coins are read less often than the Pulse's newest (their holders move slower).
    for (const address of disc) if (!targets.has(address)) targets.set(address, { address, networkId: SOL_NETWORK, slow: true });
    // Oldest readings first: later rows/columns cannot starve behind the newest launches.
    const checked = t => Math.max(known.get(knownKey(t))?.t || 0, knownTried.get(knownKey(t)) || 0);
    const due = [...targets.values()].filter(t => now() - checked(t) >= (t.slow ? DISCOVER_MS : LIVE_MS))
      .sort((a, b) => checked(a) - checked(b)).slice(0, 100);
    const mints = due.map(t => t.address);
    const get = db.prepare("SELECT data, t FROM fomo_coin WHERE mint = ?");
    const put = db.prepare("INSERT INTO fomo_coin (mint, data, t) VALUES (?, ?, ?) ON CONFLICT(mint) DO UPDATE SET data = excluded.data");
    let people = 0;
    for (const network of new Set(due.map(t => t.networkId))) {
     const addresses = due.filter(t => t.networkId === network).map(t => t.address);
     for (let i = 0; i < addresses.length; i += LIVE_CHUNK) {
      const chunk = addresses.slice(i, i + LIVE_CHUNK);
      for (const address of chunk) knownTried.set(knownKey({ address, networkId: network }), now());
      const got = await coinRead(liveBody(chunk, network), { pri: 1, timeoutMs: 30e3 });
      for (const m of chunk) {
        const x = got?.[m];
        if (!x) continue;
        const holders = x.holders || [];
        const [n, faces] = holderSummary(x);
        known.set(knownKey({ address: m, networkId: network }), { n, faces, t: now() });
        if (holders.length) people++;
        if (network !== SOL_NETWORK) continue; // the coin-page table is Solana-only
        const row = get.get(m), d = safeJson(row?.data, null) || { holders: [], totalHolders: null, theses: [], swaps: [] };
        // Holders' pinned theses join the coin's theses (one per thesis id), as the full read does.
        const theses = [...(d.theses || [])], seen = new Set(theses.map((t) => t.id));
        for (const h of holders) if (h.thesis && !seen.has(h.thesis.id)) { seen.add(h.thesis.id); theses.push({ ...h.thesis, handle: h.handle, name: h.name, pic: h.pic, verified: h.verified, dev: h.dev, replies: 0,
          position: { amount: h.amount, value: h.value, unrealized: h.unrealized, realized: h.realized, pct: h.cost ? (h.unrealized / h.cost) * 100 : null, closed: null } }); }
        if (!row && !holders.length) continue;   // nobody from Fomo in it yet: nothing to keep
        put.run(m, JSON.stringify({ ...d, holders, totalHolders: x.totalHolders ?? d.totalHolders, theses, ht: now() }), row?.t ?? 0);
      }
     }
    }
    for (const [m, k] of known) if (now() - k.t > 10 * 60_000) known.delete(m);
    for (const [m, t] of knownTried) if (now() - t > 10 * 60_000) knownTried.delete(m);
    Object.assign(liveKnownStats, { runs: liveKnownStats.runs + 1, coins: mints.length, withPeople: people, last: now(), lastError: null });
  } catch (e) { liveKnownStats.lastError = e.message; }
  finally { liveBusy = false; }
}
if (!process.env.RADAR_DATA) setInterval(liveTick, LIVE_MS).unref();
// GET /api/fomo/known: the Pulse rows' faces, { mint: [count, [[handle, pic, value], ...]] } for coins with people.
export function pulseKnown(tokens = "") {
  notePulseSeen();
  const requested = parseKnownTokens(tokens), get = db.prepare("SELECT data, t FROM fomo_coin WHERE mint = ?");
  for (const token of requested) {
    const key = knownKey(token);
    knownWanted.set(key, { ...token, seen: now() });
    // Reuse coin-page/relay readings immediately, including a confirmed zero.
    if (token.networkId === SOL_NETWORK) {
      const row = get.get(token.address), data = safeJson(row?.data, null), t = data?.ht || row?.t || 0;
      if (data && now() - t < COIN_TTL && t > (known.get(key)?.t || 0)) {
        const [n, faces] = holderSummary(data); known.set(key, { n, faces, t });
      }
    }
  }
  while (knownWanted.size > 1000) knownWanted.delete(knownWanted.keys().next().value);
  void liveTick();
  const out = {};
  const keys = requested.length ? requested.map(knownKey) : [...known.keys()];
  for (const key of keys) { const k = known.get(key); if (k && now() - k.t < 10 * 60_000) out[key] = [k.n, k.faces]; }
  return out;
}

// The chart's faces (chartpeople.js) while a coin page is open: its Fomo trades read again once they are older
// than `maxAge` (default 20 s), so a Fomo trader's buy shows on the chart within seconds, not after COIN_TTL.
export function wantFomoFresh(mint, maxAge = 20_000) {
  if (now() - coinRelayAt < RELAY_ALIVE_MS || !canBrowse() || coinState.get(mint)?.busy) return;
  const t = db.prepare("SELECT t FROM fomo_coin WHERE mint = ?").get(mint)?.t;
  if (!t || now() - t > maxAge) { urgent.add(mint); wantPage.add(mint); scheduleCoins(); }
}
export function coinFomo(mint) {
  const row = db.prepare("SELECT data, t FROM fomo_coin WHERE mint = ?").get(mint);
  if (coinAsked.size > 2000) coinAsked.clear();
  coinAsked.set(mint, now());
  // The owner's PC is relaying coins here (coinRelayIn): it reads them (st.busy = its answer is on the way), so
  // this server's own browser does not try.
  const relayed = now() - coinRelayAt < RELAY_ALIVE_MS;
  const st = relayed ? { busy: !row, error: null, tried: 0 } : coinState.get(mint) || { busy: false, error: null, tried: 0 };
  if (!relayed && (!row || now() - row.t > COIN_TTL) && canBrowse()) { wantPage.add(mint); scheduleCoins(); }
  if (coinState.size > 1000) for (const [m, x] of coinState) if (!x.busy && now() - x.tried > 30 * 60_000) coinState.delete(m);
  const d = safeJson(row?.data, null);
  // Fomo traders whose real wallet Blix found (fomoresolve.js): their rows say TRACKED.
  const wallets = walletMap();
  const mark = (x) => ({ ...x, wallet: x.handle ? wallets.get(String(x.handle).toLowerCase()) || null : null });
  const waiting = !row && (st.busy || wantPage.has(mint));
  return {
    mint, read: row ? (row.t || d?.ht || null) : null, heldAt: d?.ht ?? row?.t ?? null, loading: waiting, refreshing: Boolean(row) && (st.busy || wantPage.has(mint)), error: row ? null : st.error, signedOut: boardState.signedOut,
    queue: asideQueue(), holders: (d?.holders || []).map(mark), totalHolders: d?.totalHolders ?? null, theses: (d?.theses || []).map(mark),
  };
}
// ---------- one coin, relayed from the owner's PC ----------
// Fomo answers a coin's holders and feed only to a signed-in browser (prod-api says 430 "unauthorized" to the
// same request from a server, even with a good token), and only the owner's PC has one that stays signed in. So
// the PC reads the coins this server's pages ask about (coinRelayWanted) in Aside and posts each one here
// (fomorelay.js, POST /api/fomo/coin/relay as the owner); the rows land in fomo_coin like a read of our own.
const coinAsked = new Map();   // mint -> when a page here last asked for it
let coinRelayAt = 0;
const RELAY_ALIVE_MS = 2 * 60_000, RELAY_COIN_WANT_MS = 60_000, MINT_OK = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const coinRelayStats = { posts: 0, coins: 0, lastAt: 0 };
export const coinRelayWanted = () => [...coinAsked].filter(([, t]) => now() - t < RELAY_COIN_WANT_MS).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([m]) => m);
// { coins: { <mint>: { t, data: { holders, totalHolders, theses, swaps } } } } from the PC. Answers which coins are wanted now.
export function coinRelayIn(body) {
  const put = db.prepare("INSERT INTO fomo_coin (mint, data, t) VALUES (?, ?, ?) ON CONFLICT(mint) DO UPDATE SET data = excluded.data, t = excluded.t WHERE excluded.t >= fomo_coin.t");
  let n = 0;
  for (const [mint, x] of Object.entries(body?.coins && typeof body.coins === "object" ? body.coins : {}).slice(0, 20)) {
    const d = x?.data;
    if (!MINT_OK.test(mint) || !d || !Array.isArray(d.holders) || !Array.isArray(d.theses)) continue;
    const text = JSON.stringify({ holders: d.holders.slice(0, 120), totalHolders: Number.isFinite(d.totalHolders) ? d.totalHolders : null, theses: d.theses.slice(0, 200), swaps: Array.isArray(d.swaps) ? d.swaps.slice(0, 600) : [] });
    if (text.length > 1_500_000) continue;
    put.run(mint, text, Math.min(Number(x.t) || now(), now()));
    coinState.set(mint, { busy: false, error: null, tried: now() });
    n++;
  }
  coinRelayAt = now(); coinRelayStats.posts++; coinRelayStats.coins += n; coinRelayStats.lastAt = now();
  return { ok: true, relayed: n, wanted: coinRelayWanted() };
}
// A coin's stored read, for the PC's relay: { data (JSON text), t } or null.
export const coinRow = (mint) => db.prepare("SELECT data, t FROM fomo_coin WHERE mint = ?").get(mint) || null;

let walletCache = { t: 0, m: new Map() };
function walletMap() {
  if (now() - walletCache.t > 30_000) walletCache = { t: now(), m: new Map(db.prepare("SELECT handle, wallet FROM fomo_wallets WHERE wallet IS NOT NULL").all().map((x) => [String(x.handle).toLowerCase(), x.wallet])) };
  return walletCache.m;
}

// ---------- schedule ----------
// Once a day: shortly after start if today's board is missing, then checked every hour. A failed read is
// retried after 3 hours (Aside closed, signed out, Fomo down) so it never hammers anything.
export function startBoard(addWallet, removeWallet) {
  deps = { addWallet, removeWallet };
  const due = () => {
    const ok = db.prepare("SELECT t FROM fomo_board_runs WHERE ok = 1 ORDER BY t DESC LIMIT 1").get()?.t;
    const last = db.prepare("SELECT t FROM fomo_board_runs ORDER BY t DESC LIMIT 1").get()?.t;
    if (ok && today(ok) === today()) return false;
    return !last || now() - last > 3 * HOUR || (ok && last === ok);
  };
  const check = () => {
    boardState.next = now() + HOUR;
    if (due()) refreshBoard(addWallet, removeWallet).catch(() => {});
    else followTop(addWallet, removeWallet).catch(() => {});   // finish wallets left from an earlier run
  };
  setTimeout(check, 2 * 60_000);
  setInterval(check, HOUR);
}
