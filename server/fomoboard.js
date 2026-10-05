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
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { db, logEvent } from "./db.js";
import * as sol from "./solana.js";
import { resolveAndStore, walletFor } from "./fomoresolve.js";

export const ASIDE_EXE = path.join(process.env.LOCALAPPDATA || "", "Aside", "CLI", "current", "aside.exe");
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
    const fn = Object.values(m).find((v) => typeof v === "function" && /statusCode:401|Authorization/.test(String(v)));
    if (!fn) return { error: "Fomo's web client changed: its fetch function was not found." };
    const get = async (p) => { const x = await fn(p, { method: "GET" }); if (x.statusCode === 401) throw new Error("signed-out"); return x.statusCode === 200 ? x.responseObject : null; };`;

export function inFomo(body, url = "https://fomo.family/leaderboard", { pri = 1, timeoutMs = 115e3 } = {}) {
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
    if (r.error === "signed-out") { boardState.signedOut = true; throw Object.assign(new Error("Aside is signed out of Fomo. Sign in at fomo.family in Aside, then refresh."), { signedOut: true }); }
    asideState.hasTab = r.via !== "opened";
    if (r.error) throw new Error(r.error);
    boardState.signedOut = false;
    return r.value;
  });
}

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
function runRepl(inner, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(ASIDE_EXE)) return reject(new Error("Aside isn't installed (its CLI was not found)."));
    const code = `await eval("(async () => {" + atob("${Buffer.from(inner, "utf8").toString("base64")}") + "})()");`;
    const child = spawn(ASIDE_EXE, ["repl", code], { windowsHide: true });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d)); child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => { try { child.kill(); } catch {} reject(new Error("Aside took too long reading Fomo.")); }, timeoutMs);
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", () => {
      clearTimeout(timer);
      const line = out.split(/\r?\n/).reverse().find((l) => l.trim().startsWith('{"fomoboard"'));
      if (!line) return reject(new Error((out + err).replace(/\x1b\[[0-9;]*m/g, "").trim().slice(0, 300) || "No answer from Aside."));
      try { resolve(JSON.parse(line)); } catch { reject(new Error("Aside's answer could not be read.")); }
    });
  });
}

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
export async function refreshBoard(addWallet, removeWallet) {
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
    followTop(addWallet, removeWallet);   // background: profiles, wallets, follows
  } catch (e) {
    db.prepare("INSERT INTO fomo_board_runs (t, ok, rows, followed, error, ms) VALUES (?, 0, 0, 0, ?, ?)").run(t0, e.message, now() - t0);
    boardState.error = e.message;
  } finally { boardState.running = false; }
  return boardState;
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
    rows: rows.map((r) => ({ ...r, top: safeJson(r.top), prevRank: prev.get(r.handle) ?? null, days: daysOnBoard(r.handle, range), tracked: false, ...walletInfo(r.uid) })),
    status: { running: boardState.running, error: boardState.error, signedOut: boardState.signedOut, lastRun, lastOk, next: boardState.next, aside: fs.existsSync(ASIDE_EXE), profiles: boardState.profiles, wallets: boardState.wallets, working: following },
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
const coinBody = (mints) => `
    const net = ${SOL_NET};
    const thesis = (c) => c && c.comment ? { id: c.id, text: c.comment, likes: c.numLikes ?? c.reactions?.counts?.likeCount ?? 0, mcap: c.marketCapAtCreation ?? null, price: c.priceUsdAtCreation ?? null, t: c.createdAt } : null;
    // Every coin's holders in one request, then each coin's thesis feed, all at once.
    const h = await get("/hodlers/top?tokens=" + encodeURIComponent(JSON.stringify(${JSON.stringify(mints)}.map((address) => ({ address, networkId: net })))));
    if (!Array.isArray(h)) throw new Error("Fomo did not answer for the holders.");
    const one = async (mint) => {
      const top = h.find((x) => x.tokenAddress === mint) || {};
      const holders = (top.topHolders || []).map((x) => ({
        handle: x.user?.userHandle, name: x.user?.displayName, pic: x.user?.profilePictureLink, followers: x.user?.followers ?? null, verified: !!x.user?.verified,
        amount: x.humanAmount ?? null, value: x.value ?? null, pnl: x.pnl ?? null, unrealized: x.unrealizedPnl ?? null, realized: x.realizedPnl ?? null,
        cost: x.costBasis ?? null, entry: x.averageEntryPrice ?? null, external: !!x.isExternallyReceived, dev: !!x.isDev, avgHold: x.averageHoldTimeSeconds ?? null,
        thesis: x.showComment === false ? null : thesis(x.comment) }));
      const theses = [];
      let lastId = null;
      for (let page = 0; page < 1; page++) {   // one page of the feed: most theses are the holders' pinned ones below
        const f = await get("/feed/token?tokenAddress=" + mint + "&networkId=" + net + "&threshold=1000" + (lastId ? "&lastId=" + lastId : ""));
        const items = (f && f.items) || [];
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
      return [mint, { holders, totalHolders: top.totalHolders ?? null, theses }];
    };
    return Object.fromEntries(await Promise.all(${JSON.stringify(mints)}.map(one)));`;

// Coins waiting for a read: pages first (someone is looking), then coins on screen in lists (prefetch, so
// opening one is instant). Up to 8 coins go in one Aside call; a page's coin never waits behind a prefetch.
const coinState = new Map();   // mint -> { busy, error, tried }
const wantPage = new Set(), wantList = new Set();
let coinLoop = null;
const fresh = (mint) => { const t = db.prepare("SELECT t FROM fomo_coin WHERE mint = ?").get(mint)?.t; return t && now() - t < COIN_TTL; };
function scheduleCoins() {
  if (coinLoop) return;
  coinLoop = setTimeout(async () => {
    coinLoop = null;
    const page = [...wantPage].filter((m) => !fresh(m)), list = [...wantList].filter((m) => !fresh(m) && !wantPage.has(m));
    const ok = (m) => { const st = coinState.get(m); return !st?.busy && now() - (st?.tried || 0) > (st?.error ? 60_000 : 0); };
    // A page's coins go alone (fast); prefetches go two at a time, so a page never waits long behind one.
    const pages = page.filter(ok);
    const batch = pages.length ? pages.slice(0, 8) : list.filter(ok).slice(0, 2);
    if (!batch.length) { wantPage.clear(); wantList.clear(); return; }
    const pri = batch.some((m) => wantPage.has(m)) ? 0 : 1;
    for (const m of batch) { wantPage.delete(m); wantList.delete(m); coinState.set(m, { busy: true, error: null, tried: now() }); }
    try {
      const got = await inFomo(coinBody(batch), undefined, { pri, timeoutMs: 45e3 });
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
  if (!fs.existsSync(ASIDE_EXE) || boardState.signedOut || running || queue.length || now() < asideState.pausedUntil) return;
  for (const m of mints.slice(0, 8)) if (!fresh(m)) wantList.add(m);
  if (wantList.size) scheduleCoins();
}

export function coinFomo(mint) {
  const row = db.prepare("SELECT data, t FROM fomo_coin WHERE mint = ?").get(mint);
  const st = coinState.get(mint) || { busy: false, error: null, tried: 0 };
  if ((!row || now() - row.t > COIN_TTL) && fs.existsSync(ASIDE_EXE)) { wantPage.add(mint); scheduleCoins(); }
  if (coinState.size > 1000) for (const [m, x] of coinState) if (!x.busy && now() - x.tried > 30 * 60_000) coinState.delete(m);
  const d = safeJson(row?.data, null);
  // Fomo traders whose real wallet Blix found (fomoresolve.js): their rows say TRACKED.
  const wallets = walletMap();
  const mark = (x) => ({ ...x, wallet: x.handle ? wallets.get(String(x.handle).toLowerCase()) || null : null });
  const waiting = !row && (st.busy || wantPage.has(mint));
  return {
    mint, read: row?.t ?? null, loading: waiting, refreshing: Boolean(row) && (st.busy || wantPage.has(mint)), error: row ? null : st.error, signedOut: boardState.signedOut,
    queue: asideQueue(), holders: (d?.holders || []).map(mark), totalHolders: d?.totalHolders ?? null, theses: (d?.theses || []).map(mark),
  };
}
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
