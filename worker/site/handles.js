// Handles: every member can claim one, and blixvip.com/@<handle> becomes their page and invite link.
//   GET  /@<handle>                public card (picture, name, how many joined through them) with "Start trading";
//                                  a signed-out visitor gets the blix_ref cookie, so the sign-up that follows is
//                                  credited to them (waitlist.js: inviteFrom). /<handle> (the first links), any
//                                  other casing and a name its owner has since moved off all 301 to /@<handle>.
// Handles and invites live on the server (server/handles.js, asked with the edge key), not in D1: D1's free daily
// writes are shared with other projects and ran out (2026-10-10), failing every claim. /api/account/handle goes
// to the server like any other account request. D1 is only read here, for the card's name and picture.
import { who, record } from "./track.js";

export const REF_COOKIE = "blix_ref";
const HANDLE = /^[a-z0-9_]{3,20}$/;
const PATH = /^\/@?([A-Za-z0-9_]{3,20})\/?$/;
// Every first path part the site or the terminal uses, plus names nobody should be able to pass themselves off as.
const RESERVED = new Set(`app api mcp demo start login logout waiting auth trade assets brand img fonts admin __admin
  robots sitemap llms favicon register blix blixvip bx official support help team staff mod mods moderator owner
  root system security billing pay payment payments wallet wallets vault account accounts settings profile profiles
  me you user users u ref refer invite join signup signin home index about terms privacy legal contact docs status
  pulse feed coins coin token tokens portfolio paper trade trades trading launch replay www mail email null
  undefined true false new edit delete search explore edge _pub`.split(/\s+/).filter(Boolean));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const okPicture = (p) => typeof p === "string" && p.length <= 500 && /^https:\/\/lh3\.googleusercontent\.com\//.test(p) ? p : null;

export function validHandle(h) {
  const v = String(h || "").trim().replace(/^@/, "").toLowerCase();
  if (!HANDLE.test(v)) return { error: "Handles are 3 to 20 letters, numbers or underscores." };
  if (RESERVED.has(v) || /^_|_$/.test(v)) return { error: "That handle isn't available." };
  return { handle: v };
}

