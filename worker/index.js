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
import { ROBOTS, SITEMAP, SITEMAP_URLS, LLMS, INDEXNOW_KEY, PUBLIC_PATHS } from "./site/seo.js";
import LANDING from "./site/landing.html";
import { waitlist, memberOf, memberProfile, session } from "./site/waitlist.js";
import { withMemberProfile } from "./site/member-profile.js";
import { forgetHandle, handlePage } from "./site/handles.js";
import { demo } from "./site/demo.js";
import { who, record, isPageView, seen } from "./site/track.js";
import { drainHeld } from "./site/pending.js";
import { isVisitorRead, keepPlan, visitorRead, overLimit } from "./edge.js";
import { overLimitExact } from "./limiter.js";
import { guardRequest, secureResponse, securityError } from './security.js';
// The Durable Object class must be exported from the Worker's main module (wrangler.jsonc durable_objects).
export { Limiter } from "./limiter.js";

let cached = { origin: null, t: 0 };
// Fomo and X are read through Kai's own signed-in browser (Aside), which only his PC has: those reads go to the
// PC's Blix when it is connected, and to the server (which says what is missing) when it is not.
let cachedPc = { origin: null, t: 0 };
const PC_PATH = /^\/api\/(fomo(\/.*)?|feed\/stream|pump\/feed|x(\/.*)?|coin\/[1-9A-HJ-NP-Za-km-z]{32,44}\/fomo)$/;
// HMAC-SHA256 hex of `text`, the same as server/webapp.js checks.
// The key is imported once per isolate (per secret), not on every request.
const sigKeys = new Map();
async function memberSig(text, secret) {
  if (!secret || secret.length < 32) throw new Error('Member signing unavailable');
  let key = sigKeys.get(secret);
  if (!key) { key = crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); sigKeys.set(secret, key); key.catch(() => sigKeys.delete(secret)); }
  key = await key;
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// The edge key as a header object, or nothing until the secret is set.
const edge = (env) => (env.EDGE_KEY ? { "x-blix-edge": env.EDGE_KEY } : {});
async function vouchFor(member, owner, env) {
  const t = String(Date.now());
  return { "x-blix-member": member, "x-blix-member-t": t, ...(owner ? { "x-blix-owner": "1" } : {}), "x-blix-member-sig": await memberSig(`${member}.${t}${owner ? ".owner" : ""}`, env.MEMBER_KEY || "") };
}

const timingSafeEqual = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
};

