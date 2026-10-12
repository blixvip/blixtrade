// The new Blix front end (web/, built with `npm run build` into web/dist), served on 127.0.0.1:4421 with no dev
// server. Normally the supervisor (bin/supervise.mjs) serves it and forwards /api to the radar over HTTP, so the
// page still loads while the radar restarts (it used to go blank for those seconds); run on its own, the radar
// serves it in-process as before.
//   /api/account/*  -> the accounts service beside the radar (127.0.0.1:4422), when it is running
//   /api/*, /img/*  -> the radar's own request handler, in this process
//   anything else   -> a file from web/dist, or the app's page for any route it does not know
// This PC only: the port is bound to 127.0.0.1, and the radar sees these requests as its own local page.
import crypto from "node:crypto";
import http from "node:http";
import { createByteCache } from './byte-cache.js';
import { proxyRequest, guardRequest } from './http-proxy.js';
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { visitorMay, memberMay, visitorHealth } from "./access.js";
import { verifyWalletIdentity } from "./wallet-identity.js";
import { createOriginGuard, isRelay } from './request-guard.js';
import { createTradeApi } from './tradeapi.js';
const originGuard = createOriginGuard();
// The trade API (keys, quote/build/send, the live stream), answered here and by the wallet service: never the radar.
const tradeApi = createTradeApi({ radarPort: Number(process.env.RADAR_PORT) || 4420 });
import { answer, kind, wrote, cacheReport } from "./apicache.js";
import { servePicture, pictureBatch, picStats, serveFar, farStats, warmFar } from "./pagepics.js";
import { searchTokens, searchable, warmSearch } from "./search.js";

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "web", "dist");
const PORT = Number(process.env.BLIX_WEB_PORT) || 4421;
const ACCOUNTS = { host: "127.0.0.1", port: Number(process.env.BLIX_ACCOUNTS_PORT) || 4422 };
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8" };
export const webStats = { on: false, port: PORT, built: null, error: null };

const files = createByteCache({ maxBytes: 64 * 1024 ** 2, maxEntries: 400, sizeOf: v => v.body.length });
function read(file) {
  const c = files.get(file);
  if (c && Date.now() - c.checked < 2000) return c.body;
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return null;
    if (c && c.mtime === st.mtimeMs) { c.checked = Date.now(); return c.body; }
    const body = fs.readFileSync(file);
    files.set(file, { body, mtime: st.mtimeMs, checked: Date.now() });
    return body;
  } catch { files.delete(file); return null; }
}

// Builds keep earlier chunks (web/vite.config.ts) so open tabs survive a rebuild; ones over a week old that the
// current page does not reference go, with their pre-compressed copies (scripts/precompress.mjs: x.js.br, x.js.gz).
// Read with fs.promises: it reads every chunk, and done in line it held up every request for a moment.
async function pruneAssets() {
  try {
    const dir = path.join(DIST, "assets"), html = await fs.promises.readFile(path.join(DIST, "index.html"), "utf8");
    // The page names its entry files, and those name the chunks loaded later (coin page, docs...): any file in
    // assets/ whose name appears in a file already in use is in use too.
    const names = await fs.promises.readdir(dir), all = names.filter((f) => !/\.(br|gz)$/.test(f));
    const used = new Set(all.filter((f) => html.includes(f))), todo = [...used];
    while (todo.length) {
      let text = "";
      try { text = await fs.promises.readFile(path.join(dir, todo.pop()), "utf8"); } catch {}
      for (const f of all) if (!used.has(f) && text.includes(f)) { used.add(f); todo.push(f); }
    }
    for (const f of names) {
      const full = path.join(dir, f), base = f.replace(/\.(br|gz)$/, "");
      if (used.has(base)) continue;
      const st = await fs.promises.stat(full).catch(() => null);
      // Two days, not a week: peers deploy every few minutes and the folder reached 32,565 files (2026-10-11).
    if (st && Date.now() - st.mtimeMs > 2 * 864e5) await fs.promises.rm(full).catch(() => {});
    }
  } catch {}
}

