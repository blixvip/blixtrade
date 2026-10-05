// trade.blixvip.com → the BLIX landing page at /, the live Blix terminal on Kai's PC at /app (and every
// other path it uses), plus the public docs pages.
// The docs (/api, /mcp and the comparison pages, with robots.txt, sitemap.xml, llms.txt and /_pub/
// assets) are served here at the edge, so they stay up and fast when the PC is off; see site/.
// Blix registers its current quick-tunnel address (POST /__register with the REG_KEY secret); every other
// request from the owner (it carries the access key) is forwarded to that address as-is, streaming. A
// visitor's read is answered from the edge when possible and from the last copy when the PC is off
// (edge.js). Who may do what is still decided by Blix itself (server/access.js); this Worker only keeps
// copies of what Blix was willing to show a visitor, and turns keyless writes away early.
import { PAGES, render } from "./site/pages.js";
import { SCRIPT } from "./site/html.js";
import { ROBOTS, SITEMAP, LLMS, INDEXNOW_KEY } from "./site/seo.js";
import LANDING from "./site/landing.html";
import { isVisitorRead, keepPlan, visitorRead, overLimit } from "./edge.js";

let cached = { origin: null, t: 0 };

const timingSafeEqual = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
};

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    // One address per page for search engines (and the key cookie is Secure anyway).
    if (url.protocol === "http:") { url.protocol = "https:"; return Response.redirect(url.toString(), 301); }
    const page = await site(req, env, url);
    if (page) return page;
    if (url.pathname === "/__register") {
      if (req.method !== "POST" || !timingSafeEqual(req.headers.get("x-reg-key") || "", env.REG_KEY || "")) return new Response("no", { status: 403 });
      let body = {};
      try { body = await req.json(); } catch {}
      const origin = String(body.origin || "");
      if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(origin)) return new Response("bad origin", { status: 400 });
      await env.REG.put("origin", origin);
      cached = { origin, t: Date.now() };
      return new Response(JSON.stringify({ ok: true, origin }), { headers: { "content-type": "application/json" } });
    }
    if (Date.now() - cached.t > 20_000) cached = { origin: await env.REG.get("origin"), t: Date.now() };
    // A visitor's read: answered from the edge when it can be, and from the last copy when the PC is off (edge.js).
    const cookie = req.headers.get("cookie") || "", ip = req.headers.get("cf-connecting-ip") || "unknown";
    const isApi = url.pathname.startsWith("/api/");
    const down = () => isApi ? json(503, { error: "Blix is offline: the PC that runs it is not connected right now." }) : offline();
    if (isVisitorRead(req.method, url, cookie)) {
      const plan = keepPlan(url);
      if (plan) {
        let limited = false;
        const res = await visitorRead(plan, {
          cache: caches.default, kv: env.REG, now: Date.now, defer: (p) => ctx.waitUntil(p.catch(() => {})),
          toOrigin: (u) => {
            if (overLimit(ip, Date.now())) { limited = true; throw new Error("limited"); }
            if (!cached.origin) throw new Error("no origin");
            return fetch(new URL(u.pathname + u.search, cached.origin), { headers: { "x-forwarded-host": url.host, "x-forwarded-proto": "https", accept: req.headers.get("accept") || "*/*" }, redirect: "manual", signal: AbortSignal.timeout(4000) });
          },
        });
        if (res) return res;
        return limited ? json(429, { error: "Too many requests. Slow down a little." }) : down();
      }
      if (overLimit(ip, Date.now())) return json(429, { error: "Too many requests. Slow down a little." });
    } else if (req.method !== "GET" && req.method !== "HEAD" && !/(?:^|;\s*)blix_key=/.test(cookie)) {
      // A write without the owner's key never reaches the PC.
      return json(403, { error: "This is the public view of Blix: it is read-only." });
    }
    if (!cached.origin) return down();
    const target = new URL(url.pathname + url.search, cached.origin);
    const headers = new Headers(req.headers);
    headers.set("x-forwarded-host", url.host);
    headers.set("x-forwarded-proto", "https");
    let r;
    try {
      r = await fetch(target, { method: req.method, headers, body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body, redirect: "manual" });
    } catch { return offline(); }
    // A dead tunnel answers 530/502 from Cloudflare's side: say so instead of showing an error page.
    if (r.status === 530 || r.status === 502 || r.status === 1033) return offline();
    const out = new Headers(r.headers);
    out.delete("content-security-policy-report-only");
    return new Response(r.body, { status: r.status, statusText: r.statusText, headers: out });
  },
};