// blixvip.com/trade/... (a route on the blixvip.com zone; the rest of blixvip.com is another site): the same
// terminal and sign-up as trade.blixvip.com, under /trade. The prefix comes off on the way in and goes back on every
// redirect, cookie path and page link on the way out. The terminal page itself loads everything by relative path.
const PREFIX = "/trade";
const HSTS = "max-age=15552000; includeSubDomains";
// The public docs (API, MCP and the comparison pages) are found at the root of blixvip.com, one address each:
// these exact paths are routed to this Worker (wrangler.jsonc), and every other address they were at answers 301.
const DOCS = new Set(PUBLIC_PATHS);
const docOf = (p) => { const d = p.toLowerCase().replace(/\/+$/, ""); return DOCS.has(d) ? d : null; };
const atRoot = (p) => Boolean(docOf(p)) || p.startsWith("/_pub/") || p === "/llms.txt" || p === `/${INDEXNOW_KEY}.txt`;
const moved = (to, search = "") => new Response(null, { status: 301, headers: { location: `https://blixvip.com${to}${search}`, "cache-control": "public, max-age=86400" } });
export default {
  // Anything thrown on the way (a KV or D1 read that failed, a bug) used to surface as Cloudflare's "Worker threw
  // exception" HTML page (error 1101) with nothing in it to go on: it is answered as JSON that says what broke.
  async fetch(req, env, ctx) {
    let out;
    try {
      const guarded = await guardRequest(req, env);
      out = guarded.response || await serve(guarded.request, env, ctx);
    }
    catch (e) {
      console.error('edge request failed', { id: crypto.randomUUID(), type: e instanceof Error ? e.name : 'Error' });
      out = securityError(500, 'Service temporarily unavailable.');
    }
    // Every answer: browsers keep to https for blixvip.com and every subdomain for half a year (HSTS). Some
    // answers come back read-only (a cache hit, a redirect), hence the copy.
    if (!out.headers.has("strict-transport-security")) {
      try { out.headers.set("strict-transport-security", HSTS); }
      catch { out = new Response(out.body, out); out.headers.set("strict-transport-security", HSTS); }
    }
    return secureResponse(out);
  },
  // Every 10 minutes (wrangler.jsonc triggers): sign-ups held in KV while D1 was down move into accounts.
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(drainHeld(env).catch(() => 0));
  },
};
async function serve(req, env, ctx) {
  {
    const url = new URL(req.url);
    const get = req.method === "GET" || req.method === "HEAD";
    // www: the bare domain.
    if (url.hostname === "www.blixvip.com") { url.hostname = "blixvip.com"; return Response.redirect(url.toString(), 301); }
    // trade.blixvip.com still answers (signed-in browsers keep working there); its front door is blixvip.com.
    if (url.hostname === "trade.blixvip.com" && get) {
      const d = docOf(url.pathname);
      if (d) return moved(d, url.search);
      if (url.pathname === "/llms.txt" || url.pathname === "/sitemap.xml") return moved(url.pathname);
      if (url.pathname === "/" && !url.searchParams.has("key")) return moved("/", url.search);
    }
    if (url.hostname !== "blixvip.com") return handle(req, env, ctx, "");
    // blixvip.com is the terminal's own site, at the root (since 2026-10-07; before that another site lived here and
    // the terminal sat under /trade). Old /trade links go to the same page at the root. The one exception is the
    // Google sign-in callback: the address registered with Google is /trade/auth/google/callback, so Google still
    // sends people there and they are passed on to the root's handler with Google's code and state (the sign-in
    // itself asks Google to come back to that registered address: handle() callbackPrefix).
    if (url.pathname === PREFIX || url.pathname.startsWith(PREFIX + "/")) {
      const rest = url.pathname.slice(PREFIX.length) || "/";
      if (rest === "/auth/google/callback") return new Response(null, { status: 302, headers: { location: `${url.origin}${rest}${url.search}`, "cache-control": "no-store" } });
      return moved(docOf(rest) || rest, url.search);
    }
    const d = docOf(url.pathname);
    if (d && d !== url.pathname) return moved(d, url.search);
    // The front page: the landing for new visitors and search engines; the terminal for anyone signed in.
    // Only the session cookie (blix_wait) counts: the old access key (blix_key, ?key=) is gone, and a browser still
    // holding it was sent to /app and on to /start, never seeing the landing.
    if (url.pathname === "/" && get && /(?:^|;\s*)blix_wait=/.test(req.headers.get("cookie") || "")) {
      const inner = new URL(url);
      inner.pathname = "/app";
      return handle(new Request(inner, req), env, ctx, "");
    }
    return handle(req, env, ctx, "");
  }
}