// /api and /img over HTTP to the radar, presented as its own local page (as the dev server's proxy does). While
// the radar is restarting this answers at once with a 503 the page already treats as "reconnecting".
// `local`: the browser is on this PC, so the radar is asked for the answer as it is (compressing it there is work
// on the radar's one thread that saves nothing). `allow`: extra headers for the answer (otherName below).
function toRadar(req, res, port, local, allow) {
  const headers = { ...req.headers, host: `localhost:${port}`, "x-forwarded-host": req.headers.host || "" };
  if (req.headers.origin) headers.origin = `http://localhost:${port}`;
  // A visitor reaches the radar as this PC: the radar must still leave the owner's own stream events out (server.js broadcast).
  if (req.visitor) headers["x-blix-visitor"] = "1";
  // A read for a browser over the tunnel: the radar is asked for plain JSON and it is compressed here, on zlib's
  // own threads; the radar compressed it on its one thread (brotliCompressSync), holding up everything else.
  // Live streams keep their own compression on the radar (per client, flushed per event).
  const stream = /\/stream(\?|$)/.test(req.url) || /event-stream/.test(String(req.headers.accept || ""));
  const accepts = String(req.headers["accept-encoding"] || "");
  const enc = local || stream || req.method !== "GET" ? null : /\bbr\b/.test(accepts) ? "br" : /\bgzip\b/.test(accepts) ? "gzip" : null;
  if (local || enc) headers["accept-encoding"] = "identity";
  return proxyRequest(req, res, { port, headers, stream, firstByteMs: req.method === 'GET' ? 15000 : 120000, onResponse: (r) => {
    const h = allow ? { ...r.headers, ...allow } : { ...r.headers };
    const len = Number(r.headers["content-length"]);
    if (enc && !r.headers["content-encoding"] && /json|text|javascript/.test(String(r.headers["content-type"] || "")) && !(len < 1024)) {
      delete h["content-length"];
      h["content-encoding"] = enc; h.vary = "accept-encoding";
      res.writeHead(r.statusCode || 502, h);
      const z = enc === "br" ? zlib.createBrotliCompress({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } }) : zlib.createGzip({ level: 5 });
      z.on("error", () => res.destroy());
      r.pipe(z).pipe(res);
      return z;
    }
    res.writeHead(r.statusCode || 502, h); r.pipe(res);
  } });
}

// Accounts are answered right here (accounts.js runs on its own and never opens the radar's database), so
// signing in and real trades work without a separate accounts process. Only if the module cannot load does
// the request go on to a separately started accounts server.
let accountsMod;
const accountsReady = import("./accounts.js").then((m) => { accountsMod = m; }).catch((e) => { console.error("[web] accounts unavailable here:", e.message); });
async function toAccountsHere(req, res) {
  await accountsReady;
  if (!accountsMod) return toAccounts(req, res);
  if (!(await accountsMod.handle(req, res, new URL(req.url, "http://x")))) { res.writeHead(404, { "content-type": "application/json" }); res.end('{"error":"not found"}'); }
}

function toAccounts(req, res) {
  const headers = { ...req.headers, origin: `http://localhost:${ACCOUNTS.port}`, "x-forwarded-host": req.headers.host || "" };
  return proxyRequest(req, res, { port: ACCOUNTS.port, headers, firstByteMs: 120000 });
}