// ---------- public docs ----------
const built = new Map(); // path → { body, etag }, rendered once per isolate
let csp = null, landing = null;
const sha = async (algo, text) => new Uint8Array(await crypto.subtle.digest(algo, new TextEncoder().encode(text)));
const b64 = (bytes) => btoa(String.fromCharCode(...bytes));

async function site(req, env, url) {
  if (req.method !== "GET" && req.method !== "HEAD") return null;
  const p = url.pathname, lower = p.toLowerCase().replace(/\/+$/, "");
  // The front page is the landing (site/landing.html, served from here so it is up when the PC is off);
  // its buttons open the terminal at /app. The key form posts ?key= to /, so that goes on to the terminal.
  if (p === "/") {
    if (url.searchParams.has("key")) return Response.redirect(`${url.origin}/app${url.search}`, 302);
    if (!landing) {
      const script = LANDING.match(/<script>([\s\S]*?)<\/script>/)[1];
      landing = {
        etag: `"${b64(await sha("SHA-1", LANDING)).slice(0, 27)}"`,
        csp: `default-src 'none'; script-src 'sha256-${b64(await sha("SHA-256", script))}'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      };
    }
    const headers = {
      "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=600", etag: landing.etag,
      "content-security-policy": landing.csp, "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin",
    };
    if (req.headers.get("if-none-match") === landing.etag) return new Response(null, { status: 304, headers });
    return new Response(req.method === "HEAD" ? null : LANDING, { headers });
  }
  if (PAGES[lower] && p !== lower) return Response.redirect(`${url.origin}${lower}${url.search}`, 301);
  if (PAGES[p]) {
    if (!built.has(p)) {
      const body = render(p);
      built.set(p, { body, etag: `"${b64(await sha("SHA-1", body)).slice(0, 27)}"` });
    }
    csp ||= `default-src 'none'; script-src 'sha256-${b64(await sha("SHA-256", SCRIPT))}'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
    const { body, etag } = built.get(p);
    const headers = {
      "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=600", etag,
      "content-security-policy": csp, "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin",
    };
    if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return new Response(req.method === "HEAD" ? null : body, { headers });
  }
  const text = (body, type) => new Response(req.method === "HEAD" ? null : body, { headers: { "content-type": `${type}; charset=utf-8`, "cache-control": "public, max-age=3600", "x-content-type-options": "nosniff" } });
  if (p === "/robots.txt") return text(ROBOTS, "text/plain");
  if (p === "/sitemap.xml") return text(SITEMAP, "application/xml");
  if (p === "/llms.txt") return text(LLMS, "text/plain");
  if (p === `/${INDEXNOW_KEY}.txt`) return text(INDEXNOW_KEY, "text/plain");
  if (p.startsWith("/_pub/") && env.ASSETS) {
    const r = await env.ASSETS.fetch(req);
    if (r.status === 404) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
    const headers = new Headers(r.headers);
    headers.set("cache-control", "public, max-age=86400");
    return new Response(r.body, { status: r.status, headers });
  }
  return null;
}

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const offline = () => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="20"><title>Blix</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1117;color:#e6e8ef;font:15px system-ui,sans-serif;text-align:center}h1{font-size:18px;margin:0 0 6px}p{color:#8b90a0;margin:0}a{color:#7aa2ff}</style>
<div><h1>Blix is offline</h1><p>The terminal runs on Kai's PC and it is not connected right now. This page retries every 20 seconds.</p><p style="margin-top:14px"><a href="/api">Blix API docs</a> · <a href="/mcp">MCP server</a></p></div>`,
  { status: 503, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "retry-after": "20", "x-robots-tag": "noindex" } });
