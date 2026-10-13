// Top devs (#/devs): the wallets that launched the coins that did best in the last day, week or month, ranked by what
// their coins earned in fees (the coin that traded most made its dev the most: pump.fun pays the creator from every
// trade's fee), then by their best coin's peak market cap. Each dev: every coin they launched in the window with how
// it went (bonded, peak and live market cap, dead, the dev's own selling), launches and bonds in the window, their
// bond rate, and pump.fun's profile for the wallet when it has one. Built from the radar's own records: the coin
// index (every launch heard, with its creator), the tokens table (the coins it tracked: peak, live cap, bonded,
// status) and the fee ledger (coinfees.js). Serial spam deployers (dozens of launches, nothing bonded) are left out.
import { db } from "./db.js";
import { feesOf } from "./coinfees.js";
import { rowHolders } from "./holders.js";
import { pumpProfile } from "./walletpage.js";
import { solPrice } from "./wallets.js";
import { createDevIdentityLookup } from './dev-identity.js';
const knownIdentity = createDevIdentityLookup(db);

const HOUR = 3600e3, DAY = 24 * HOUR;
const RANGES = { "24h": DAY, "7d": 7 * DAY, "30d": 30 * DAY };
const TOP = 160, COINS_EACH = 12, CACHE_MS = 30_000, PROFILE_MS = 6 * HOUR, PROFILES_PER_BUILD = 25;
const now = () => Date.now();
const cache = new Map();      // range -> { t, v, building }
const profiles = new Map();   // wallet -> { t, p }

// Driven from the tracked coins (the tokens table, by its first_seen index: only those have a peak, fees or an
// outcome), with the coin index looked up per coin for its launch time and metadata. Each creator's launches in the
// window are one indexed count (coins_creator, made here if missing), not a scan of the whole index: a month of
// launches is a few hundred thousand rows, and this runs on the radar's thread.
try { db.exec("CREATE INDEX IF NOT EXISTS coins_creator ON coins(creator, created)"); } catch {}
// Two steps, so a month's 65K tracked coins are not read row by row (a second of the radar's thread): first the
// creators with anything to show (a coin that bonded or reached $20K; the board's own rule), then every coin of
// those creators in the window, by the creator index in chunks.
const candidatesQ = db.prepare(`SELECT DISTINCT creator FROM tokens WHERE creator IS NOT NULL AND first_seen >= ? AND (graduated = 1 OR peak_mcap >= 20000 OR mcap >= 20000)`);
const CHUNK = 400;
const coinsOfQ = new Map();   // chunk size -> statement
const coinsOf = (creators, since) => {
  const out = [];
  for (let i = 0; i < creators.length; i += CHUNK) {
    const part = creators.slice(i, i + CHUNK);
    let st = coinsOfQ.get(part.length);
    if (!st) { st = db.prepare(`SELECT t.mint, t.creator, COALESCE(c.created, t.pair_created, t.first_seen) AS created, c.name, c.symbol, c.image,
    t.graduated, t.peak_mcap, t.mcap, t.status, t.quarantine, t.dev_sol, t.image AS timage, t.symbol AS tsymbol, t.name AS tname, t.vol_h24, t.pair_created, t.migrated_at, t.first_seen
  FROM tokens t LEFT JOIN coins c ON c.mint = t.mint
  WHERE t.creator IN (${part.map(() => "?").join(",")}) AND t.first_seen >= ?`); coinsOfQ.set(part.length, st); }
    out.push(...st.all(...part, since));
  }
  return out;
};
const countFor = db.prepare(`SELECT COUNT(*) AS n, MAX(created) AS latest FROM coins WHERE creator = ? AND created >= ?`);
const totalQ = db.prepare(`SELECT COUNT(*) AS n FROM coins WHERE created >= ?`);

function coinRow(r, solUsd) {
  const fees = feesOf(r.mint);
  // A market cap the radar could have misread (an impossible curve cap, a bad pool reading) is no peak: nothing
  // on pump.fun is worth $5B, and a quarantined coin's figures are not trusted either.
  const sane = (v) => (v != null && v > 0 && v < 5e9 && !r.quarantine ? v : null);
  const peak = Math.max(sane(r.peak_mcap) || 0, sane(r.mcap) || 0) || null;
  const dead = r.status === "dead" || (r.status && r.status !== "active" && r.status !== "untracked");
  return {
    mint: r.mint, symbol: r.tsymbol || r.symbol || null, name: r.tname || r.name || null, image: r.timage || r.image || null,
    created: r.created, bonded: Boolean(r.graduated), bondedAt: r.migrated_at || (r.graduated ? r.pair_created : null) || null,
    peak, mcap: sane(r.mcap), tracked: r.status != null, dead: Boolean(dead), quarantine: r.quarantine || null,
    feesSol: fees ? +fees.sol.toFixed(4) : 0, feesUsd: fees ? fees.sol * solUsd : 0,
    devSold: null, devPct: null, vol24: r.vol_h24 ?? null,
  };
}
// The dev's own selling on a coin, from the live holder book (holders.js): read for the board's devs only, since a
// book read per tracked coin (tens of thousands a month) is what made a build take seconds.
function withDev(c) {
  const hs = rowHolders(c.mint);
  if (hs) { c.devSold = hs.ds || null; c.devPct = hs.dev ?? null; }
  return c;
}