// ---------- remote access (trade.blixvip.com, blixvip.com/trade) ----------
// The Cloudflare Tunnel points here, so a request whose Host is not this machine came over the internet, by way
// of the Worker (worker/index.js). The radar cannot tell (toRadar presents every request as its own local page),
// so who it is from is settled here. There is no access key: everyone signs in with Google at the edge and the
// Worker vouches for them on every request (x-blix-member*, signed with the shared settings.memberKey). A member
// whose email the Worker marks as the owner's (x-blix-owner, in the same signature) runs as the terminal itself;
// any other member runs as themselves (x-blix-as, their own paper desk) and may do what access.js memberMay says.
// With publicMode on, anyone may read (access.js visitorMay) and nothing else; otherwise 401.
const LOCAL_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`]);
const SETTINGS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "settings.json");
let remote = { t: 0, open: false, memberKey: null, edgeKey: null, wallets: false };
function remoteSettings() {
  if (Date.now() - remote.t < 10_000) return remote;
  try { const j = JSON.parse(fs.readFileSync(SETTINGS, "utf8")); remote = { t: Date.now(), open: Boolean(j.publicMode), memberKey: j.memberKey || null, edgeKey: j.edgeKey || null, wallets: j.hostedWallets === true }; }
  catch { remote = { ...remote, t: Date.now() }; }
  return remote;
}
const safeEq = (a, b) => typeof a === "string" && typeof b === "string" && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const SIGN_IN = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Blix</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1117;color:#e6e8ef;font:15px system-ui,sans-serif;text-align:center}h1{font-size:18px;margin:0 0 6px}p{color:#8b90a0;margin:0}a{color:#7aa2ff}</style>
<div><h1>Blix</h1><p>Sign in at <a href="https://blixvip.com/start">blixvip.com</a> to use the terminal.</p></div>`;
// A member's request: the Worker signs their email and the time (HMAC-SHA256, settings.memberKey), with ".owner"
// in the signed text when the email is the owner's. Good for 5 minutes either way of this server's clock.
// { email, owner } or null.
function memberOf(req, memberKey) {
  const email = String(req.headers["x-blix-member"] || ""), t = Number(req.headers["x-blix-member-t"]), sig = String(req.headers["x-blix-member-sig"] || "");
  const owner = req.headers["x-blix-owner"] === "1";
  if (!memberKey || memberKey.length < 32 || !email || !(Math.abs(Date.now() - t) < 5 * 60_000)) return null;
  const want = crypto.createHmac("sha256", memberKey).update(`${email}.${req.headers["x-blix-member-t"]}${owner ? ".owner" : ""}`).digest("hex");
  return safeEq(sig, want) ? { email: email.toLowerCase().slice(0, 200), owner } : null;
}
// The direct line (web/src/lib/api.ts): the page on blixvip.com asks this server at its own address
// (origin.blixvip.com) instead of going through the Worker for every read, and shows the member cookie the Worker
// set when it served the page (blix_m = <email, base64url>.<ms>.<1 if owner>.<HMAC hex over
// "<email>.<ms>.cookie[.owner]" with settings.memberKey>, worker/index.js). Good for two hours. { email, owner } or null.
// 20 minutes (+5 for clock drift): an account paused in /__admin loses the direct line that soon, not two hours later.
const COOKIE_MS = 20 * 60_000 + 5 * 60_000;
// The page's Content-Security-Policy: scripts from this origin, the page's own inline scripts by hash (worked out
// once per built file), and Cloudflare's analytics beacon. Everything else (pictures, frames, connections) is left
// as it was: the page reads from many sites, and those carry no script.
const cspKept = new Map();
function pageCsp(file, body) {
  // Keyed by the content, not the length: a rebuilt page of the same length (new asset names are the same length)
  // kept the old build's hashes, and the browser blocked its inline scripts.
  const key = `${file}:${crypto.createHash("sha1").update(body).digest("base64")}`;
  let csp = cspKept.get(key);
  if (csp) return csp;
  const text = String(body);
  const hashes = [...text.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .filter(([, attrs = ""]) => !/\bsrc\s*=/i.test(attrs) && !/type\s*=\s*["']?application\/(ld\+)?json/i.test(attrs))
    .map(([, , js]) => `'sha256-${crypto.createHash("sha256").update(js.replace(/\r\n?/g, "\n")).digest("base64")}'`);
  csp = `frame-ancestors 'none'; script-src 'self' ${hashes.join(" ")} https://static.cloudflareinsights.com; object-src 'none'; base-uri 'self'`;
  if (cspKept.size > 20) cspKept.clear();
  cspKept.set(key, csp);
  return csp;
}
function cookieMember(req, memberKey) {
  const raw = (String(req.headers.cookie || "").match(/(?:^|;\s*)blix_m=([^;]+)/) || [])[1];
  if (!raw || !memberKey || memberKey.length < 32) return null;
  const [email64, t, own, sig] = raw.split(".");
  if (!email64 || !t || !sig || !(Math.abs(Date.now() - Number(t)) < COOKIE_MS)) return null;
  let email;
  try { email = Buffer.from(email64, "base64url").toString("utf8"); } catch { return null; }
  if (!email || email.length > 200) return null;
  const owner = own === "1";
  const want = crypto.createHmac("sha256", memberKey).update(`${email}.${t}.cookie${owner ? ".owner" : ""}`).digest("hex");
  return safeEq(sig, want) ? { email: email.toLowerCase(), owner } : null;
}
// The pages that may use the direct line, and so read answers across origins (CORS, with the cookie).
const OUR_PAGES = /^https:\/\/(www\.|trade\.)?blixvip\.com$/;
// A coin's logo: /img/<mint>, or /img/<mint>.webp on the direct line (the type is whatever the picture is).
const PIC_PATH = /^\/img\/([1-9A-HJ-NP-Za-km-z]{32,44})(\.webp)?$/;
// Requests per minute one member may make on the direct line (the Worker paces the same on its path).
const pace = new Map();   // email -> { t: window start, n }
function overPace(key, perMin) {
  const t = Date.now(), e = pace.get(key);
  if (!e || t - e.t > 60_000) { pace.set(key, { t, n: 1 }); if (pace.size > 5000) pace.clear(); return false; }
  return ++e.n > perMin;
}
// The page's hints to the answer keeper (server/apicache.js) come as query parameters, _k=<ms> (x-blix-kept) and
// _f=<ms> (x-blix-fresh): a header of our own on a read across origins (the direct line) makes the browser ask
// first with an OPTIONS request, one more trip through the tunnel before every new address. They are taken off
// the address here, so the kept answer and the radar see the same address as without them.
function liftHints(req) {
  const url = String(req.url), q = url.indexOf("?");
  if (q < 0 || !/[?&]_[kf]=/.test(url)) return;
  const rest = [];
  for (const part of url.slice(q + 1).split("&")) {
    const m = /^_([kf])=(\d{1,6})$/.exec(part);
    if (m) req.headers[m[1] === "k" ? "x-blix-kept" : "x-blix-fresh"] = m[2];
    else rest.push(part);
  }
  req.url = url.slice(0, q) + (rest.length ? "?" + rest.join("&") : "");
}

// true = answered here (refusal or the sign-in note); false = go on.
function remoteGate(req, res) {
  // Who a request runs as on the radar is said only by this process (x-blix-as, below), never by the browser.
  const { memberKey, edgeKey } = remoteSettings();
  let member = memberOf(req, memberKey);
  const walletProof = req.headers["x-blix-wallet"] || (String(req.headers.cookie || "").match(/(?:^|;\s*)blix_wallet=([^;]+)/) || [])[1];
  const edge = String(req.headers["x-blix-edge"] || "");
  // x-blix-ref: who invited this member (their email, from the Worker's sign-up records), sent with a trade so the
  // wallet service can credit the inviter. Believed only on a request that carries the edge key (the Worker's).
  const ref = String(req.headers["x-blix-ref"] || "");
  for (const h of ["x-blix-as", "x-blix-member", "x-blix-member-t", "x-blix-member-sig", "x-blix-owner", "x-blix-edge", "x-blix-wallet", "x-blix-ref"]) delete req.headers[h];
  if (LOCAL_HOSTS.has(String(req.headers.host || "").toLowerCase())) return false;
  if (!edgeKey || !memberKey || memberKey.length < 32) {
    res.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ error: 'Remote access is not configured.' })); return true;
  }
  // settings.edgeKey: a request that did not come through the Worker on blixvip.com (it adds this secret) is
  // answered only when it is our own page on the direct line: an Origin that is ours (or none: a plain navigation),
  // the member cookie, and an /api or /img path. The tunnel's own address leads nowhere otherwise.
  const origin = String(req.headers.origin || "");
  const url = new URL(req.url, "http://x");
  // The path as it is routed (decoded, fromHere below): "/%61pi/..." is "/api/..." and is judged as such.
  let pn;
  try { pn = decodeURIComponent(url.pathname); } catch { res.writeHead(400, { "content-type": "text/plain", "cache-control": "no-store" }); res.end("Bad path"); return true; }
  // A write from a browser must come from our own page: a cross-site form or script cannot make the owner's
  // browser post here (SameSite=Lax on the cookies is the first wall, this is the second). A request with no
  // Origin and no fetch metadata is not a browser's cross-site write (the terminal's own tools, curl).
  if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
    const site = String(req.headers["sec-fetch-site"] || "");
    const crossSite = origin ? !OUR_PAGES.test(origin) : site === "cross-site" || site === "same-site";
    if (crossSite) { res.writeHead(403, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify({ error: "Writes come only from Blix's own page." })); return true; }
  }
  if (edgeKey && !safeEq(edge, edgeKey)) {
    const ours = !origin || OUR_PAGES.test(origin);
    if (ours && origin) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("access-control-allow-credentials", "true");
      res.setHeader("access-control-expose-headers", "x-blix-age, x-blix-direct, x-blix-edge-error");
      res.setHeader("timing-allow-origin", origin);   // the page may see each read's size and timing (performance.getEntriesByType)
      res.setHeader("vary", "origin");
      if (req.method === "OPTIONS") {
        res.writeHead(204, { "access-control-allow-methods": "GET, HEAD, POST, DELETE, OPTIONS", "access-control-allow-headers": "content-type, x-blix-kept, x-blix-fresh", "access-control-max-age": "86400", "cache-control": "no-store" });
        res.end(); return true;
      }
    }
    // A coin's logo needs no cookie: it is public (visitors get them too), and on the direct line the page asks
    // for it as /img/<mint>.webp so Cloudflare's cache keeps it at the edge (an extension it caches by default)
    // instead of the Worker's cache, which cost a Worker request per picture.
    if (ours && (req.method === "GET" || req.method === "HEAD") && PIC_PATH.test(pn)) return originGuard(req, res, { path: pn, ip: req.headers['cf-connecting-ip'] || req.socket.remoteAddress });
    const direct = ours && (pn.startsWith("/api/") || pn.startsWith("/img/")) ? cookieMember(req, memberKey) : null;
    if (!direct) {
      // x-blix-direct: no tells the page to go back through the Worker for this visit (lib/api.ts fetchApi).
      if (ours && origin) { res.writeHead(401, { "content-type": "application/json", "cache-control": "no-store", "x-blix-direct": "no" }); res.end(JSON.stringify({ error: "Sign in at blixvip.com to use Blix." })); return true; }
      res.writeHead(403, { "content-type": "text/plain", "cache-control": "no-store" }); res.end("Use https://blixvip.com"); return true;
    }
    // Pictures are paced on their own (240 a minute, below): a coin page's known holders alone are ~100 faces, and
    // counting them here too ran members out of reads (429) with half the faces blank.
    member = direct;
    // Direct cookies are for reads. Writes must pass the Worker's fresh membership check.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !isRelay(direct.email, direct.owner, pn)) {
      res.writeHead(401, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-blix-direct': 'no' });
      res.end(JSON.stringify({ error: 'Use the main site for this action.' })); return true;
    }
  }
  // The Worker's own calls (handles and invites, server/handles.js): the edge key itself, never a member's cookie.
  if (pn.startsWith("/api/edge/")) {
    if (!safeEq(edge, edgeKey)) { res.writeHead(403, { "content-type": "application/json", "cache-control": "no-store" }); res.end('{"error":"Not allowed."}'); return true; }
    req.edgeCall = true; return false;
  }
  if (originGuard(req, res, { path: pn, account: member?.email, owner: member?.owner, ip: req.headers['cf-connecting-ip'] || req.socket.remoteAddress })) return true;
  const { open } = remoteSettings();
  if (member && remoteSettings().wallets) {
    req.liveWallets = true;
    req.walletMember = member.email;
    req.walletOwner = member.owner;
    req.walletIdentity = verifyWalletIdentity(walletProof, member.email, memberKey);
    if (ref && edgeKey && safeEq(edge, edgeKey) && ref.length <= 254) req.walletRef = ref.toLowerCase();
  }
  if (member?.owner) return false;   // the owner, from anywhere: the terminal's own requests
  if (member) {
    // /api/build: which web app build is on the server (fromHere), for the "new version" bar.
    if (!pn.startsWith("/api/") || pn === "/api/build" || memberMay(req.method, pn)) { req.member = member.email; return false; }
    res.writeHead(403, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify({ error: "Members can't use this part of Blix." })); return true;
  }
  if (open) {
    // A visitor's request: the radar cannot tell (see above), so what it holds back from visitors is held back here.
    if (visitorMay(req.method, pn)) { req.visitor = pn; return false; }
    res.writeHead(403, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify({ error: "This is the public view of Blix: it is read-only." })); return true;
  }
  if (pn.startsWith("/api/") || pn.startsWith("/img/")) {
    res.writeHead(401, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify({ error: "Sign in at blixvip.com to use Blix." })); return true;
  }
  res.writeHead(401, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" });
  res.end(SIGN_IN); return true;
}