// A path (or a blixvip.com address) of the terminal's, moved under /trade.
const under = (v) => {
  if (typeof v !== "string") return v;
  // The docs, their assets and llms.txt live at the root of blixvip.com, not under /trade.
  if (v.startsWith("/") && atRoot(v.split(/[?#]/)[0])) return v;
  if (/^https:\/\/(www\.)?blixvip\.com\//.test(v)) { const u = new URL(v); if (!u.pathname.startsWith(PREFIX + "/")) u.pathname = PREFIX + u.pathname; return u.toString(); }
  return v.startsWith("/") && !v.startsWith("//") && !v.startsWith(PREFIX + "/") ? PREFIX + v : v;
};
class Links {
  constructor(attr) { this.attr = attr; }
  element(el) { const v = el.getAttribute(this.attr); const u = under(v); if (u !== v) el.setAttribute(this.attr, u); }
}
function prefixed(res) {
  const h = new Headers(res.headers);
  const loc = h.get("location");
  if (loc) h.set("location", under(loc));
  const cookies = h.getSetCookie ? h.getSetCookie() : [];
  // The member cookie for the direct line (memberCookie) is for the whole domain and stays at Path=/.
  if (cookies.length) { h.delete("set-cookie"); for (const c of cookies) h.append("set-cookie", c.startsWith(`${DIRECT_COOKIE}=`) ? c : c.replace(/;\s*Path=(\/[^;]*)/i, (m, p) => `; Path=${PREFIX}${p === "/" ? "" : p}`)); }
  const out = new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
  if (!/text\/html/.test(h.get("content-type") || "")) return out;
  return new HTMLRewriter().on("a[href]", new Links("href")).on("link[href]", new Links("href")).on("img[src]", new Links("src"))
    .on("script[src]", new Links("src")).on("form[action]", new Links("action")).transform(out);
}

async function handle(req, env, ctx, prefix) {
  {
    const url = new URL(req.url);
    // One address per page for search engines (and the key cookie is Secure anyway).
    if (url.protocol === "http:") { url.protocol = "https:"; return Response.redirect(url.toString(), 301); }
    // /app/ or anything deeper (/app/x/y) is the terminal at /app: its files and reads are relative, so under a
    // deeper path they resolved to the wrong place and the page came up blank. One redirect, the query kept (the
    // #/page part never reaches here and the browser keeps it).
    if ((req.method === "GET" || req.method === "HEAD") && url.pathname.startsWith("/app/")) return new Response(null, { status: 301, headers: { location: `${url.origin}/app${url.search}`, "cache-control": "public, max-age=86400" } });
    const defer = (p) => ctx.waitUntil(Promise.resolve(p).catch(() => {}));
    // The terminal's built files (assets/<name>-<hash>.js|css, the same for everyone and public in the repo) from
    // the edge copy first, before the sign-in check: that read D1 and KV before every one of a page's ~10 files.
    // A miss goes the usual way below (it is fetched with the edge key and kept, handleMember).
    if (req.method === "GET" && ASSET.test(url.pathname)) {
      const hit = await caches.default.match(edgeKey(url.pathname, req));
      if (hit) return hit;
    }
    // Every page someone opens is recorded in D1 (site/track.js), whether or not the PC is on; a signed-in
    // person's with their email, and their account marked seen now (the live dashboard, /__admin).
    const trackedPage = DOCS.has(url.pathname) || ['/', '/app', '/start', '/login', '/demo'].includes(url.pathname);
    if (trackedPage && isPageView(req, url) && env.ANALYTICS_LIMIT) defer((async () => {
      const ip = req.headers.get('cf-connecting-ip') || 'unknown';
      if (!(await env.ANALYTICS_LIMIT.limit({ key: ip })).success || await overLimitExact(env, 'analytics:global', 30)) return;
      const [info, email] = await Promise.all([who(req, env, url), session(req, env).catch(() => null)]);
      record(env, defer, info, 'view', { path: url.pathname, email });
      seen(env, defer, email);
    })());
    // /demo: behind the DEMO_PASSWORD secret (site/demo.js).
    const shown = await demo(req, env, url, { radar: async (path) => {
      // The server's address (KV, edge-kept a minute) and the demo's own member identity, signed like any member's.
      if (!cached.origin) { try { cached = { origin: await env.REG.get("origin", { cacheTtl: 60 }), t: Date.now() }; } catch {} }
      if (!cached.origin) return null;
      return fetch(new URL(path, cached.origin), { headers: { ...(await vouchFor("demo@blixvip.com", false, env)), ...edge(env), accept: "application/json", "x-forwarded-host": url.host, "x-forwarded-proto": "https" }, signal: AbortSignal.timeout(8000) });
    } });
    if (shown) return shown;
    const page = await site(req, env, url);
    if (page) return page;
    // blixvip.com/@<handle>: a member's page and invite link (site/handles.js). Names the site uses are never handles.
    const card = await handlePage(req, env, url, { defer, viewer: await session(req, env).catch(() => null) });
    if (card) return card;
    // "Start trading": sign in with Google and wait for access (site/waitlist.js). Sign-ins and admin key tries: 20 a
    // minute per address (only those: a member's trades and other POSTs must not use up someone's sign-ins).
    // Counted exactly by a Durable Object per address (limiter.js); the rate limiting binding and the in-memory count
    // stay behind it in case the object cannot be reached.
    const limited = false; // guardRequest already enforced the exact authentication limit.
    // callbackPrefix: Google only comes back to addresses registered with it; on blixvip.com that is the old
    // /trade/auth/google/callback (serve() passes it on to the root).
    const wait = await waitlist(req, env, url, { limited, defer, prefix, callbackPrefix: url.hostname === "blixvip.com" ? PREFIX : prefix });
    if (wait) return wait;
    // A member (anyone signed in with Google, site/waitlist.js) uses the terminal as themselves: every request goes
    // on with their email and a signature Blix checks (x-blix-member*, MEMBER_KEY); Blix decides what they may do.
    // The owner is a member whose email is in OWNER_EMAILS: Blix runs those requests as its own (x-blix-owner,
    // signed into the same signature). There is no access key.
    const member = await memberOf(req, env);
    if (member && url.pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const sensitive = /^\/api\/account\/(withdraw|export)$/.test(url.pathname);
      if (await overLimitExact(env, `write:${sensitive ? 'sensitive' : 'normal'}:${member}`, sensitive ? 5 : 30)) return securityError(429, 'Too many requests. Try again in a minute.');
    }
    const owner = Boolean(member) && String(env.OWNER_EMAILS || "").toLowerCase().split(/[\s,]+/).includes(member);
    // Someone not signed in never sees the terminal: /app sends them to sign up, any other page address that is
    // not one of the site's own is a plain "not found".
    if (isPageView(req, url) && !member) {
      if (/^\/app(\/|$)/.test(url.pathname)) return Response.redirect(`${url.origin}/start`, 302);
      return notFound();
    }
    // A member's page (and their /api/me pings): the member cookie for the direct line goes with it, so the page's
    // reads can go straight to the server's own address (origin.blixvip.com) instead of through here. Set again on
    // every page view, so it never runs out while someone keeps using Blix.
    if (member && (isPageView(req, url) || url.pathname === "/api/me")) {
      if (url.pathname === "/api/me") seen(env, defer, member);   // the terminal's ping: still there
      const res = await handleMember(req, env, ctx, url, member, owner);
      const out = new Response(res.body, res);
      out.headers.append("set-cookie", await memberCookie(member, owner, env));
      return out;
    }
    if (member && req.method === "GET" && url.pathname === "/api/account/me") {
      return withMemberProfile(await handleMember(req, env, ctx, url, member, owner), member, memberProfile(member));
    }
    // A handle just claimed: this data centre forgets that the name was free, so its page opens straight away.
    if (member && req.method === "POST" && url.pathname === "/api/account/handle") {
      const res = await handleMember(req, env, ctx, url, member, owner);
      if (res.ok) defer(res.clone().json().then((j) => j?.handle && forgetHandle(j.handle)));
      return res;
    }
    return handleMember(req, env, ctx, url, member, owner);
  }
}
const ASSET = /^\/assets\/[\w.-]+$/;
// The edge copy of a kept file, one per encoding the server sent it in: Brotli for nearly every browser, the
// rest apart (a browser without Brotli was handed the Brotli copy).
const edgeKey = (pathname, req) => new Request(`https://blix-edge${pathname}${/\bbr\b/.test(req.headers.get("accept-encoding") || "") ? "" : "?enc=other"}`);

// blix_m: who this browser is, signed for 20 minutes with MEMBER_KEY (server/webapp.js cookieMember checks it), for
// the whole domain so origin.blixvip.com gets it too (set again on every page view and api/me through here;
// web/src/lib/role.ts asks every 5 minutes and on coming back to the tab). Short, so a paused account loses the
// direct line within minutes. Cleared by /logout (site/waitlist.js).
const DIRECT_COOKIE = "blix_m";
async function memberCookie(member, owner, env) {
  const t = String(Date.now()), email64 = btoa(String.fromCharCode(...new TextEncoder().encode(member))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const sig = await memberSig(`${member}.${t}.cookie${owner ? ".owner" : ""}`, env.MEMBER_KEY || "");
  return `${DIRECT_COOKIE}=${email64}.${t}.${owner ? "1" : "0"}.${sig}; Domain=.blixvip.com; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=1200`;
}
const clearMemberCookie = `${DIRECT_COOKIE}=; Domain=.blixvip.com; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

async function handleMember(req, env, ctx, url, member, owner) {
  {
    if (url.pathname === "/__register") {
      if (!env.REG_KEY || req.method !== "POST" || !timingSafeEqual(req.headers.get("x-reg-key") || "", env.REG_KEY)) return new Response("no", { status: 403 });
      let body = {};
      try { body = await req.json(); } catch {}
      const origin = String(body.origin || "");
      if (!/^https:\/\/([a-z0-9-]+\.trycloudflare\.com|origin\.blixvip\.com)$/.test(origin)) return new Response("bad origin", { status: 400 });
      // role "pc": Kai's PC, the helper for what only it can read (PC_PATH); anything else: the server.
      if (body.role === "pc") { await env.REG.put("origin:pc", origin); cachedPc = { origin, t: Date.now() }; }
      else { await env.REG.put("origin", origin); cached = { origin, t: Date.now() }; }
      return new Response(JSON.stringify({ ok: true, origin }), { headers: { "content-type": "application/json" } });
    }
    // The server's own read of every member's sign-up record (name, photo, joined, last seen, where from), for the
    // owner's wallet dashboard (server/vaultpeople.js, every few minutes): the edge key only, never a browser.
    if (url.pathname === "/__edge/members") {
      if (req.method !== "GET" || !env.EDGE_KEY || !timingSafeEqual(req.headers.get("x-blix-edge") || "", env.EDGE_KEY)) return new Response("no", { status: 403 });
      try {
        const { results } = await env.DB.prepare("SELECT email, name, picture, created, last_seen, logins, country, city, referrer, ua, status, handle, ref FROM accounts ORDER BY created DESC LIMIT 5000").all();
        return new Response(JSON.stringify({ now: Date.now(), accounts: results }), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
      } catch (e) { return new Response(JSON.stringify({ error: "D1 unavailable" }), { status: 503, headers: { "content-type": "application/json" } }); }
    }
    // The registered origins, re-read every 20 s; a KV read that fails keeps the last known one (and is not retried
    // on every request).
    // Both at once, from KV's edge copy (cacheTtl 60 s): read one after the other they were two waits in a row.
    const reread = (c, key) => Date.now() - c.t > 20_000 ? env.REG.get(key, { cacheTtl: 60 }).then((origin) => ({ origin, t: Date.now() }), () => ({ ...c, t: Date.now() })) : c;
    [cached, cachedPc] = await Promise.all([reread(cached, "origin"), reread(cachedPc, "origin:pc")]);
    // A visitor's read: answered from the edge when it can be, and from the last copy when the PC is off (edge.js).
    const ip = req.headers.get("cf-connecting-ip") || "unknown";
    const isApi = url.pathname.startsWith("/api/");
    const down = () => isApi ? json(503, { error: "Blix is offline: the PC that runs it is not connected right now." }) : offline();
    if (!member && isVisitorRead(req.method)) {
      const plan = keepPlan(url);
      if (plan) {
        let limited = false;
        const res = await visitorRead(plan, {
          cache: caches.default, kv: env.REG, now: Date.now, defer: (p) => ctx.waitUntil(p.catch(() => {})),
          toOrigin: (u) => {
            if (overLimit(ip, Date.now())) { limited = true; throw new Error("limited"); }
            if (!cached.origin) throw new Error("no origin");
            return fetch(new URL(u.pathname + u.search, cached.origin), { headers: { ...edge(env), "x-forwarded-host": url.host, "x-forwarded-proto": "https", accept: req.headers.get("accept") || "*/*" }, redirect: "manual", signal: AbortSignal.timeout(4000) });
          },
        });
        if (res) return res;
        return limited ? json(429, { error: "Too many requests. Slow down a little." }) : down();
      }
      if (overLimit(ip, Date.now())) return json(429, { error: "Too many requests. Slow down a little." });
    } else if (!member) {
      // A write from someone not signed in never reaches the server.
      return json(403, { error: "Sign in to use Blix." });
    }
    // The page's built files never change under the same name (assets/<name>-<hash>.js), and brand images and coin
    // logos barely do: kept at the edge, so a new visitor's 35 script files come from the nearest Cloudflare site
    // instead of one by one through the tunnel. Only answers the server gave an owner or member are kept.
    const KEEP = /^\/assets\/[\w.-]+$/.test(url.pathname) ? 31536000 : /^\/(brand\/[\w./-]+|favicon\.ico|img\/[1-9A-HJ-NP-Za-km-z]{32,44})$/.test(url.pathname) ? 86400 : 0;
    // The headers that vouch for a member to the server (checked in server/webapp.js memberOf): their email, the
    // time, and a signature over both (with ".owner" for the owner).
    const vouch = member ? await vouchFor(member, owner, env) : null;
    if (KEEP && req.method === "GET") {
      const key = edgeKey(url.pathname, req);
      const hit = await caches.default.match(key);
      if (hit) return hit;
      if (cached.origin) {
        let o = null;
        try { o = await fetch(new URL(url.pathname, cached.origin), { headers: { ...(vouch || {}), ...edge(env), "accept-encoding": req.headers.get("accept-encoding") || "", "x-forwarded-host": url.host, "x-forwarded-proto": "https" }, redirect: "manual" }); } catch {}
        if (o && o.status === 200) {
          const h = new Headers(o.headers);
          h.set("cache-control", `public, max-age=${KEEP}${KEEP > 86400 ? ", immutable" : ""}`);
          h.delete("set-cookie");
          const res = new Response(o.body, { status: 200, headers: h });
          ctx.waitUntil(caches.default.put(key, res.clone()));
          return res;
        }
        if (o && o.status !== 401 && o.status !== 530 && o.status !== 502) return o;
      }
    }
    const viaPc = Boolean(cachedPc.origin) && PC_PATH.test(url.pathname);
    if (!cached.origin && !viaPc) return down();
    const target = new URL(url.pathname + url.search, viaPc ? cachedPc.origin : cached.origin);
    const headers = new Headers(req.headers);
    for (const h of ["x-blix-member", "x-blix-member-t", "x-blix-member-sig", "x-blix-owner", "x-blix-as", "x-blix-edge", "x-blix-wallet", "x-blix-ref"]) headers.delete(h);
    if (member && url.pathname.startsWith("/api/account/")) {
      const wallet = (String(req.headers.get("cookie") || "").match(/(?:^|;\s*)blix_wallet=([^;]+)/) || [])[1];
      if (wallet) headers.set("x-blix-wallet", wallet);
      // A trade carries who invited this member (accounts.ref, an email): the wallet service owes them a share of
      // its fee. One read per trade; a D1 outage only means this trade credits no one.
      if (req.method === "POST" && /^\/api\/account\/(buy|sell)$/.test(url.pathname) && env.DB) {
        try {
          const row = await env.DB.prepare("SELECT ref FROM accounts WHERE email = ?").bind(member).first();
          if (row?.ref && row.ref !== member) headers.set("x-blix-ref", row.ref);
        } catch { /* credited on a later trade */ }
      }
    }
    // Every request to the server carries the edge key (EDGE_KEY secret = settings.edgeKey): the server refuses the
    // rest, so origin.blixvip.com cannot be reached around this Worker's sign-in and limits.
    if (env.EDGE_KEY) headers.set("x-blix-edge", env.EDGE_KEY);
    if (member) {
      if (overLimit(`m:${member}`, Date.now(), 600)) return json(429, { error: "Too many requests. Slow down a little." });
      for (const [k, v] of Object.entries(vouch)) headers.set(k, v);
    }
    headers.set("x-forwarded-host", url.host);
    headers.set("x-forwarded-proto", "https");
    // The terminal's page itself (web/dist/index.html, the same for every member) used to come through the tunnel on
    // every view: 300-500 ms before the browser could start anything. A copy is kept at the edge (a day) and sent at
    // once; when it is over 30 s old a fresh one is fetched behind it for the next view, so a rebuild shows on the
    // second view after it (the old build's files stay on the server for a week). The browser revalidates it each
    // time (no-cache, not no-store, so back/forward keeps the page), and the caller adds the member cookie.
    const pageKey = isPageView(req, url) && req.method === "GET" && !viaPc ? edgeKey(`/page${url.pathname}`, req) : null;
    const keepPage = (r) => {
      if (!(r && r.status === 200 && /text\/html/.test(r.headers.get("content-type") || ""))) return r;
      const [a, b] = r.body.tee();
      const kh = new Headers(r.headers); kh.delete("set-cookie"); kh.set("cache-control", "public, max-age=86400"); kh.set("x-blix-kept-at", String(Date.now()));
      ctx.waitUntil(caches.default.put(pageKey, new Response(b, { status: 200, headers: kh })));
      return new Response(a, { status: 200, headers: r.headers });
    };
    const fetchPage = () => fetch(target, { method: req.method, headers, body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body, redirect: "manual" });
    // A hard reload (Ctrl+Shift+R sends Cache-Control/Pragma: no-cache) skips the kept copy and fetches the page
    // fresh (keeping that one): after a deploy, the kept copy could keep serving the old build.
    const hardReload = /no-cache/i.test(`${req.headers.get("cache-control") || ""} ${req.headers.get("pragma") || ""}`);
    if (pageKey && !hardReload) {
      const hit = await caches.default.match(pageKey);
      if (hit) {
        if (Date.now() - Number(hit.headers.get("x-blix-kept-at") || 0) > 30_000) ctx.waitUntil(fetchPage().then(async (r) => {
          if (r.status !== 200 || !/text\/html/.test(r.headers.get("content-type") || "")) return;
          const kh = new Headers(r.headers); kh.delete("set-cookie"); kh.set("cache-control", "public, max-age=86400"); kh.set("x-blix-kept-at", String(Date.now()));
          await caches.default.put(pageKey, new Response(await r.arrayBuffer(), { status: 200, headers: kh }));
        }).catch(() => {}));
        const h = new Headers(hit.headers); h.set("cache-control", "no-cache"); h.set("x-blix-page", "edge"); h.delete("x-blix-kept-at");
        return new Response(hit.body, { status: 200, headers: h });
      }
    }
    let r;
    try { r = await fetchPage(); } catch { r = null; }
    if (pageKey) r = keepPage(r);
    // The PC is off or its tunnel is gone: a read goes to the server instead.
    if (viaPc && cached.origin && (req.method === "GET" || req.method === "HEAD") && (!r || r.status === 530 || r.status === 502 || r.status === 1033)) {
      try { r = await fetch(new URL(url.pathname + url.search, cached.origin), { method: req.method, headers, redirect: "manual" }); } catch { r = null; }
    }
    if (!r) return offline();
    // A dead tunnel answers 530/502 from Cloudflare's side: say so instead of showing an error page.
    if (r.status === 530 || r.status === 502 || r.status === 1033) return offline();
    const out = new Headers(r.headers);
    out.delete("content-security-policy-report-only");
    return new Response(r.body, { status: r.status, statusText: r.statusText, headers: out });
  }
}

// ---------- public docs ----------
const built = new Map(); // path → { body, etag }, rendered once per isolate
let csp = null, landing = null;
const sha = async (algo, text) => new Uint8Array(await crypto.subtle.digest(algo, new TextEncoder().encode(text)));
const b64 = (bytes) => btoa(String.fromCharCode(...bytes));

async function site(req, env, url) {
  if (req.method !== "GET" && req.method !== "HEAD") return null;
  const p = url.pathname, lower = p.toLowerCase().replace(/\/+$/, "");
  // The front page is the landing (site/landing.html, served from here so it is up when the PC is off);
  // its buttons go to sign-up (/start, /login); the terminal itself is /app.
  if (p === "/") {
    if (!landing) {
      // Hash inline scripts (including structured data); the static landing needs no runtime script.
      const hashes = await Promise.all([...LANDING.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
        .map(async ([, script]) => `'sha256-${b64(await sha("SHA-256", script.replace(/\r\n?/g, "\n")))}'`));
      landing = {
        etag: `"${b64(await sha("SHA-1", LANDING)).slice(0, 27)}"`,
        csp: `default-src 'none'; script-src ${hashes.join(" ")} https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com; style-src 'unsafe-inline'; font-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      };
    }
    // no-cache, not max-age: the same address shows the terminal once someone has signed in (serve()), and a
    // browser that kept the landing for ten minutes showed it again right after sign-in. The ETag keeps reloads cheap.
    const headers = {
      "content-type": "text/html; charset=utf-8", "cache-control": "no-cache", etag: landing.etag,
      // Sent with the first bytes (and as a 103 Early Hint where the zone has those on): the font and the big picture.
      link: "</_pub/fonts/inter-tight.woff2>; rel=preload; as=font; type=font/woff2; crossorigin",
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
    csp ||= `default-src 'none'; script-src 'sha256-${b64(await sha("SHA-256", SCRIPT.replace(/\r\n?/g, "\n")))}' https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com; style-src 'unsafe-inline'; font-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
    const { body, etag } = built.get(p);
    const headers = {
      "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=600, stale-while-revalidate=86400", etag,
      link: "</_pub/fonts/space-grotesk-600.woff2>; rel=preload; as=font; type=font/woff2; crossorigin",
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
  // The tab icon browsers ask for by themselves on any page without an icon link (robots.txt, llms.txt, error
  // pages): public, from here. It used to fall through to the member check and answer 401 to anyone signed out.
  if (p === "/favicon.ico" && env.ASSETS) {
    const r = await env.ASSETS.fetch(new Request(new URL("/_pub/favicon.ico", url), req));
    if (r.ok) return new Response(req.method === "HEAD" ? null : r.body, { headers: { "content-type": "image/x-icon", "cache-control": "public, max-age=604800, stale-while-revalidate=604800" } });
  }
  if (p.startsWith("/_pub/") && env.ASSETS) {
    const r = await env.ASSETS.fetch(req);
    if (r.status === 404) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
    const headers = new Headers(r.headers);
    // Fonts never change under their name; pictures and icons are kept a week and refreshed in the background.
    headers.set("cache-control", p.startsWith("/_pub/fonts/") ? "public, max-age=31536000, immutable" : "public, max-age=604800, stale-while-revalidate=604800");
    return new Response(r.body, { status: r.status, headers });
  }
  return null;
}

const notFound = () => new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page not found · BLIX</title><meta name="robots" content="noindex">
<link rel="icon" href="/_pub/icon.svg?v=eye" type="image/svg+xml">
<style>*{box-sizing:border-box;margin:0}body{min-height:100vh;display:grid;place-items:center;padding:24px 16px;background:radial-gradient(ellipse 70% 55% at 50% 0%,rgba(176,182,194,.14),transparent 70%),#050608;color:#f4f6fa;font:16px/1.5 system-ui,sans-serif;text-align:center}
img{width:72px;margin-bottom:18px}h1{font-size:30px;letter-spacing:-.03em;margin-bottom:8px}p{color:#8a92a3;margin-bottom:26px}
a{display:inline-block;padding:13px 24px;border-radius:999px;background:#f2f3f5;color:#0a0b0d;font-weight:600;text-decoration:none}</style>
<div><img src="/_pub/home/bx-logo.webp" alt=""><h1>Page not found</h1><p>That page doesn't exist. Head back to BLIX.</p><a href="/">Back to BLIX</a></div>`,
  { status: 404, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; script-src https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com", "x-robots-tag": "noindex" } });
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const offline = () => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="20"><title>Blix</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1117;color:#e6e8ef;font:15px system-ui,sans-serif;text-align:center}h1{font-size:18px;margin:0 0 6px}p{color:#8b90a0;margin:0}a{color:#7aa2ff}</style>
<div><h1>Blix is offline</h1><p>The terminal runs on Kai's PC and it is not connected right now. This page retries every 20 seconds.</p><p style="margin-top:14px"><a href="/api">Blix API docs</a> · <a href="/mcp">MCP server</a></p></div>`,
  { status: 503, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "retry-after": "20", "x-robots-tag": "noindex" } });
