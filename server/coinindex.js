// The coin index: every pump.fun coin the radar hears being created, kept for good with its name, ticker,
// creator, launch time, socials, description and picture address, so any page shows a coin's identity at once
// and still knows it after a restart, weeks later. The launch feeds (PumpPortal, the chain's CreateEvent) give
// the name, ticker and metadata link the moment a coin exists; the metadata file (the creator's own, on IPFS)
// is read in the background a few at a time, newest first, and its picture fetched to disk (images.js, through
// the hook below) so the logo is already here when the coin first shows anywhere.
// ~30K coins a day at ~250 bytes each: a few MB a day in radar.db.
import { db } from "./db.js";
import { safeUrl, publicUrl } from "./quality.js";

const now = () => Date.now();
const GATEWAY = "https://pump.mypinata.cloud/ipfs/";
const ipfs = (u) => (u ? String(u).replace(/^https?:\/\/[^/]+\/ipfs\//, GATEWAY).replace(/^ipfs:\/\//, GATEWAY) : u);

db.exec(`
  CREATE TABLE IF NOT EXISTS coins (
    mint TEXT PRIMARY KEY, name TEXT, symbol TEXT, uri TEXT, creator TEXT, created INTEGER,
    image TEXT, twitter TEXT, website TEXT, telegram TEXT, description TEXT,
    meta_t INTEGER, meta_tries INTEGER NOT NULL DEFAULT 0, meta_next INTEGER, pic_t INTEGER
  );
  CREATE INDEX IF NOT EXISTS coins_meta ON coins(meta_t, created);
  CREATE INDEX IF NOT EXISTS coins_created ON coins(created);
`);
// Coins the radar tracked before the index existed: their names and pictures are already in the tokens table.
if (!db.prepare("SELECT 1 FROM coins LIMIT 1").get()) {
  try { db.exec("INSERT OR IGNORE INTO coins (mint, name, symbol, uri, image, created, meta_t) SELECT mint, name, symbol, uri, image, first_seen, CASE WHEN image IS NULL THEN NULL ELSE first_seen END FROM tokens WHERE mint LIKE '%pump'"); } catch {}
}

export const indexStats = { coins: 0, noted: 0, metaRead: 0, metaFailed: 0, pending: 0 };
const upsert = db.prepare(`INSERT INTO coins (mint, name, symbol, uri, creator, created) VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(mint) DO UPDATE SET name = COALESCE(NULLIF(excluded.name, ''), name), symbol = COALESCE(NULLIF(excluded.symbol, ''), symbol),
    uri = COALESCE(NULLIF(excluded.uri, ''), uri), creator = COALESCE(excluded.creator, creator), created = COALESCE(created, excluded.created)`);
const getOne = db.prepare("SELECT * FROM coins WHERE mint = ?");
const setMeta = db.prepare("UPDATE coins SET image = ?, twitter = ?, website = ?, telegram = ?, description = ?, meta_t = ?, meta_tries = meta_tries + 1 WHERE mint = ?");
// A file that did not answer is asked for again after 10 s, then 20 s, then given up on (meta_t set, nothing stored).
const failMeta = db.prepare("UPDATE coins SET meta_tries = meta_tries + 1, meta_next = ? + 10000 * (meta_tries + 1), meta_t = CASE WHEN meta_tries >= 2 THEN ? ELSE NULL END WHERE mint = ?");
const nextMeta = db.prepare("SELECT mint, uri FROM coins WHERE meta_t IS NULL AND uri IS NOT NULL AND uri != '' AND (meta_next IS NULL OR meta_next < ?) ORDER BY created DESC LIMIT ?");
const setPic = db.prepare("UPDATE coins SET pic_t = ? WHERE mint = ?");

// A coin seen launching: { mint, name, symbol, uri, creator, created? }. From the chain's CreateEvent and
// PumpPortal's launch feed alike; whichever comes first makes the row, the other fills what it left blank.
export function note(c) {
  if (!c?.mint || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(c.mint)) return;
  try {
    upsert.run(c.mint, String(c.name || "").slice(0, 64), String(c.symbol || "").slice(0, 32), String(c.uri || "").slice(0, 300), c.creator || null, c.created || now());
    indexStats.noted++;
    kick();
  } catch {}
}

const cache = new Map();   // mint -> row | null, the last 4,000 asked for
// Everything stored about a coin, or null. { mint, name, symbol, uri, creator, created, image, twitter, website, telegram, description }
export function get(mint) {
  if (cache.has(mint)) return cache.get(mint);
  const r = getOne.get(mint) || null;
  cache.set(mint, r); if (cache.size > 4000) cache.delete(cache.keys().next().value);
  return r;
}
// Name and ticker only, the shape pulse.js nameOf gives.
export function nameOf(mint) { const r = get(mint); return r && (r.symbol || r.name) ? { symbol: r.symbol || null, name: r.name || null } : null; }
// The socials, the shape pulse.js getMeta gives (null until the metadata file has been read).
export function metaOf(mint) { const r = get(mint); return r?.meta_t && r.image != null ? { image: r.image, twitter: r.twitter, website: r.website, telegram: r.telegram, description: r.description } : null; }
export const imageOf = (mint) => get(mint)?.image || null;

// ---------- reading the metadata files ----------
// Set by server.js: fn(mint) asks images.js to fetch the coin's picture to disk now.
let wantPicture = () => {};
export const onNeedPicture = (fn) => { wantPicture = fn; };
let reading = 0, timer = null;
const PARALLEL = 4;
function kick() { if (!timer) timer = setTimeout(sweep, 200); }
async function sweep() {
  timer = null;
  if (reading >= PARALLEL) return;
  let rows;
  try { rows = nextMeta.all(now(), PARALLEL - reading); } catch { return; }
  indexStats.pending = rows.length;
  for (const r of rows) read(r);
}
async function read(r) {
  reading++;
  try {
    // The metadata link and everything in it is written by the coin's creator: public web addresses only.
    // pump.fun's own gateway first for its files (fast), but a file pinned elsewhere (ipfs.io links) is refused
    // there (403, "not pinned to their Pinata account"): the link as given and a public gateway are tried too.
    const cid = String(r.uri).match(/\/ipfs\/([A-Za-z0-9]+[^?#]*)/)?.[1] || String(r.uri).match(/^ipfs:\/\/(.+)$/)?.[1];
    // ipfs.io, dweb.link and the like answer 429 to a server; Filebase and 4everland serve any pinned file.
    const tries = [...new Set([ipfs(r.uri), ...(cid ? [`https://ipfs.filebase.io/ipfs/${cid}`, `https://4everland.io/ipfs/${cid}`] : [r.uri])].map((u) => publicUrl(u)).filter(Boolean))];
    if (!tries.length) throw new Error("link not allowed");
    let m = null, last = null;
    for (const uri of tries) {
      try {
        const res = await fetch(uri, { signal: AbortSignal.timeout(6000), headers: { accept: "application/json" } });
        if (!res.ok) { last = `HTTP ${res.status}`; continue; }
        m = JSON.parse((await res.text()).slice(0, 200_000)); break;
      } catch (e) { last = e.message; }
    }
    // No gateway has it: pump.fun's own coin record carries the same fields.
    if (!m) {
      const res = await fetch(`https://frontend-api-v3.pump.fun/coins-v2/${r.mint}`, { signal: AbortSignal.timeout(6000), headers: { accept: "application/json", "user-agent": "Mozilla/5.0" } });
      const j = res.ok ? await res.json().catch(() => null) : null;
      if (!j?.image_uri && !j?.description) throw new Error(last || `pump.fun ${res.status}`);
      m = { image: j.image_uri, twitter: j.twitter, website: j.website, telegram: j.telegram, description: j.description };
    }
    const image = safeUrl(m.image ? ipfs(m.image) : null);
    setMeta.run(image, safeUrl(m.twitter), safeUrl(m.website), safeUrl(m.telegram), String(m.description || "").slice(0, 300), now(), r.mint);
    cache.delete(r.mint);
    indexStats.metaRead++;
    // The picture, now that its address is known (the picture CDNs often have it earlier: images.js tries those first).
    try { wantPicture(r.mint); } catch {}
  } catch {
    // A file not there yet (new ones take a few seconds to reach the gateways): tried again on a later sweep,
    // three times in all, then given up on.
    failMeta.run(now(), now(), r.mint); cache.delete(r.mint);
    indexStats.metaFailed++;
  } finally {
    reading--;
    if (nextMeta.get(now(), 1)) kick(); else timer ||= setTimeout(() => { timer = null; sweep(); }, 10_000);   // a retry falls due
  }
}
export function markPicture(mint) { try { setPic.run(now(), mint); } catch {} }

let started = false;
export function startCoinIndex() {
  if (started) return;
  started = true;
  indexStats.coins = db.prepare("SELECT COUNT(*) n FROM coins").get().n;
  setInterval(() => { indexStats.coins = db.prepare("SELECT COUNT(*) n FROM coins").get().n; kick(); }, 60_000).unref?.();
  kick();
}