const ZIPPABLE = new Set([".js", ".css", ".html", ".svg", ".json"]);
const zips = createByteCache({ maxBytes: 64 * 1024 ** 2, maxEntries: 400, sizeOf: v => v.body.length * 2 + 1024 });
// Brotli where the browser takes it (every current one does): ~15-20% smaller than gzip on these scripts.
// Compressed once per file and kept, off the main thread: done in line, the main script took this process
// 170-320 ms the first time it was asked for after each build, and every other request waited behind it.
// Only for readers over the tunnel; a browser on this PC gets the file as it is.
// A built file (assets/<name>-<hash>.js) may come with its copies compressed at build time at the best level
// (scripts/precompress.mjs): those are sent as they are, so the first reader after a deploy waits for nothing.
// Hashed names never change content, so a copy on disk is always the file's; other files are compressed here.
const HASHED = /[\\/]assets[\\/][^\\/]+-[\w-]{8}\.(js|css)$/;
function compressed(file, body, enc) {
  const key = `${enc}:${file}`, z = zips.get(key);
  if (z?.body === body) return z.zip;
  const ready = HASHED.test(file) ? read(`${file}.${enc === "br" ? "br" : "gz"}`) : null;
  const zip = ready ? Promise.resolve(ready) : new Promise((ok) => {
    const done = (err, out) => ok(err ? null : out);
    if (enc === "br") zlib.brotliCompress(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: body.length } }, done);
    else zlib.gzip(body, { level: 6 }, done);
  });
  zips.set(key, { body, zip });
  return zip;
}

