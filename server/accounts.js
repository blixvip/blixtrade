// Accounts with a real wallet: sign in with Google, get a wallet, deposit, buy, sell, withdraw.
//
// Blix never sees a wallet key. Keys are made and held by Blix Vault (a separate app on this PC,
// C:\code\blix-vault); this file keeps who signed in and their session, and asks the vault to act for
// them. Mounted by server.js as: if (await accounts.handle(req, res, url)) return;
//
// Real money. Local only: requests that arrive through the public hostname are refused.
//
// Google sign-in is the plain server-side flow (no Google script on the page, so the page's
// script-src 'self' policy stays): /api/account/google sends the browser to Google, Google sends it back
// to /api/account/google/callback with a code, and the code is exchanged for the person's verified email.
// The client id and secret come from data/google.json: { "clientId": "…", "clientSecret": "…" }.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { initSocial, socialRoute } from "./social.js";
import { createHostedAccounts } from "./hosted-accounts.js";
import { createHandles } from "./handles.js";
import { initCreator, creatorRewards } from "./creator.js";

// Same data folder as the radar (db.js), worked out here so this file can also run on its own
// (server/accounts-server.mjs) without opening the radar's database.
const DATA = process.env.RADAR_DATA ? path.resolve(process.env.RADAR_DATA) : path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");

