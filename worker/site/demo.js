// blixvip.com/demo: a chart replay for practising trades (site/demo.html: paste a CA, pick a point, play forward,
// paper buy/sell), behind one shared password (the DEMO_PASSWORD secret; the repo is public, so it is not
// written here). The password goes in a POST body; a right one sets a cookie for /demo (signed with SESSION_KEY and
// the password, so changing the secret signs everyone out). Wrong tries: 10 a minute per address.
import { overLimit } from "../edge.js";
import APP from "./demo.html";

const COOKIE = "blix_demo", enc = new TextEncoder();
const sameStr = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
};
async function token(env) {
  const key = await crypto.subtle.importKey("raw", enc.encode(env.SESSION_KEY || ""), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`demo:${env.DEMO_PASSWORD}`)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const cookieOf = (req) => (String(req.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`)) || [])[1] || "";

const HEADERS = {
  "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex",
  "content-security-policy": "default-src 'none'; script-src https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com; style-src 'unsafe-inline'; font-src 'self'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};
const page = (body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Practice · BLIX</title><meta name="robots" content="noindex"><meta name="theme-color" content="#050608">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#050608;color:#e8ebf0;font:15px/1.5 system-ui,sans-serif;padding:16px;box-sizing:border-box}
.card{width:100%;max-width:380px;background:#0d1016;border:1px solid #1e232c;border-radius:14px;padding:28px}
h1{margin:0 0 6px;font-size:22px}p{margin:0 0 18px;color:#8b93a1}.err{color:#ff8a96}
input{width:100%;box-sizing:border-box;font:inherit;padding:10px 12px;border-radius:9px;border:1px solid #2a2f3a;background:#050608;color:inherit;margin-bottom:12px}
button{width:100%;font:inherit;font-weight:600;padding:10px;border-radius:9px;border:0;background:#22d38a;color:#05140d;cursor:pointer}</style></head>
<body><div class="card">${body}</div></body></html>`;
const gate = (err = "") => page(`<h1>Demo</h1><p>${err ? `<span class="err">${err}</span>` : "Enter the admin password."}</p>
<form method="post" action="/demo"><input type="password" name="password" autofocus autocomplete="current-password" placeholder="Password" required><button>Open demo</button></form>`);
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
let appCsp = null;
async function app(req) {
  appCsp ||= `default-src 'none'; script-src 'sha256-${b64(await crypto.subtle.digest("SHA-256", enc.encode(APP.match(/<script>([\s\S]*?)<\/script>/)[1])))}' https://unpkg.com https://static.cloudflareinsights.com; connect-src 'self' https://api.geckoterminal.com https://cloudflareinsights.com; style-src 'unsafe-inline'; img-src 'self' data: https:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`;
  return new Response(req.method === "HEAD" ? null : APP, { headers: { ...HEADERS, "content-security-policy": appCsp } });
}

// `radar(path)`: a GET to the Blix server as the demo's own member (index.js), for the 1-second candles Blix builds
// from every trade it saw (GeckoTerminal sells those only on a paid plan).
// /demo/trades: every trade itself (the journal's last 24 h, /api/replay), which the page replays one by one.
const CANDLES = /^\/demo\/(candles|trades)\/([1-9A-HJ-NP-Za-km-z]{32,44})$/;
export async function demo(req, env, url, { radar } = {}) {
  const p = url.pathname.replace(/\/+$/, "");
  if (p !== "/demo" && !p.startsWith("/demo/")) return null;
  if (!env.DEMO_PASSWORD || !env.SESSION_KEY) return new Response("Demo is not set up", { status: 503, headers: { "cache-control": "no-store" } });
  const c = CANDLES.exec(p);
  if (c && req.method === "GET") {
    if (!sameStr(cookieOf(req), await token(env))) return new Response('{"error":"Unlock the demo first."}', { status: 401, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    if (overLimit(`democ:${req.headers.get("cf-connecting-ip") || "unknown"}`, Date.now(), 30)) return new Response('{"error":"Too many loads. Wait a minute."}', { status: 429, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    const tf = [1, 5, 15].includes(Number(url.searchParams.get("tf"))) ? Number(url.searchParams.get("tf")) : 1;
    let r = null;
    try { r = radar ? await radar(c[1] === "trades" ? `/api/replay/${c[2]}` : `/api/candles/${c[2]}?tf=${tf}`) : null; } catch {}
    if (!r || !r.ok) return new Response('{"error":"Blix\'s trade history is not reachable right now."}', { status: 502, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    return new Response(r.body, { headers: { "content-type": "application/json", "cache-control": "private, max-age=10" } });
  }
  if (p !== "/demo") return new Response("Not found", { status: 404 });
  if (req.method === "POST") {
    let form = null;
    try { form = await req.formData(); } catch {}
    if (form && form.get("logout")) return new Response(null, { status: 303, headers: { location: "/demo", "cache-control": "no-store", "set-cookie": `${COOKIE}=; Path=/demo; HttpOnly; Secure; SameSite=Strict; Max-Age=0` } });
    if (overLimit(`demo:${req.headers.get("cf-connecting-ip") || "unknown"}`, Date.now(), 10)) return new Response(gate("Too many tries. Wait a minute."), { status: 429, headers: HEADERS });
    if (!sameStr(String(form && form.get("password") || ""), env.DEMO_PASSWORD)) return new Response(gate("Wrong password."), { status: 403, headers: HEADERS });
    return new Response(null, { status: 303, headers: { location: "/demo", "cache-control": "no-store", "set-cookie": `${COOKIE}=${await token(env)}; Path=/demo; HttpOnly; Secure; SameSite=Strict; Max-Age=${30 * 86400}` } });
  }
  if (req.method !== "GET" && req.method !== "HEAD") return new Response(null, { status: 405, headers: { allow: "GET, HEAD, POST" } });
  const ok = sameStr(cookieOf(req), await token(env));
  return ok ? app(req) : new Response(req.method === "HEAD" ? null : gate(), { headers: HEADERS });
}