// ---------- /api and /img when the radar is another process (the supervisor) ----------
// The radar does everything on one thread, so anything asked of it can wait seconds; this process is idle. What
// can be answered from here is: the answers the pages keep re-reading (apicache.js keeps the last one of each and
// sends it when the radar is slow or restarting), coin pictures already on disk (pagepics.js), and the open
// charts' prices from the radar's own thread for them (fastlane.js, its own port). The rest goes to the radar.
const FAST_PORT = Number(process.env.BLIX_FAST_PORT) || 4423;
const STREAMS = /^\/api\/(stream|feed\/stream|fast\/stream)$/;
// The page opens its live streams on this PC's other name (localhost <-> 127.0.0.1; lib/api.ts streamUrl). A
// browser sends only six requests at a time to one name and every open stream holds one of them for as long as
// its tab is open, so with a few tabs open nothing else got through. Only our own page on the other name may
// read them.
const PAGES = new Set([`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`]);
function otherName(req, p) {
  const o = req.headers.origin, h = String(req.headers.host || "").toLowerCase();
  return req.method === "GET" && STREAMS.test(p) && PAGES.has(o) && LOCAL_HOSTS.has(h) && o !== `http://${h}` ? { "access-control-allow-origin": o, vary: "origin" } : null;
}
let buildMemo = { t: 0, v: null };
function webBuild() {
  if (Date.now() - buildMemo.t < 10_000) return buildMemo.v;
  let v = null;
  try { v = (fs.readFileSync(path.join(DIST, "index.html"), "utf8").match(/assets.index-[A-Za-z0-9_-]+[.]js/) || [])[0] || null; } catch {}
  buildMemo = { t: Date.now(), v };
  return v;
}
const failed = (res) => () => { if (res.destroyed || res.writableEnded) return; if (!res.headersSent) res.writeHead(500, { "content-type": "application/json", "cache-control": "no-store" }); res.end('{"error":"Blix is busy. Trying again."}'); };
const json = (res, code, body, cache = "no-store") => { res.writeHead(code, { "content-type": "application/json", "cache-control": cache, "x-content-type-options": "nosniff" }); res.end(body); };