// Nothing here may stop the radar from starting: if the account database cannot be opened, accounts
// answer 503 and everything else carries on.
let adb = null;
try {
  adb = new DatabaseSync(path.join(DATA, "accounts.db"));
  adb.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS accounts (id INTEGER PRIMARY KEY, google_sub TEXT NOT NULL UNIQUE, email TEXT NOT NULL COLLATE NOCASE, name TEXT, picture TEXT,
      vault_id INTEGER, address TEXT, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, account_id INTEGER NOT NULL, expires INTEGER NOT NULL, authed INTEGER NOT NULL);
  `);
} catch (e) { adb = null; console.error("[accounts] the account database could not be opened:", e.message); }
try { if (adb) initSocial(adb, DATA); } catch (e) { console.error("[accounts] profiles could not be set up:", e.message); }
try { if (adb) initCreator(adb); } catch (e) { console.error("[accounts] creator rewards could not be set up:", e.message); }

const fail = (status, message) => Object.assign(new Error(message), { status });
const send = (res, code, body, extra = {}) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra }); res.end(JSON.stringify(body)); };
const redirect = (res, to, cookies = []) => { res.writeHead(302, { location: to, "cache-control": "no-store", "set-cookie": cookies }); res.end(); };
const readBody = (req, max = 1e5) => new Promise((ok) => { let b = ""; req.on("data", (c) => { b += c; if (b.length > max) req.destroy(); }); req.on("end", () => { try { ok(JSON.parse(b || "{}")); } catch { ok({}); } }); });
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const cookie = (req, name) => new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(req.headers.cookie || "")?.[1];

// ---------- the vault ----------
// Its address and service token are read from the vault's own config file (same PC, same Windows user).
const VAULT_CONFIG = process.env.BLIX_VAULT_CONFIG || path.join(process.env.APPDATA || os.homedir(), "blix-vault", "config.json");
async function vault(pathname, body) {
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(VAULT_CONFIG, "utf8")); } catch { throw fail(503, "Blix Vault is not set up on this PC yet."); }
  let r;
  try {
    r = await fetch(`http://127.0.0.1:${cfg.port || 4470}/v1${pathname}`, { method: body ? "POST" : "GET", signal: AbortSignal.timeout(90_000),
      headers: { authorization: `Bearer ${cfg.serviceToken}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  } catch { throw fail(503, "Blix Vault is not running. Start it, then try again."); }
  const j = await r.json().catch(() => null);
  if (!r.ok) throw fail(r.status === 401 ? 503 : r.status, j?.error || `Vault error ${r.status}`);
  return j;
}

// ---------- Google ----------
const GOOGLE_FILE = path.join(DATA, "google.json");
const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = process.env.BLIX_GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token";   // overridable for tests
function google() {
  try {
    const g = JSON.parse(fs.readFileSync(GOOGLE_FILE, "utf8"));
    return g.clientId && g.clientSecret ? g : null;
  } catch { return null; }
}
// The address the browser is really on. The new front end's dev server (:4421) forwards requests here
// and says so; that header is believed only when it names this PC.
const LOCAL = /^(localhost|127\.0\.0\.1)(:\d+)?$/i;
const hostOf = (req) => { const f = String(req.headers["x-forwarded-host"] || ""); return LOCAL.test(f) ? f : req.headers.host; };
// Open to the internet only when the owner says so: google.json carries "publicHost": "trade.blixvip.com".
// Without that line, anything not addressed to this PC is refused.
const onPublic = (req, g) => Boolean(g?.publicHost) && String(req.headers.host || "").toLowerCase() === String(g.publicHost).toLowerCase();
const callbackUrl = (req, g) => onPublic(req, g) ? `https://${g.publicHost}/api/account/google/callback` : `http://${hostOf(req)}/api/account/google/callback`;
const secure = (req, g) => (onPublic(req, g) ? "; Secure" : "");
// New wallets per network per day, so one visitor cannot fill the vault with accounts.
const SIGNUPS_PER_DAY = 3, signups = new Map();
function signupAllowed(req) {
  const who = String(req.headers["cf-connecting-ip"] || req.socket.remoteAddress || "?"), now = Date.now();
  const list = (signups.get(who) || []).filter((t) => now - t < 86400_000);
  if (list.length >= SIGNUPS_PER_DAY) return false;
  list.push(now); signups.set(who, list);
  if (signups.size > 20_000) signups.clear();
  return true;
}

// Exchange the code Google sent back for the person it belongs to. The answer comes straight from
// Google over TLS, so the token's own signature need not be checked again; its audience and expiry are.
async function googleProfile(code, req, g) {
  let r;
  try {
    r = await fetch(GOOGLE_TOKEN, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(15_000),
      body: new URLSearchParams({ code, client_id: g.clientId, client_secret: g.clientSecret, redirect_uri: callbackUrl(req, g), grant_type: "authorization_code" }) });
  } catch { throw fail(503, "Google did not answer. Try again."); }
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.id_token) throw fail(401, `Google refused the sign-in${j?.error ? ` (${j.error})` : ""}.`);
  let claims;
  try { claims = JSON.parse(Buffer.from(j.id_token.split(".")[1], "base64url").toString("utf8")); } catch { throw fail(401, "Google sent an unreadable answer."); }
  if (claims.aud !== g.clientId || !["https://accounts.google.com", "accounts.google.com"].includes(claims.iss) || claims.exp * 1000 < Date.now()) throw fail(401, "That Google sign-in was not meant for Blix.");
  if (!claims.sub || !claims.email || claims.email_verified !== true) throw fail(401, "That Google account has no verified email.");
  return { sub: String(claims.sub), email: String(claims.email).toLowerCase(), name: claims.name || null, picture: claims.picture || null };
}

// ---------- sessions ----------
const SESSION_MS = 30 * 86400_000, FRESH_MS = 10 * 60_000;
function startSession(accountId, flags = "") {
  const token = crypto.randomBytes(32).toString("base64url");
  adb.prepare("INSERT INTO sessions (token, account_id, expires, authed) VALUES (?, ?, ?, ?)").run(sha(token), accountId, Date.now() + SESSION_MS, Date.now());   // only the hash is stored
  return `blix_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${flags}`;
}
function sessionOf(req) {
  const token = cookie(req, "blix_session");
  if (!token) return null;
  const s = adb.prepare("SELECT account_id, expires, authed FROM sessions WHERE token = ?").get(sha(token));
  if (!s || s.expires < Date.now()) return null;
  const account = adb.prepare("SELECT * FROM accounts WHERE id = ?").get(s.account_id);
  return account ? { account, authed: s.authed } : null;
}

