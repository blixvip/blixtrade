// Helpers for the Create coin page (web/src/pages/Launch.tsx), the parts launch tools are known for:
//   - clone: a coin's name, ticker, description, socials and picture from its contract address, to relaunch
//     or riff on it without retyping (the radar knows most coins; pump.fun's record covers the rest);
//   - write: a name, ticker and description from a one-line idea, by the quick Claude model on this PC's login;
//   - status: whether writing is available here, and the vault's vanity-address stock and grind speed.
import fs from "node:fs";
import { db } from "./db.js";
import * as coinIndex from "./coinindex.js";
import * as images from "./images.js";
import { getMeta, nameOf } from "./pulse.js";
import { fetchPublic } from "./netguard.js";
import { ask, extractJson, FAST_MODEL, claudeStatus } from "./ai.js";
// accounts.js is loaded only when asked (it is optional on a radar without wallets: webapp.js does the same).
const accounts = () => import("./accounts.js");

const fail = (status, message) => Object.assign(new Error(message), { status });
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const GATEWAY = "https://pump.mypinata.cloud/ipfs/";
const ipfs = (u) => (u ? String(u).replace(/^https?:\/\/[^/]+\/ipfs\//, GATEWAY).replace(/^ipfs:\/\//, GATEWAY) : u);
const PICTURE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);   // what a launch may carry
const link = (v) => { v = String(v || "").trim(); return /^https:\/\/\S{3,200}$/.test(v) ? v : ""; };

// The coin's picture as a data URL the page can put straight into the form: full size from where it lives
// (pump.fun's CDN, IPFS), else the radar's own copy on disk (a small logo, better than nothing). null if neither.
async function pictureData(mint, url) {
  if (url) {
    try {
      const r = await fetchPublic(ipfs(url), { maxBytes: 4e6, timeout: 8000, headers: { "user-agent": UA, accept: "image/*" } });
      const type = String(r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (r.ok && PICTURE_TYPES.has(type)) { const b = Buffer.from(await r.arrayBuffer()); if (b.length > 100) return { image: `data:${type};base64,${b.toString("base64")}`, source: "origin" }; }
    } catch { /* the radar's copy, below */ }
  }
  try {
    const pic = await images.picture(mint);
    if (pic && PICTURE_TYPES.has(pic.type)) { const b = await fs.promises.readFile(pic.file); return { image: `data:${pic.type};base64,${b.toString("base64")}`, source: "radar" }; }
  } catch { /* none */ }
  return { image: null, source: null };
}

// { mint, name, symbol, description, twitter, telegram, website, image, imageSource, source }
export async function cloneCoin(mint) {
  const row = db.prepare("SELECT name, symbol, description, image, links FROM tokens WHERE mint = ?").get(mint);
  const idx = coinIndex.get(mint), meta = getMeta(mint) || {}, nm = nameOf(mint) || {};
  let links = [];
  try { links = JSON.parse(row?.links || "[]"); } catch { links = []; }
  const of = (type) => links.find((l) => l?.type === type)?.url;
  const c = {
    name: row?.name || idx?.name || nm.name || "", symbol: row?.symbol || idx?.symbol || nm.symbol || "",
    description: meta.description || idx?.description || row?.description || "",
    twitter: meta.twitter || idx?.twitter || of("twitter") || "", telegram: meta.telegram || idx?.telegram || of("telegram") || "", website: meta.website || idx?.website || of("website") || "",
    imageUrl: meta.image || idx?.image || row?.image || null, source: row || idx ? "radar" : null,
  };
  // Never met: pump.fun's own record (its coins carry the same fields the launch form takes).
  if (!c.name && !c.symbol) {
    let j = null;
    try { const r = await fetch(`https://frontend-api-v3.pump.fun/coins-v2/${mint}`, { signal: AbortSignal.timeout(8000), headers: { accept: "application/json", "user-agent": UA } }); j = r.ok ? await r.json() : null; } catch { j = null; }
    if (!j?.name && !j?.symbol) throw fail(404, "The radar has never seen this coin, and pump.fun does not know it either.");
    Object.assign(c, { name: j.name || "", symbol: j.symbol || "", description: j.description || "", twitter: j.twitter || "", telegram: j.telegram || "", website: j.website || "", imageUrl: j.image_uri || null, source: "pump.fun" });
    try { coinIndex.note({ mint, name: j.name, symbol: j.symbol, uri: j.metadata_uri, creator: j.creator, created: j.created_timestamp }); } catch { /* optional */ }
  }
  const pic = await pictureData(mint, c.imageUrl);
  return { mint, name: String(c.name).slice(0, 32), symbol: String(c.symbol).replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 10), description: String(c.description).slice(0, 500),
    twitter: link(c.twitter), telegram: link(c.telegram), website: link(c.website), image: pic.image, imageSource: pic.source, source: c.source };
}

// Who already uses a ticker: an exact match on the radar's coins, the biggest still trading first.
// { sym, n, top: { mint, name, mcap, status } | null, rows }
export function tickerUse(sym) {
  sym = String(sym || "").replace(/^\$/, "").trim();
  if (!/^[A-Za-z0-9]{1,10}$/.test(sym)) throw fail(400, "A ticker is 1 to 10 letters or numbers.");
  const rows = db.prepare(`SELECT mint, name, symbol, mcap, status, graduated FROM tokens WHERE lower(symbol) = lower(?)
    ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, COALESCE(mcap, 0) DESC, first_seen DESC LIMIT 6`).all(sym);
  const n = db.prepare("SELECT COUNT(*) n FROM tokens WHERE lower(symbol) = lower(?)").get(sym).n;
  const out = rows.map((r) => ({ mint: r.mint, name: r.name || null, mcap: r.mcap ?? null, status: r.status || null, graduated: Boolean(r.graduated) }));
  return { sym: sym.toUpperCase(), n, top: out[0] || null, rows: out };
}

// ---------- writing ----------
const SYSTEM = `You name memecoins for Solana pump.fun launches. Answer with ONE JSON object only, no prose:
{"name": "...", "symbol": "...", "description": "..."}
Rules: name is 2-4 words, 32 characters at most, catchy and memeable, title case, no "coin" or "token" unless it is the joke.
symbol is 3-6 capital letters or digits (10 at most), easy to say, not an existing major ticker (BTC, ETH, SOL, USDC, DOGE, PEPE, WIF, BONK).
description is one or two punchy lines under 220 characters in the voice of the meme: no hashtags, no emojis, no promises about price or profit, no "community" boilerplate.`;
const writes = [];   // times of recent asks: a light cap so a stuck page cannot burn the login's quota
export async function writeCoin(idea, { hot = [] } = {}) {
  idea = String(idea || "").trim().replace(/\s+/g, " ").slice(0, 300);
  if (idea.length < 2) throw fail(400, "Say what the coin is about: a word or a line is enough.");
  if (claudeStatus().loginError) throw fail(503, "Writing is off on this server: it needs the Claude login on the owner's PC.");
  const t = Date.now();
  while (writes.length && writes[0] < t - 10 * 60_000) writes.shift();
  if (writes.length >= 30) throw fail(429, "Too many asks in a row. Try again in a few minutes.");
  writes.push(t);
  const prompt = `Idea: ${idea}${hot.length ? `\nWhat crypto X is posting about right now (use only if it fits the idea): ${hot.slice(0, 8).join("; ")}` : ""}`;
  const r = await ask(SYSTEM, prompt, 300, { model: FAST_MODEL, room: 0 });
  const j = extractJson(r.text);
  const name = String(j?.name || "").trim().replace(/\s+/g, " ").slice(0, 32);
  const symbol = String(j?.symbol || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 10);
  const description = String(j?.description || "").trim().replace(/\s+/g, " ").slice(0, 500);
  if (!name || !symbol) throw fail(502, "The model did not answer with a usable name. Try once more.");
  return { name, symbol, description, model: r.model };
}

// { ai: can write here, vanity: the vault's vanity stock and grind speed (null when the vault is not reachable) }
export async function launchStatus() {
  const vanity = await accounts().then((m) => m.vanityStatus()).catch(() => null);
  return { ai: !claudeStatus().loginError, vanity };
}