// GET /api/pics?m=<mint>,<mint>,...: the logos on disk as data URLs, as the radar's own answer (images.js batch).
async function pics(req, res, port, local) {
  const { out, complete } = await pictureBatch(String(new URL(req.url, "http://x").searchParams.get("m") || "").split(","), port);
  if (res.destroyed) return;
  let body = Buffer.from(JSON.stringify(out)), enc = null;
  if (!local && body.length >= 1024) {
    const accepts = String(req.headers["accept-encoding"] || "");
    enc = /\bbr\b/.test(accepts) ? "br" : /\bgzip\b/.test(accepts) ? "gzip" : null;
    const raw = body;
    if (enc) body = await new Promise((ok) => (enc === "br" ? zlib.brotliCompress(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length } }, (e, z) => ok(e ? raw : z)) : zlib.gzip(raw, { level: 4 }, (e, z) => ok(e ? raw : z))));
    if (body === raw) enc = null;
    if (res.destroyed) return;
  }
  // Every logo asked for was there: the browser may keep the answer a couple of minutes (a reload, or the same
  // list again, costs nothing). One still being fetched must be asked for again.
  res.writeHead(200, { "content-type": "application/json", "cache-control": complete ? "private, max-age=120" : "no-store", "x-content-type-options": "nosniff", ...(enc ? { "content-encoding": enc, vary: "accept-encoding" } : {}) });
  res.end(body);
}