// The server's answer for a handle, kept in the edge cache per data centre (found 1 minute, not found 15 seconds,
// so a handle just claimed opens almost at once; a claim through this Worker also clears it: forgetHandle).
const edgeKey = (env) => (env.EDGE_KEY ? { "x-blix-edge": env.EDGE_KEY } : {});
let originAt = { origin: null, t: 0 };
async function fromServer(env, path, init = {}) {
  if (!originAt.origin || Date.now() - originAt.t > 60_000) originAt = { origin: await env.REG.get("origin", { cacheTtl: 60 }), t: Date.now() };
  if (!originAt.origin) throw new Error("no origin");
  const r = await fetch(new URL(path, originAt.origin), { ...init, headers: { ...edgeKey(env), accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}) }, signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
const cacheKey = (h) => new Request(`https://blix-handle/v3/${h}`);
export const forgetHandle = (h) => { const v = validHandle(h).handle; return v ? caches.default.delete(cacheKey(v)).catch(() => false) : Promise.resolve(false); };
async function lookup(env, h) {
  const hit = await caches.default.match(cacheKey(h)).catch(() => null);
  if (hit) return hit.json();
  const found = await fromServer(env, `/api/edge/handle/${h}`);
  let out = null;
  if (found?.email) {
    const row = await env.DB.prepare("SELECT name, picture FROM accounts WHERE email = ?").bind(found.email).first().catch(() => null);
    // email stays here (never on the page): it tells the owner their own page apart.
    out = { handle: found.handle, email: found.email, name: row?.name || null, picture: okPicture(row?.picture), created: found.since, joined: found.joined || 0 };
  }
  await caches.default.put(cacheKey(h), new Response(JSON.stringify(out), { headers: { "cache-control": `public, max-age=${out ? 60 : 15}` } })).catch(() => {});
  return out;
}

// A new sign-up came through <handle>'s link (the blix_ref cookie): the server credits the handle's owner. Returns
// the inviter's email (for D1's accounts.ref too), or null.
export async function inviteFrom(env, handle, email) {
  const v = validHandle(handle).handle;
  if (!v || !email) return null;
  try { const r = await fromServer(env, "/api/edge/invite", { method: "POST", body: JSON.stringify({ email, handle: v }) }); return r?.ref || null; }
  catch { return null; }
}

// blixvip.com/@<handle>: the card, or null to let the request go on as before (an unknown name is a plain 404 later).
// viewer: the signed-in visitor's email, or null.
export async function handlePage(req, env, url, { defer, viewer }) {
  const signedIn = Boolean(viewer);
  if (req.method !== "GET" && req.method !== "HEAD") return null;
  const m = PATH.exec(url.pathname);
  if (!m || RESERVED.has(m[1].toLowerCase())) return null;
  const h = m[1].toLowerCase();
  let p;
  // The server out of reach (twice): the page still opens and still sets the invite cookie (the server checks the
  // handle when the sign-up is credited), only without the person's name. A real invite link never 404s for it.
  try { p = await lookup(env, h); } catch { try { p = await lookup(env, h); } catch { p = { handle: h, name: null, picture: null, created: null, joined: 0 }; } }
  if (!p) return null;
  // One address per page: /@<current handle>. Not kept long by browsers (a moved name can be claimed again later).
  if (url.pathname !== `/@${p.handle}`) return new Response(null, { status: 301, headers: { location: `/@${p.handle}${url.search}`, "cache-control": "public, max-age=300" } });
  const own = signedIn && p.email && p.email.toLowerCase() === String(viewer).toLowerCase();
  defer((async () => record(env, defer, await who(req, env, url), "view", { path: `/@${p.handle}`, detail: own ? "own" : signedIn ? null : "invite" }))());
  const name = p.name || `@${p.handle}`, since = p.created ? new Date(p.created).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }) : null;
  const title = `${name} invited you to BLIX`, desc = `Join ${name} on BLIX and save 20% on every trading fee. The fastest way to trade Solana memecoins.`;
  const cta = own ? `<a class="go" href="/app#/account">Open Invite &amp; earn</a>` : signedIn ? `<a class="go" href="/app">Open the terminal</a>` : `<a class="go" href="/start">Start trading</a><a class="more" href="/">What is BLIX?</a>`;
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><meta name="robots" content="noindex"><meta name="theme-color" content="#050608">
<meta property="og:type" content="profile"><meta property="og:site_name" content="BLIX"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="https://blixvip.com/@${esc(p.handle)}"><meta property="og:image" content="https://blixvip.com/_pub/home/og.jpg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="https://blixvip.com/_pub/home/og.jpg">
<link rel="icon" href="/_pub/icon.svg?v=eye2" type="image/svg+xml"><link rel="preload" href="/_pub/fonts/inter-tight.woff2" as="font" type="font/woff2" crossorigin>
<style>@font-face{font-family:'Inter Tight';font-style:normal;font-weight:400 700;font-display:swap;src:url(/_pub/fonts/inter-tight.woff2) format('woff2')}
*{box-sizing:border-box;margin:0}body{min-height:100vh;display:grid;place-items:center;padding:24px 16px;background:radial-gradient(ellipse 70% 55% at 50% 0%,rgba(176,182,194,.14),transparent 70%),#050608;color:#f4f6fa;font:16px/1.5 'Inter Tight',system-ui,sans-serif;text-align:center}
.card{width:100%;max-width:380px;display:flex;flex-direction:column;align-items:center;animation:rise .5s ease-out both}
.pic{width:96px;height:96px;border-radius:50%;object-fit:cover;border:1px solid rgba(255,255,255,.14);background:#14161b;margin-bottom:18px}
.ini{display:grid;place-items:center;font-size:38px;font-weight:600;color:#c9ced8}
h1{font-size:30px;letter-spacing:-.03em;line-height:1.15;overflow-wrap:anywhere}.at{color:#8a92a3;margin-top:4px}
.meta{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin:18px 0 28px}.meta span{padding:5px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.1);color:#b4bac6;font-size:14px}
.kick{color:#8a92a3;font-size:14px;margin-bottom:6px}
.offer{width:100%;display:flex;align-items:center;gap:14px;text-align:left;padding:14px 16px;margin:-8px 0 20px;border-radius:16px;border:1px solid rgba(52,211,153,.28);background:linear-gradient(180deg,rgba(52,211,153,.12),rgba(52,211,153,.04))}
.offer b{flex-shrink:0;font-size:22px;letter-spacing:-.02em;color:#4ade9a}.offer.mine b{font-size:inherit;letter-spacing:0;color:#f4f6fa;font-weight:600}.offer span{color:#c9ced8;font-size:14px;line-height:1.4}
.go{display:block;width:100%;padding:14px 24px;border-radius:999px;background:#f2f3f5;color:#0a0b0d;font-weight:600;text-decoration:none}.go:hover{background:#fff}
.more{margin-top:14px;color:#8a92a3;font-size:15px}.more:hover{color:#f4f6fa}
.brand{position:fixed;top:18px;left:50%;transform:translateX(-50%)}.brand img{height:26px}
@keyframes rise{from{opacity:0;transform:translateY(10px)}}@media (prefers-reduced-motion:reduce){.card{animation:none}}</style></head>
<body><a class="brand" href="/" aria-label="BLIX"><img src="/_pub/home/bx-logo.webp" alt="BLIX"></a><main class="card">
${p.picture ? `<img class="pic" src="${esc(p.picture)}" alt="" referrerpolicy="no-referrer">` : `<div class="pic ini" aria-hidden="true">${esc(p.handle[0].toUpperCase())}</div>`}
<p class="kick">${own ? "This is your invite page" : "You're invited by"}</p><h1>${esc(name)}</h1>${p.name ? `<p class="at">@${esc(p.handle)}</p>` : ""}
<div class="meta">${since ? `<span>Trading on BLIX since ${esc(since)}</span>` : ""}${p.joined ? `<span>${p.joined} ${p.joined === 1 ? "trader" : "traders"} joined through them</span>` : ""}</div>
${own ? `<div class="offer mine"><span>Share <b>blixvip.com/@${esc(p.handle)}</b>. Everyone who signs up through it saves 20% on fees, and you earn a share of every fee they pay.</span></div>` : signedIn ? "" : `<div class="offer"><b>20% off</b><span>trading fees on every trade, for good, when you sign up through this link</span></div>`}
${cta}</main></body></html>`;
  const headers = {
    "content-type": "text/html; charset=utf-8", "cache-control": "private, no-cache", "x-robots-tag": "noindex",
    "content-security-policy": "default-src 'none'; script-src https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com; style-src 'unsafe-inline'; font-src 'self'; img-src 'self' https://lh3.googleusercontent.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  };
  // Credit: the latest link a signed-out visitor opened, for 30 days (the current handle: the server also knows old
  // ones). A member's own visits change nothing.
  if (!signedIn) headers["set-cookie"] = `${REF_COOKIE}=${p.handle}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 86400}`;
  return new Response(req.method === "HEAD" ? null : body, { headers });
}
