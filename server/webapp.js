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
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { visitorMay } from "./access.js";

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "web", "dist");
const PORT = Number(process.env.BLIX_WEB_PORT) || 4421;
const ACCOUNTS = { host: "127.0.0.1", port: Number(process.env.BLIX_ACCOUNTS_PORT) || 4422 };
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8" };
export const webStats = { on: false, port: PORT, built: null, error: null };

const files = new Map();     // path -> { body, mtime, checked }: read once, re-checked at most every 2 s
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
// current page does not reference go.
function pruneAssets() {
  try {
    const dir = path.join(DIST, "assets"), html = fs.readFileSync(path.join(DIST, "index.html"), "utf8");
    // The page names its entry files, and those name the chunks loaded later (coin page, docs...): any file in
    // assets/ whose name appears in a file already in use is in use too.
    const all = fs.readdirSync(dir), used = new Set(all.filter((f) => html.includes(f))), todo = [...used];
    while (todo.length) {
      let text = "";
      try { text = fs.readFileSync(path.join(dir, todo.pop()), "utf8"); } catch {}
      for (const f of all) if (!used.has(f) && text.includes(f)) { used.add(f); todo.push(f); }
    }
    for (const f of all) {
      const full = path.join(dir, f);
      if (!used.has(f) && Date.now() - fs.statSync(full).mtimeMs > 7 * 864e5) fs.rmSync(full);
    }
  } catch {}
}

// /api and /img over HTTP to the radar, presented as its own local page (as the dev server's proxy does). While
// the radar is restarting this answers at once with a 503 the page already treats as "reconnecting".
function toRadar(req, res, port) {
  const headers = { ...req.headers, host: `localhost:${port}`, "x-forwarded-host": req.headers.host || "" };
  if (req.headers.origin) headers.origin = `http://localhost:${port}`;
  const out = http.request({ host: "127.0.0.1", port, method: req.method, path: req.url, headers }, (r) => { res.writeHead(r.statusCode || 502, r.headers); r.pipe(res); });
  out.on("error", () => {
    if (!res.headersSent) res.writeHead(503, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ error: "Blix is restarting. Back in a few seconds." }));
  });
  res.on("close", () => out.destroy());   // the live stream: stop reading when the page goes
  req.pipe(out);
}

function toAccounts(req, res) {
  const headers = { ...req.headers, origin: `http://localhost:${ACCOUNTS.port}`, "x-forwarded-host": req.headers.host || "" };
  const out = http.request({ ...ACCOUNTS, method: req.method, path: req.url, headers }, (r) => { res.writeHead(r.statusCode || 502, r.headers); r.pipe(res); });
  out.on("error", () => { if (!res.headersSent) res.writeHead(503, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify({ error: "The accounts service is not running on this PC." })); });
  req.pipe(out);
}


// ---------- remote access (trade.blixvip.com) ----------
// The Cloudflare Tunnel points here, so a request whose Host is not this PC came over the internet. The radar
// cannot tell (toRadar presents every request as its own local page), so the key check happens here, exactly as
// the radar's remoteGate does it: ?key=… once, kept in the blix_key cookie for a year; with publicMode on,
// anyone may read (access.js visitorMay) and nothing else; otherwise 401 and the key form.
const LOCAL_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`]);
const SETTINGS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "settings.json");
let remote = { t: 0, key: null, open: false };
function remoteSettings() {
  if (Date.now() - remote.t < 10_000) return remote;
  try { const j = JSON.parse(fs.readFileSync(SETTINGS, "utf8")); remote = { t: Date.now(), key: j.remoteKey || null, open: Boolean(j.publicMode) }; }
  catch { remote = { ...remote, t: Date.now() }; }
  return remote;
}
const cookieOf = (req, name) => (String(req.headers.cookie || "").match(new RegExp(`(?:^|;\s*)${name}=([^;]+)`)) || [])[1] || null;
const safeEq = (a, b) => typeof a === "string" && typeof b === "string" && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const KEY_FORM = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Blix</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1117;color:#e6e8ef;font:15px system-ui,sans-serif}form{display:grid;gap:10px;width:min(320px,90vw)}h1{font-size:18px;margin:0 0 4px}input,button{font:inherit;padding:10px 12px;border-radius:6px;border:1px solid #3a3f4d;background:#171a22;color:inherit}button{background:#e6e8ef;color:#0f1117;font-weight:600;cursor:pointer}small{color:#8b90a0}</style>
<form method="get" action="/"><h1>Blix</h1><small>This is the live terminal on Kai's PC. Enter the access key.</small><input name="key" type="password" placeholder="Access key" autofocus autocomplete="current-password"><button>Open</button></form>`;
// true = answered here (redirect, refusal or the key form); false = go on.
function remoteGate(req, res) {
  if (LOCAL_HOSTS.has(String(req.headers.host || "").toLowerCase())) return false;
  const { key, open } = remoteSettings();
  const url = new URL(req.url, "http://x"), given = url.searchParams.get("key");
  if (key && given && safeEq(given, key)) {
    url.searchParams.delete("key");
    res.writeHead(302, { location: url.pathname + (url.search || ""), "set-cookie": `blix_key=${key}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`, "cache-control": "no-store" });
    res.end(); return true;
  }
  if (key && safeEq(cookieOf(req, "blix_key"), key)) return false;
  if (open) {
    if (visitorMay(req.method, url.pathname)) return false;
    res.writeHead(403, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify({ error: "This is the public view of Blix: it is read-only." })); return true;
  }
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/img/")) {
    res.writeHead(401, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify({ error: "Blix remote: key required." })); return true;
  }
  res.writeHead(401, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" });
  res.end(KEY_FORM); return true;
}

// `radar`: the radar's own http server when it serves the page in-process; null to forward over HTTP (supervisor).
export function startWebApp(radar, radarPort, { retryMs = 30_000 } = {}) {
  const server = http.createServer((req, res) => {
    if (remoteGate(req, res)) return;
    const p = decodeURIComponent(String(req.url).split("?")[0]);
    if (p.startsWith("/api/account/")) return toAccounts(req, res);
    if (p.startsWith("/api/") || p.startsWith("/img/")) {
      if (!radar) return toRadar(req, res, radarPort);
      // Hand the request to the radar as the local page it is.
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
    const body = (inside && read(file)) || read(path.join(DIST, "index.html"));
    if (!body) { res.writeHead(503, { "content-type": "text/plain; charset=utf-8" }); return res.end("The new Blix page has not been built yet. In the web folder run: npm run build"); }
    const isFile = inside && files.has(file);
    res.writeHead(200, {
      "content-type": TYPES[isFile ? path.extname(file) : ".html"] || "application/octet-stream",
      // Built files carry their content in their name and never change; the page itself is always re-checked.
      "cache-control": isFile && p.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
      "x-content-type-options": "nosniff",
    });
    res.end(req.method === "HEAD" ? undefined : body);
  });
  const listen = () => server.listen(PORT, "127.0.0.1");
  server.on("listening", () => { webStats.on = true; webStats.error = null; });
  // Something else on the port (a dev server someone started): keep trying, never take the radar down over it.
  server.on("error", (e) => { webStats.on = false; webStats.error = e.code === "EADDRINUSE" ? `port ${PORT} is in use by another program` : e.message; setTimeout(listen, retryMs).unref?.(); });
  listen();
  try { webStats.built = fs.statSync(path.join(DIST, "index.html")).mtimeMs; } catch {}
  pruneAssets();
  setInterval(pruneAssets, 6 * 3600e3).unref?.();
  return server;
}