// Card payments. data/onramp.json: { "stripeSecret": "sk_live_…" } switches Stripe on; without it only the
// providers that need no key from Blix are offered (the page links to them directly).
const onramp = () => { try { return JSON.parse(fs.readFileSync(path.join(DATA, "onramp.json"), "utf8")) || {}; } catch { return {}; } };

const MINT =/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const handles = adb ? createHandles({ db: adb }) : null;
const hosted = adb ? createHostedAccounts({ db: adb, vault, launch: launchCoin, rewards: rewardsFor, refOf: handles?.refOf }) : null;
const HOME = "/#/account";
// A new coin: the picture and details are pinned to IPFS through pump.fun's own uploader, then the vault
// builds, signs and sends the create (+ the creator's first buy) from this wallet. Used by both sign-ins.
async function launchCoin(vaultId, body) {
  const name = String(body.name || "").trim(), symbol = String(body.symbol || "").trim().replace(/^\$/, "").toUpperCase();
  if (!name || name.length > 32) throw fail(400, "The name is 1 to 32 characters.");
  if (!/^[A-Z0-9]{1,10}$/.test(symbol)) throw fail(400, "The ticker is 1 to 10 letters or numbers.");
  const img = /^data:(image\/(png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(body.image || ""));
  if (!img) throw fail(400, "Add a picture (PNG, JPG, GIF or WebP).");
  const bytes = Buffer.from(img[3], "base64");
  if (bytes.length > 4.3e6) throw fail(400, "The picture is over 4 MB.");
  const link = (v, re) => { v = String(v || "").trim(); if (!v) return ""; if (!/^https:\/\/\S{3,200}$/.test(v) || (re && !re.test(v))) throw fail(400, `That is not a working link: ${v.slice(0, 60)}`); return v; };
  const fd = new FormData();
  fd.append("file", new Blob([bytes], { type: img[1] }), `coin.${img[2] === "jpeg" ? "jpg" : img[2]}`);
  fd.append("name", name); fd.append("symbol", symbol); fd.append("description", String(body.description || "").trim().slice(0, 500));
  fd.append("twitter", link(body.twitter, /^https:\/\/(x|twitter)\.com\//)); fd.append("telegram", link(body.telegram, /^https:\/\/t\.me\//)); fd.append("website", link(body.website));
  fd.append("showName", "true");
  let meta;
  try {
    const r = await fetch("https://pump.fun/api/ipfs", { method: "POST", body: fd, signal: AbortSignal.timeout(45_000) });
    meta = await r.json().catch(() => null);
    if (!r.ok || !meta?.metadataUri) throw new Error(`HTTP ${r.status}`);
  } catch (e) { throw fail(502, `The picture could not be uploaded to IPFS (${e.message}). Try again.`); }
  const out = await vault(`/users/${vaultId}/launch`, { name, symbol, uri: meta.metadataUri, sol: +body.sol || 0, slippageBps: body.slippageBps });
  return { ...out, uri: meta.metadataUri, image: meta.metadata?.image || null };
}

// Creator rewards: what the vault says can be claimed now, plus the history and coins (creator.js).
async function rewardsFor(vaultId) {
  const [due, txs] = await Promise.all([vault(`/users/${vaultId}/rewards`), vault(`/users/${vaultId}/txs`).catch(() => [])]);
  return creatorRewards(due, txs);
}

async function route(req, res, url) {
  const p = url.pathname, m = req.method, g = google();

  // Step 1: off to Google. `confirm=1` makes Google ask for the password again (used before moving money out).
  if (p === "/api/account/google" && m === "GET") {
    if (!g) throw fail(503, "Google sign-in is not set up yet (data/google.json is missing).");
    const state = crypto.randomBytes(24).toString("base64url");
    const q = new URLSearchParams({ client_id: g.clientId, redirect_uri: callbackUrl(req, g), response_type: "code", scope: "openid email profile", state,
      ...(url.searchParams.get("confirm") === "1" ? { max_age: "0", prompt: "login" } : { prompt: "select_account" }) });
    return redirect(res, `${GOOGLE_AUTH}?${q}`, [`blix_oauth=${state}; HttpOnly; SameSite=Lax; Path=/api/account/google; Max-Age=600${secure(req, g)}`]);
  }
  // Step 2: back from Google. Make the account and its wallet if this person is new, then sign them in.
  if (p === "/api/account/google/callback" && m === "GET") {
    const clear = "blix_oauth=; HttpOnly; SameSite=Lax; Path=/api/account/google; Max-Age=0";
    const back = (why) => redirect(res, `${HOME}/e/${encodeURIComponent(why)}`, [clear]);
    if (!g) return back("Google sign-in is not set up yet.");
    if (url.searchParams.get("error")) return back("Sign-in was cancelled.");
    const state = url.searchParams.get("state"), expected = cookie(req, "blix_oauth"), code = url.searchParams.get("code");
    if (!code || !state || !expected || !same(state, expected)) return back("That sign-in link expired. Try again.");
    let who;
    try { who = await googleProfile(code, req, g); } catch (e) { return back(e.message); }
    let acc = adb.prepare("SELECT * FROM accounts WHERE google_sub = ?").get(who.sub);
    if (!acc) {
      if (!signupAllowed(req)) return back("Too many new accounts from this network today. Try again tomorrow.");
      const id = adb.prepare("INSERT INTO accounts (google_sub, email, name, picture, created) VALUES (?, ?, ?, ?, ?)").run(who.sub, who.email, who.name, who.picture, Date.now()).lastInsertRowid;
      try {
        const v = await vault("/users", { email: who.email, ref: `blix:${id}` });
        adb.prepare("UPDATE accounts SET vault_id = ?, address = ? WHERE id = ?").run(v.id, v.address, id);
      } catch (e) { adb.prepare("DELETE FROM accounts WHERE id = ?").run(id); return back(e.message); }   // no account without a wallet
      acc = { id };
    } else adb.prepare("UPDATE accounts SET email = ?, name = ?, picture = ? WHERE id = ?").run(who.email, who.name, who.picture, acc.id);
    return redirect(res, HOME, [clear, startSession(Number(acc.id), secure(req, g))]);
  }

  const s = sessionOf(req), me = s?.account;
  if (p === "/api/account/me" && m === "GET") {
    if (!me) return send(res, 200, { signedIn: false, google: Boolean(g) });
    let wallet = null, problem = null;
    try { wallet = await vault(`/users/${me.vault_id}/wallet`); } catch (e) { problem = e.message; }
    return send(res, 200, { signedIn: true, email: me.email, name: me.name, picture: me.picture, address: me.address, wallet, problem, onramp: { stripe: Boolean(onramp().stripeSecret) } });
  }
  if (p === "/api/account/logout" && m === "POST") {
    const t = cookie(req, "blix_session"); if (t) adb.prepare("DELETE FROM sessions WHERE token = ?").run(sha(t));
    return send(res, 200, { signedIn: false }, { "set-cookie": "blix_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" });
  }
  // Profiles, people and following (server/social.js); some of it is open to visitors who are not signed in.
  if (await socialRoute(req, res, url, { me, send, fail, readBody, vault })) return;
  if (!me) throw fail(401, "Sign in first.");
  const body = m === "POST" ? await readBody(req, p === "/api/account/launch" ? 6e6 : 1e5) : {};   // a launch carries the coin picture
  // Moving money out, or showing the key, needs a Google sign-in from the last ten minutes.
  const fresh = () => { if (Date.now() - s.authed > FRESH_MS) throw Object.assign(fail(401, "Sign in with Google again to confirm this."), { confirm: true }); };
  if (p === "/api/account/txs" && m === "GET") return send(res, 200, await vault(`/users/${me.vault_id}/txs`));
  if (p === "/api/account/buy" && m === "POST") {
    if (!MINT.test(String(body.mint || ""))) throw fail(400, "That is not a coin's contract address.");
    return send(res, 200, await vault(`/users/${me.vault_id}/swap`, { side: "buy", mint: body.mint, sol: body.sol, slippageBps: body.slippageBps }));
  }
  if (p === "/api/account/sell" && m === "POST") {
    if (!MINT.test(String(body.mint || ""))) throw fail(400, "That is not a coin's contract address.");
    return send(res, 200, await vault(`/users/${me.vault_id}/swap`, { side: "sell", mint: body.mint, pct: body.pct, slippageBps: body.slippageBps }));
  }
  if (p === "/api/account/launch" && m === "POST") return send(res, 200, await launchCoin(me.vault_id, body));
  if (p === "/api/account/rewards" && m === "GET") return send(res, 200, await rewardsFor(me.vault_id));
  if (p === "/api/account/claim" && m === "POST") return send(res, 200, await vault(`/users/${me.vault_id}/claim`, {}));
  // Paying by card: Stripe's own hosted page takes the payment and sends the SOL to this person's wallet.
  if (p === "/api/account/onramp" && m === "POST") {
    const key = onramp().stripeSecret;
    if (body.provider !== "stripe" || !key) throw fail(404, "That payment method is not set up.");
    let r;
    try {
      r = await fetch("https://api.stripe.com/v1/crypto/onramp_sessions", { method: "POST", signal: AbortSignal.timeout(20_000),
        headers: { authorization: `Bearer ${key}`, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ "wallet_addresses[solana]": me.address, lock_wallet_address: "true", "destination_networks[]": "solana", destination_network: "solana",
          "destination_currencies[]": "sol", destination_currency: "sol" }) });
    } catch { throw fail(503, "Stripe did not answer. Try again."); }
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.redirect_url) throw fail(502, `Stripe: ${String(j?.error?.message || `HTTP ${r.status}`).slice(0, 200)}`);
    return send(res, 200, { url: j.redirect_url });
  }
  if (p === "/api/account/withdraw" && m === "POST") { fresh(); return send(res, 200, await vault(`/users/${me.vault_id}/withdraw`, { to: body.to, sol: body.sol })); }
  if (p === "/api/account/export" && m === "POST") { fresh(); return send(res, 200, await vault(`/users/${me.vault_id}/export`, {})); }
  throw fail(404, "Not found.");
}

// Returns true when the request was an account request (answered here), false to let server.js carry on.
export async function handle(req, res, url) {
  // Handles and invites (server/handles.js): the Worker's edge calls, and a member's own handle.
  if (url.pathname.startsWith("/api/edge/")) return req.edgeCall && handles ? handles.edge(req, res, url) : false;
  if (!url.pathname.startsWith("/api/account/")) return false;
  if (url.pathname === "/api/account/handle" && req.walletMember && handles) return handles.member(req, res, url);
  try {
    if (req.liveWallets && hosted) return await hosted(req, res, url);
    if (!LOCAL.test(String(req.headers.host || "")) && !onPublic(req, google())) throw fail(403, "Accounts and wallets are only available on the PC that runs Blix.");
    // A page on another site must not be able to drive an account: if a page made the request, it must be ours.
    const origin = String(req.headers.origin || "").replace(/^https?:\/\//, "");
    if (origin && !LOCAL.test(origin) && origin.toLowerCase() !== String(google()?.publicHost || "").toLowerCase()) throw fail(403, "That request did not come from Blix.");
    if (!adb) throw fail(503, "The account database could not be opened. See the Blix log.");
    await route(req, res, url);
  } catch (e) {
    if (!e.status) console.error("[accounts]", e);
    send(res, e.status || 500, { error: e.status ? e.message : "Something went wrong with the account service.", ...(e.confirm ? { confirm: true } : {}) });
  }
  return true;
}