async function build(range) {
  const t0 = now();
  const win = RANGES[range] || DAY, since = now() - win;
  const solUsd = (await solPrice().catch(() => null)) || 0;
  const rows = coinsOf(candidatesQ.all(since).map((r) => r.creator), since);
  const by = new Map();
  for (const r of rows) {
    if (!(r.created >= since)) continue;
    const c = coinRow(r, solUsd);
    let d = by.get(r.creator);
    if (!d) { d = { wallet: r.creator, coins: [], launches: 0, bonded: 0, feesSol: 0, feesUsd: 0, rugs: 0, dead: 0, tracked: 0, best: null, latest: 0 }; by.set(r.creator, d); }
    d.launches++;
    if (c.bonded) d.bonded++;
    if (c.tracked) d.tracked++;
    if (c.dead) d.dead++;
    d.feesSol += c.feesSol; d.feesUsd += c.feesUsd;
    d.latest = Math.max(d.latest, c.created || 0);
    if (!d.best || (c.peak || 0) > (d.best.peak || 0)) d.best = c;
    d.coins.push(c);
  }
  // Every launch in the window, tracked or not, per creator (the index counts them; the tracked ones are the floor).
  for (const d of by.values()) { const k = countFor.get(d.wallet, since); if (k) { d.launches = Math.max(d.launches, k.n || 0); d.latest = Math.max(d.latest, k.latest || 0); } }
  // Serial spam: many launches, nothing that bonded or reached $20K; a few launches a day with nothing to show is just noise too.
  const devs = [...by.values()].filter((d) => {
    const bestPeak = d.best?.peak || 0;
    if (d.bonded === 0 && bestPeak < 20_000) return false;
    if (d.launches >= 25 * Math.max(1, win / DAY) && d.bonded === 0) return false;
    return true;
  });
  devs.sort((a, b) => b.feesSol - a.feesSol || (b.best?.peak || 0) - (a.best?.peak || 0) || b.bonded - a.bonded || b.latest - a.latest);
  for (const d of devs.slice(0, TOP)) { for (const c of d.coins) { withDev(c); if (c.devSold === "all" && (c.peak || 0) >= 10_000) d.rugs++; } }
  const top = devs.slice(0, TOP).map((d, i) => ({
    rank: i + 1, wallet: d.wallet, launches: d.launches, bonded: d.bonded, bondRate: d.launches ? d.bonded / d.launches : 0, rugs: d.rugs, dead: d.dead, tracked: d.tracked,
    feesSol: +d.feesSol.toFixed(3), feesUsd: Math.round(d.feesUsd), best: d.best, latest: d.latest,
    coins: d.coins.sort((x, y) => (y.peak || 0) - (x.peak || 0)).slice(0, COINS_EACH),
    serial: d.launches >= 10 * Math.max(1, win / DAY),
    name: null, pic: null, bio: null, x: null, followers: null,
  }));
  // pump.fun's profile for the top of the board: what is kept is used now; missing ones are asked for behind this
  // build (a few at a time, kept for hours) and show on the next.
  let asked = 0;
  for (const d of top) {
    const known = knownIdentity(d.wallet);
    if (known) { Object.assign(d, known); continue; }
    const p = profiles.get(d.wallet);
    if (p?.p) Object.assign(d, { name: p.p.name, pic: p.p.pic, bio: p.p.bio, x: p.p.x, followers: p.p.followers });
    if ((!p || now() - p.t > PROFILE_MS) && asked < PROFILES_PER_BUILD) {
      asked++; profiles.set(d.wallet, { t: now(), p: p?.p || null });
      pumpProfile(d.wallet).then((got) => profiles.set(d.wallet, { t: now(), p: got || p?.p || null }), () => profiles.set(d.wallet, { t: now() - PROFILE_MS + 10 * 60_000, p: p?.p || null }));
    }
  }
  if (profiles.size > 2000) for (const k of [...profiles.keys()].slice(0, 500)) profiles.delete(k);
  const total = totalQ.get(since)?.n || 0;
  return { range, since, t: now(), buildMs: now() - t0, solUsd, devs: devs.length, launches: Math.max(total, rows.length), top };
}

// GET /api/devs?range=24h|7d|30d → { range, since, t, solUsd, devs, launches, top: [...] }. Kept CACHE_MS; a stale
// answer is given at once while the next build runs behind it.
export function devBoard({ range } = {}) {
  const r = RANGES[range] ? range : "24h";
  const e = cache.get(r) || { t: 0, v: null, building: null };
  cache.set(r, e);
  if (e.v && now() - e.t < (r === "24h" ? 2 * CACHE_MS : 6 * CACHE_MS)) return e.v;
  if (!e.building) e.building = build(r).then((v) => { e.v = v; e.t = now(); return v; }).finally(() => { e.building = null; });
  return e.v ? e.v : e.building;
}