// The Pulse board with its fractions cut to 6 significant digits (5621.622629734309 -> 5621.62): the board is the
// biggest read the page makes (~160 KB of rows), and those digits were ~11% of it after compression. Worked out
// once per kept answer (apicache.js shapes are kept per entry).
const roundedBoard = (j) => JSON.parse(JSON.stringify(j, (k, v) => (typeof v === "number" && !Number.isInteger(v) ? +v.toPrecision(6) : v)));
const memberToken = (j) => (j && typeof j === "object" && !Array.isArray(j) ? { ...j, paper: [], walletTrades: [], wallets: [], rule: null } : j);
// What a member's own answers are (paper.js keeps a desk per member; the coin page carries their positions).
const MEMBER_OWN = /^\/api\/(paper(\/.*)?|coin\/[1-9A-HJ-NP-Za-km-z]{32,44})$/;
function fromHere(req, res, p, port) {
  // The web app's build on disk (its main script): an open page compares it with its own and offers a reload after
  // a deploy (web/src/lib/update.tsx). Read at most every 10 s.
  if (req.method === "GET" && p === "/api/build") return json(res, 200, JSON.stringify({ main: webBuild() }));
  if (p === "/api/me" && req.liveWallets) return json(res, 200, JSON.stringify({ readonly: false, member: !req.walletOwner, email: req.walletMember, liveWallets: true }));
  const local = LOCAL_HOSTS.has(String(req.headers.host || "").toLowerCase()), get = req.method === "GET";
  if (p.startsWith("/api/fast/")) return toRadar(req, res, FAST_PORT, local, otherName(req, p));
  const pic = (get || req.method === "HEAD") && p.match(PIC_PATH);
  if (pic) return servePicture(pic[1], req, res, port, Boolean(pic[2])).catch(failed(res));
  if (get && p === "/api/pics") return pics(req, res, port, local).catch(failed(res));
  // A coin search (search.js): from the index kept here, in a few ms, never on the radar's thread.
  if (get && p === "/api/tokens") { const u = new URL(req.url, "http://x"); if (searchable(u)) return json(res, 200, JSON.stringify(searchTokens(u.searchParams))); }
  // A picture from elsewhere (a person's avatar, a post's photo), kept here (pagepics.js).
  if ((get || req.method === "HEAD") && (p === "/api/pic" || p === "/api/pic.webp")) {
    // A member may ask for 600 pictures a minute (a coin page's holders and theses are ~150, Pulse ~60); a kept one
    // costs a disk read, a new one a fetch.
    if (req.member && overPace(`pic:${req.member}`, 600)) return json(res, 429, '{"error":"Too many pictures at once. Slow down a little."}');
    return serveFar(req, res).catch(failed(res));
  }
  // A member: everything that is theirs (the paper desk, the coin page with their positions in it) straight from
  // the radar as them, never kept here (kept answers are shared by URL). Every other read from the kept answers
  // like anyone: the Pulse board, Fomo, X and the rest hold nothing of theirs (the "own" views show only what the
  // owner did), and each member reading the board from the radar cost it a 350 KB build and compression every
  // 12 s per member.
  if (req.member) {
    if (p === "/api/me") return json(res, 200, JSON.stringify({ readonly: false, member: true, email: req.member }));
    if (p === "/api/health") return answer(req, res, port, "market", local, visitorHealth).catch(failed(res));
    const cls = MEMBER_OWN.test(p) ? null : kind(req.method, req.url);
    // The coin page's shared answer was built for the owner: what is the owner's alone (their paper positions,
    // their followed wallets' trades and labels, their alert rule) is taken out before a member sees it.
    if (cls) return answer(req, res, port, cls, local, /^\/api\/token\//.test(p) ? memberToken : p === "/api/pulse" ? roundedBoard : undefined).catch(failed(res));
    req.headers["x-blix-as"] = req.member;
    return toRadar(req, res, port, local, null);
  }
  // A visitor (the public view) gets the radar's visitor answers, as its own remoteGate would give them.
  if (req.visitor === "/api/me") return json(res, 200, '{"readonly":true}');
  if (req.visitor === "/api/health") return answer(req, res, port, "market", local, visitorHealth).catch(failed(res));
  const cls = kind(req.method, req.url);
  if (cls) return answer(req, res, port, cls, local, req.visitor && /^\/api\/token\//.test(p) ? memberToken : p === "/api/pulse" ? roundedBoard : undefined).catch(failed(res));
  // A write: once it ends, views of the owner's own state are read from the radar again (apicache.js).
  if (!get && req.method !== "HEAD") res.on("close", wrote);
  return toRadar(req, res, port, local, otherName(req, p));
}

// `radar`: the radar's own http server when it serves the page in-process; null to forward over HTTP (supervisor).
export function startWebApp(radar, radarPort, { retryMs = 30_000 } = {}) {
  warmSearch();
  // The Feed's pictures (avatars, coin pictures, photos), fetched here at the sizes the page draws them the moment
  // their posts reach the radar (GET /api/feed/pics lists them while someone has had the Feed open in the last
  // 10 minutes), so the page finds every one already on disk.
  // Every 3 s while it lists pictures; every 15 s while it lists none (nobody has had the Feed open).
  const feedPics = () => {
    let next = 15_000;
    const again = () => setTimeout(feedPics, next).unref();
    const r = http.get({ host: "127.0.0.1", port: radarPort, path: "/api/feed/pics", headers: { host: `localhost:${radarPort}` }, timeout: 3000 }, (res) => {
      let b = ""; res.setEncoding("utf8"); res.on("data", (c) => { b += c; if (b.length > 2e6) res.destroy(); });
      res.on("end", () => { try { const j = JSON.parse(b); if (Array.isArray(j.pics) && j.pics.length) { next = 3000; warmFar(j.pics); } } catch {} });
      res.on("close", again);
    });
    r.on("error", () => { if (!r.res) again(); }); r.on("timeout", () => r.destroy());
  };
  setTimeout(feedPics, 3000).unref();
  const handle = (req, res) => {
    liftHints(req);
    // A bot's call with its API key (Authorization: Bearer blx_live_…): no member, no cookie. From the Worker (it adds
    // the edge key) or from this machine; paced per key inside. Everything else under /api/v1 (a member's keys page)
    // goes through the usual gate below and is answered as that member.
    if (String(req.url).startsWith("/api/v1/") && /^Bearer blx_live_/.test(String(req.headers.authorization || ""))) {
      const { edgeKey } = remoteSettings();
      const local = LOCAL_HOSTS.has(String(req.headers.host || "").toLowerCase());
      if (!local && !(edgeKey && safeEq(String(req.headers["x-blix-edge"] || ""), edgeKey))) { res.writeHead(403, { "content-type": "application/json", "cache-control": "no-store" }); return res.end('{"error":"Use https://blixvip.com"}'); }
      if (originGuard(req, res, { path: new URL(req.url, "http://x").pathname, account: `key:${String(req.headers.authorization).slice(-12)}`, ip: req.headers['cf-connecting-ip'] || req.socket.remoteAddress })) return;
      return tradeApi.handle(req, res, new URL(req.url, "http://x"), {}).catch(failed(res));
    }
    if (remoteGate(req, res)) return;
    let p;
    try { p = decodeURIComponent(String(req.url).split("?")[0]); } catch { res.writeHead(400, { "content-type": "text/plain", "cache-control": "no-store" }); return res.end("Bad request"); }
    if (p.startsWith("/api/account/")) { if (req.method !== "GET" && req.method !== "HEAD") res.on("close", wrote); return toAccountsHere(req, res); }
    // A member's trade-API keys and usage (tradeapi.js), as the member the Worker vouched for (the owner included).
    if (p.startsWith("/api/v1/")) {
      const local = LOCAL_HOSTS.has(String(req.headers.host || "").toLowerCase());
      return tradeApi.handle(req, res, new URL(req.url, "http://x"), { email: req.walletMember || req.member || (local ? "owner@localhost" : null) }).catch(failed(res));
    }
    if (p.startsWith("/api/edge/") && req.edgeCall) return toAccountsHere(req, res);
    // What this process is keeping and how often it was enough, for checking by hand on this PC.
    if (p === "/__cache" && LOCAL_HOSTS.has(String(req.headers.host || "").toLowerCase())) return json(res, 200, JSON.stringify({ answers: cacheReport(), pictures: picStats, far: farStats }));
    if (p.startsWith("/api/") || p.startsWith("/img/")) {
      if (!radar) return fromHere(req, res, p, radarPort);
      // Hand the request to the radar as the local page it is (a member's, as them).
      if (req.member) req.headers["x-blix-as"] = req.member;
      req.headers.host = `localhost:${radarPort}`;
      if (req.headers.origin) req.headers.origin = `http://localhost:${radarPort}`;
      return radar.emit("request", req, res);
    }
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end(); }
    const file = path.join(DIST, p === "/" ? "index.html" : p);
    const inside = file.startsWith(DIST + path.sep);
    // A missing built file is a 404, never the page: a script import answered with HTML fails in a way the page
    // cannot recover from, and took the whole app down to a blank screen after rebuilds.
    if (p.startsWith("/assets/") && !(inside && read(file))) { res.writeHead(404, { "content-type": "text/plain", "cache-control": "no-store" }); return res.end("Not found"); }
    const fileBody = inside && read(file);
    const body = fileBody || read(path.join(DIST, "index.html"));
    if (!body) { res.writeHead(503, { "content-type": "text/plain; charset=utf-8" }); return res.end("The new Blix page has not been built yet. In the web folder run: npm run build"); }
    const isFile = Boolean(fileBody);
    // Text files go out compressed (once per file and kept), Brotli first, else gzip: it matters through the tunnel.
    const accepts = String(req.headers["accept-encoding"] || ""), enc = /\bbr\b/.test(accepts) ? "br" : /gzip/.test(accepts) ? "gzip" : null;
    const local = LOCAL_HOSTS.has(String(req.headers.host || "").toLowerCase());
    const zipping = !local && isFile && enc && ZIPPABLE.has(path.extname(file)) ? compressed(file, body, enc) : null;
    const send = (zip) => {
      if (res.destroyed) return;
      res.writeHead(200, {
        ...(zip ? { "content-encoding": enc, vary: "accept-encoding" } : {}),
        "content-type": TYPES[isFile ? path.extname(file) : ".html"] || "application/octet-stream",
        // Built files carry their content in their name and never change; the page itself is always re-checked.
        "cache-control": isFile && p.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
        "x-content-type-options": "nosniff",
        // The page itself: never inside another site's frame (clickjacking), no full addresses in referers,
        // no device access.
        // Any HTML (the page also comes as /index.html or / itself, which counted as a plain file and went out with
        // none of this). Scripts only from here and the page's own inline ones (hashed), so text a coin's creator
        // wrote can never run as script even if it slipped past React's escaping.
        ...(isFile && path.extname(file) !== ".html" ? {} : { "content-security-policy": pageCsp(file, body), "x-frame-options": "DENY", "referrer-policy": "strict-origin-when-cross-origin", "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()" }),
      });
      res.end(req.method === "HEAD" ? undefined : zip || body);
    };
    if (zipping) zipping.then(send, () => send(null)); else send(null);
  };
  // An idle connection is kept a minute, not Node's five seconds: a page that reads every few seconds reuses its
  // connections instead of opening new ones.
  // The trade API's live stream is a WebSocket (ws-lite.js): the upgrade is answered by tradeapi.js with the same
  // rule as its other routes (the edge key from the Worker, or this machine) and the caller's key.
  const onUpgrade = (req, socket) => {
    const allowed = (r) => { const { edgeKey } = remoteSettings(); return LOCAL_HOSTS.has(String(r.headers.host || "").toLowerCase()) || Boolean(edgeKey && safeEq(String(r.headers["x-blix-edge"] || ""), edgeKey)); };
    if (!tradeApi.upgrade(req, socket, { allowed })) { socket.write("HTTP/1.1 404 Not Found\r\nconnection: close\r\n\r\n"); socket.destroy(); }
  };
  const make = () => { const s = http.createServer(guardRequest(handle)); s.keepAliveTimeout = 65_000; s.headersTimeout = 70_000; s.on("upgrade", onUpgrade); return s; };
  const server = make();
  const listen = () => server.listen(PORT, "127.0.0.1");
  server.on("listening", () => { webStats.on = true; webStats.error = null; });
  // Something else on the port (a dev server someone started): keep trying, never take the radar down over it.
  server.on("error", (e) => { webStats.on = false; webStats.error = e.code === "EADDRINUSE" ? `port ${PORT} is in use by another program` : e.message; setTimeout(listen, retryMs).unref?.(); });
  listen();
  // The same on ::1. To a browser "localhost" is ::1 first, and with nothing listening there every new connection
  // waited about 200 ms before it fell back to 127.0.0.1 (measured 2026-10-06: connect 203 ms against 1 ms).
  // A PC without IPv6 simply has 127.0.0.1 alone, as before.
  const server6 = make();
  const listen6 = () => server6.listen(PORT, "::1");
  server6.on("error", (e) => { if (e.code === "EADDRINUSE") setTimeout(listen6, retryMs).unref?.(); });
  listen6();
  try { webStats.built = fs.statSync(path.join(DIST, "index.html")).mtimeMs; } catch {}
  pruneAssets();
  setInterval(pruneAssets, 6 * 3600e3).unref?.();
  return server;
}
