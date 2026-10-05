// The waitlist behind the landing page's "Start trading": a visitor signs in with Google and lands on a
// waiting page. Accounts and activity live in D1 at the edge (site/track.js), so sign-ups and tracking keep
// working when the PC is off; the terminal itself (/app) still needs the owner's key.
//   /start, /login          "Continue with Google" (one page, two headings)
//   /auth/google            off to Google (state kept in a short-lived signed cookie)
//   /auth/google/callback   back from Google: code -> verified email -> account -> /waiting
//   /waiting                the waiting page (needs the blix_wait session cookie)
//   /logout                 clears the session
//   /__admin                Kai's dashboard: sign-ups, visitors, sources, live activity (ADMIN_KEY secret:
//                           open /__admin?key=<ADMIN_KEY> once, a cookie keeps it for 90 days)
//   /__admin.csv            every account as CSV (same login)
// Google client: GOOGLE_CLIENT_ID (var in wrangler.jsonc) + GOOGLE_CLIENT_SECRET (secret), the same OAuth
// client as data/google.json. Its "Authorized redirect URIs" must include https://trade.blixvip.com/auth/google/callback.
import { who, record } from "./track.js";

const COOKIE = "blix_wait", ADMIN = "blix_admin", STATE = "blix_oauth";
const DAYS = 30;
const enc = new TextEncoder();
const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sameStr = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
};
const cookieOf = (req, name) => (String(req.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`)) || [])[1] || null;

async function sign(text, secret) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", key, enc.encode(text)));
}
async function session(req, env) {
  const raw = cookieOf(req, COOKIE);
  if (!raw) return null;
  const [email64, exp, sig] = raw.split(".");
  if (!email64 || !exp || !sig || Number(exp) < Date.now()) return null;
  if (!sameStr(sig, await sign(`${email64}.${exp}`, `wait:${env.REG_KEY || ""}`))) return null;
  try { return decodeURIComponent(escape(atob(email64.replace(/-/g, "+").replace(/_/g, "/")))); } catch { return null; }
}
async function sessionCookie(email, env) {
  const email64 = b64u(enc.encode(email)), exp = Date.now() + DAYS * 86400_000;
  return `${COOKIE}=${email64}.${exp}.${await sign(`${email64}.${exp}`, `wait:${env.REG_KEY || ""}`)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${DAYS * 86400}`;
}
const adminToken = (env) => sign("admin", `admin:${env.ADMIN_KEY || ""}`);
async function isAdmin(req, env) {
  if (!env.ADMIN_KEY) return false;
  return sameStr(cookieOf(req, ADMIN) || "", await adminToken(env));
}

// Cloudflare Web Analytics (injected by Cloudflare at the zone) is the only script allowed; Google profile
// pictures are the only outside images.
const CSP = "default-src 'none'; script-src https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' https://lh3.googleusercontent.com; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const HEAD = (title, extra = "") => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · BLIX</title><meta name="robots" content="noindex"><meta name="theme-color" content="#050608">${extra}
<link rel="icon" href="/_pub/icon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">`;
const send = (html, status = 200, extra = {}) => new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": CSP, "x-content-type-options": "nosniff", "referrer-policy": "same-origin", "x-robots-tag": "noindex", ...extra } });

const page = (title, body, status = 200) => send(`${HEAD(title)}
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{min-height:100vh;display:grid;place-items:center;padding:24px 16px;background:radial-gradient(ellipse 70% 55% at 50% 0%,rgba(176,182,194,.14),transparent 70%),#050608;color:#f4f6fa;font-family:"Inter Tight",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
a{color:#d9dce2}
.card{width:min(440px,100%);background:linear-gradient(180deg,#0d1015,#090b0e);border:1px solid #161a21;border-radius:28px;padding:36px 30px;box-shadow:0 40px 80px -30px rgba(0,0,0,.9)}
.logo{display:flex;align-items:center;gap:4px;margin-bottom:28px;text-decoration:none}.logo img{height:36px}.logo img+img{height:46px;margin-left:-10px}
h1{font-size:34px;letter-spacing:-.04em;line-height:1.05;font-weight:600;margin-bottom:10px}
p{color:#8a92a3;font-size:16px;line-height:1.5}
.g{display:flex;align-items:center;justify-content:center;gap:12px;margin-top:28px;font-weight:600;font-size:17px;background:#f2f3f5;color:#0a0b0d;border-radius:999px;padding:15px 22px;text-decoration:none;box-shadow:0 10px 30px -10px rgba(255,255,255,.35);transition:transform .2s,background .2s}
.g:hover{background:#fff;transform:translateY(-1px)}.g svg{width:20px;height:20px;flex:none}
.fine{margin-top:16px;font-size:13px;color:#5d6575;text-align:center;line-height:1.5}
.me{display:flex;align-items:center;gap:12px;margin:22px 0 4px;padding:12px 14px;border-radius:16px;background:#07080b;border:1px solid #161a21}
.me img{width:40px;height:40px;border-radius:50%;flex:none}.me div{min-width:0}.me b{display:block;font-weight:600;font-size:15px}.me span{display:block;color:#8a92a3;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.err{background:rgba(255,90,106,.1);border:1px solid rgba(255,90,106,.35);color:#ffb3bb;border-radius:12px;padding:10px 12px;font-size:14px;margin-top:18px}
.alt{margin-top:22px;font-size:15px;color:#8a92a3;text-align:center}
.wait{position:relative;margin:28px 0 24px;height:120px;border-radius:22px;background:#07080b;border:1px solid #161a21;display:grid;place-items:center;overflow:hidden}
.wait::before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 50% 50%,rgba(176,182,194,.18),transparent 60%);animation:breathe 3.2s ease-in-out infinite}
.wait img{position:relative;width:64px;height:64px;animation:spin 6s linear infinite}
.ring{position:absolute;width:96px;height:96px;border-radius:50%;border:1px solid rgba(214,218,226,.25);animation:ripple 2.4s ease-out infinite}
.ring+.ring{animation-delay:1.2s}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes breathe{50%{opacity:.35}}
@keyframes ripple{from{transform:scale(.7);opacity:.9}to{transform:scale(1.9);opacity:0}}
@media (prefers-reduced-motion:reduce){.wait img,.wait::before,.ring{animation:none}}
.pill{display:inline-flex;align-items:center;gap:8px;padding:7px 14px;border-radius:999px;border:1px solid rgba(255,255,255,.12);font-size:14px;margin-bottom:18px}
.pill i{width:8px;height:8px;border-radius:50%;background:#22d38a;box-shadow:0 0 0 0 rgba(34,211,138,.7);animation:ping 1.8s infinite}
@keyframes ping{70%{box-shadow:0 0 0 8px rgba(34,211,138,0)}100%{box-shadow:0 0 0 0 rgba(34,211,138,0)}}
ul{list-style:none;display:grid;gap:10px;margin-top:4px}
li{position:relative;padding-left:18px;color:#aeb4bf;font-size:15px;line-height:1.5}li::before{content:"";position:absolute;left:2px;top:9px;width:6px;height:6px;border-radius:50%;background:#59616f}
li b{color:#dfe5ef;font-weight:500;word-break:break-all}
.foot{margin-top:26px;display:flex;justify-content:space-between;font-size:14px;color:#5d6575}.foot a{color:#8a92a3}
</style></head><body><main class="card">
<a class="logo" href="/" aria-label="BLIX home"><img src="/_pub/home/bx-logo.webp" alt=""><img src="/_pub/home/blix-logo.webp" alt="BLIX"></a>
${body}
</main></body></html>`, status);

const GOOGLE_G = `<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;

const signIn = (kind, err = "") => {
  const start = kind !== "login";
  return page(start ? "Start trading" : "Log in", `
<h1>${start ? "Start trading" : "Welcome back"}</h1>
<p>${start ? "Make your BLIX account with Google. We're letting traders in a few at a time, and yours will be ready when it's your turn." : "Log in with Google to check on your account."}</p>
${err ? `<div class="err" role="alert">${esc(err)}</div>` : ""}
<a class="g" href="/auth/google?from=${start ? "start" : "login"}">${GOOGLE_G}Continue with Google</a>
<div class="fine">We only use your name and email. No passwords to remember.</div>
<div class="alt">${start ? `Already have an account? <a href="/login">Log in</a>` : `New here? <a href="/start">Create an account</a>`}</div>`, err ? 400 : 200);
};

const go = (to, ...cookies) => {
  const h = new Headers({ location: to, "cache-control": "no-store" });
  for (const c of cookies) if (c) h.append("set-cookie", c);
  return new Response(null, { status: 303, headers: h });
};
const callbackUrl = (url) => `${url.origin}/auth/google/callback`;
const clearState = `${STATE}=; Path=/auth/google; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
const ERRORS = {
  denied: "You cancelled the Google sign-in. Try again whenever you're ready.",
  busy: "Too many tries. Wait a minute and try again.",
  setup: "Google sign-in isn't switched on yet. Check back soon.",
  expired: "That sign-in took too long or was opened in another browser. Try again.",
};

// The id_token comes straight from Google's token endpoint over TLS, so its signature need not be checked
// again; who it was issued to, by whom, and until when are.
async function googleProfile(code, url, env) {
  let r, j;
  try {
    r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: callbackUrl(url), grant_type: "authorization_code" }) });
    j = await r.json();
  } catch { throw new Error("Google didn't answer. Try again."); }
  if (!r.ok || !j?.id_token) throw new Error(`Google refused the sign-in${j?.error ? ` (${j.error})` : ""}. Try again.`);
  let c;
  try { c = JSON.parse(decodeURIComponent(escape(atob(j.id_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))))); } catch { throw new Error("Google sent an unreadable answer. Try again."); }
  if (c.aud !== env.GOOGLE_CLIENT_ID || !["https://accounts.google.com", "accounts.google.com"].includes(c.iss) || c.exp * 1000 < Date.now()) throw new Error("That Google sign-in wasn't meant for BLIX.");
  if (!c.sub || !c.email || c.email_verified !== true) throw new Error("That Google account has no verified email.");
  return { sub: String(c.sub), email: String(c.email).toLowerCase(), name: c.name ? String(c.name).slice(0, 120) : null,
    picture: /^https:\/\/lh3\.googleusercontent\.com\//.test(c.picture || "") ? String(c.picture).slice(0, 500) : null };
}

// Returns a Response for the waitlist's paths, or null for everything else.
export async function waitlist(req, env, url, { limited, defer }) {
  const p = url.pathname.toLowerCase().replace(/\/+$/, "") || "/";
  if (p === "/__admin" || p === "/__admin.csv") return admin(req, env, url, p);
  if (!["/start", "/login", "/waiting", "/logout", "/auth/google", "/auth/google/callback"].includes(p)) return null;
  if (req.method !== "GET" && req.method !== "HEAD") return new Response(null, { status: 405, headers: { allow: "GET" } });
  const info = await who(req, env, url);

  if (p === "/logout") {
    record(env, defer, info, "logout", { path: p, email: await session(req, env) });
    return go("/", `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
  }

  if (p === "/waiting") {
    const email = await session(req, env);
    if (!email) return go("/login");
    const acct = await env.DB.prepare("SELECT email, name, picture FROM accounts WHERE email = ?").bind(email).first();
    if (!acct) return go("/start", `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
    defer(env.DB.prepare("UPDATE accounts SET last_seen = ? WHERE email = ?").bind(Date.now(), email).run());
    const first = (acct.name || "").split(/\s+/)[0];
    return page("You're on the list", `
<div class="pill"><i></i>Account created</div>
<h1>You're on the list${first ? `, ${esc(first)}` : ""}.</h1>
<p>Thanks for signing up. We're opening BLIX to traders a few at a time so everyone gets a fast, smooth terminal.</p>
<div class="wait" aria-hidden="true"><span class="ring"></span><span class="ring"></span><img src="/_pub/home/bx-logo.webp" alt=""></div>
<ul>
<li>We'll email <b>${esc(email)}</b> the moment your access is ready.</li>
<li>Log back in with Google any time to check on your account.</li>
<li>Follow <a href="https://x.com/blix_vip" rel="noopener" target="_blank">@blix_vip</a> for launch news and early invites.</li>
</ul>
<div class="me">${acct.picture ? `<img src="${esc(acct.picture)}" alt="" referrerpolicy="no-referrer">` : ""}<div><b>${esc(acct.name || email)}</b><span>Signed in with Google · ${esc(email)}</span></div></div>
<div class="foot"><a href="/">Back to BLIX</a><a href="/logout">Log out</a></div>`);
  }

  if (p === "/start" || p === "/login") {
    if (await session(req, env)) return go("/waiting");
    const e = url.searchParams.get("e");
    return signIn(p.slice(1), e ? ERRORS[e] || String(e).slice(0, 160) : "");
  }

  const back = (kind, e) => go(`/${kind === "login" ? "login" : "start"}?e=${encodeURIComponent(e)}`, clearState);
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return back("start", "setup");

  // Off to Google, with a random state tied to this browser by a signed cookie.
  if (p === "/auth/google") {
    const from = url.searchParams.get("from") === "login" ? "login" : "start";
    if (limited) return back(from, "busy");
    const state = `${b64u(crypto.getRandomValues(new Uint8Array(18)))}.${from}`;
    const q = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: callbackUrl(url), response_type: "code", scope: "openid email profile", state, prompt: "select_account" });
    return go(`https://accounts.google.com/o/oauth2/v2/auth?${q}`, `${STATE}=${state}.${await sign(state, `oauth:${env.REG_KEY || ""}`)}; Path=/auth/google; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  }

  // Back from Google.
  const state = url.searchParams.get("state") || "", kept = cookieOf(req, STATE) || "";
  const from = state.endsWith(".login") ? "login" : "start", failKind = from === "login" ? "login_fail" : "signup_fail";
  const cut = kept.lastIndexOf(".");
  if (!state || kept.slice(0, cut) !== state || !sameStr(kept.slice(cut + 1), await sign(state, `oauth:${env.REG_KEY || ""}`))) {
    record(env, defer, info, failKind, { path: p, detail: "state" });
    return back(from, "expired");
  }
  const gerr = url.searchParams.get("error");
  if (gerr) {
    record(env, defer, info, failKind, { path: p, detail: gerr.slice(0, 60) });
    return back(from, gerr === "access_denied" ? "denied" : `Google said: ${gerr.slice(0, 60)}. Try again.`);
  }
  let g;
  try { g = await googleProfile(url.searchParams.get("code") || "", url, env); }
  catch (err) { record(env, defer, info, failKind, { path: p, detail: err.message.slice(0, 80) }); return back(from, err.message); }

  const now = Date.now();
  const had = await env.DB.prepare("SELECT email FROM accounts WHERE google_sub = ? OR email = ?").bind(g.sub, g.email).first();
  if (had) {
    await env.DB.prepare("UPDATE accounts SET logins = logins + 1, last_seen = ?, name = ?, picture = ? WHERE email = ?").bind(now, g.name, g.picture, had.email).run();
    record(env, defer, info, "login", { path: p, email: had.email });
    return go("/waiting", await sessionCookie(had.email, env), clearState);
  }
  // Where they first came from: their earliest visit with a referrer, else this request's.
  const first = await env.DB.prepare("SELECT referrer FROM events WHERE visitor = ? AND referrer IS NOT NULL ORDER BY t LIMIT 1").bind(info.visitor).first();
  await env.DB.prepare("INSERT OR IGNORE INTO accounts (email, google_sub, name, picture, created, last_seen, logins, country, city, referrer, ua, visitor) VALUES (?,?,?,?,?,?,1,?,?,?,?,?)")
    .bind(g.email, g.sub, g.name, g.picture, now, now, info.country, info.city, first?.referrer || info.referrer, info.ua, info.visitor).run();
  record(env, defer, info, "signup", { path: p, email: g.email });
  return go("/waiting", await sessionCookie(g.email, env), clearState);
}

// ---------- Kai's dashboard ----------
const DAY = 86400_000;
const ago = (t) => {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`;
};
const flag = (c) => c && /^[A-Z]{2}$/.test(c) ? String.fromCodePoint(...[...c].map((ch) => 127397 + ch.charCodeAt(0))) + " " + c : "—";

async function admin(req, env, url, p) {
  if (!env.ADMIN_KEY) return new Response("Set the ADMIN_KEY secret first: npx wrangler secret put ADMIN_KEY", { status: 503 });
  const given = url.searchParams.get("key");
  if (given) {
    if (!sameStr(given, env.ADMIN_KEY)) return new Response("Wrong key", { status: 403 });
    return new Response(null, { status: 303, headers: { location: p, "cache-control": "no-store", "set-cookie": `${ADMIN}=${await adminToken(env)}; Path=/__admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${90 * 86400}` } });
  }
  if (!(await isAdmin(req, env))) return new Response("Not found", { status: 404 });

  if (p === "/__admin.csv") {
    const { results } = await env.DB.prepare("SELECT email, name, created, last_seen, logins, country, city, referrer, status FROM accounts ORDER BY created").all();
    const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = ["email,name,signed_up,last_seen,logins,country,city,came_from,status", ...results.map((r) => [r.email, r.name, new Date(r.created).toISOString(), new Date(r.last_seen).toISOString(), r.logins, r.country, r.city, r.referrer, r.status].map(cell).join(","))].join("\n");
    return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="blix-waitlist-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "no-store" } });
  }

  const now = Date.now(), day = now - DAY, week = now - 7 * DAY;
  const HUMAN = "device != 'bot'";
  const q = (sql, ...b) => env.DB.prepare(sql).bind(...b);
  const [tot, today, wk, accts, daily, refs, countries, pages, recent, devices] = (await env.DB.batch([
    q(`SELECT COUNT(*) views, COUNT(DISTINCT visitor) visitors FROM events WHERE kind='view' AND ${HUMAN}`),
    q(`SELECT SUM(kind='view') views, COUNT(DISTINCT CASE WHEN kind='view' THEN visitor END) visitors, SUM(kind='signup') signups FROM events WHERE t > ? AND (kind!='view' OR ${HUMAN})`, day),
    q(`SELECT COUNT(DISTINCT CASE WHEN kind='view' THEN visitor END) visitors, SUM(kind='signup') signups FROM events WHERE t > ? AND (kind!='view' OR ${HUMAN})`, week),
    q(`SELECT a.email, a.name, a.picture, a.created, a.last_seen, a.logins, a.country, a.city, a.referrer, a.status,
         (SELECT COUNT(*) FROM events e WHERE e.visitor = a.visitor AND e.kind='view') visits
       FROM accounts a ORDER BY a.created DESC LIMIT 500`),
    q(`SELECT date(t/1000,'unixepoch') d, SUM(kind='view') views, COUNT(DISTINCT CASE WHEN kind='view' THEN visitor END) visitors, SUM(kind='signup') signups
       FROM events WHERE t > ? AND (kind!='view' OR ${HUMAN}) GROUP BY d ORDER BY d DESC`, now - 14 * DAY),
    q(`SELECT referrer r, COUNT(DISTINCT visitor) n FROM events WHERE referrer IS NOT NULL AND ${HUMAN} GROUP BY r ORDER BY n DESC LIMIT 12`),
    q(`SELECT country c, COUNT(DISTINCT visitor) n FROM events WHERE country IS NOT NULL AND ${HUMAN} GROUP BY c ORDER BY n DESC LIMIT 12`),
    q(`SELECT path p, COUNT(*) n, COUNT(DISTINCT visitor) u FROM events WHERE kind='view' AND ${HUMAN} GROUP BY p ORDER BY n DESC LIMIT 12`),
    q(`SELECT t, kind, path, email, country, city, referrer, device, detail FROM events WHERE ${HUMAN} OR kind!='view' ORDER BY t DESC LIMIT 60`),
    q(`SELECT device d, COUNT(DISTINCT visitor) n FROM events WHERE kind='view' GROUP BY d ORDER BY n DESC`),
  ])).map((r) => r.results);
  const T = tot[0] || {}, D = today[0] || {}, W = wk[0] || {};
  const signups = accts.length;
  const conv = T.visitors ? ((signups / T.visitors) * 100).toFixed(1) + "%" : "—";
  const stat = (label, v, sub = "") => `<div class="stat"><span>${label}</span><b>${v ?? 0}</b>${sub ? `<small>${sub}</small>` : ""}</div>`;
  const maxDay = Math.max(1, ...daily.map((d) => d.visitors || 0));
  const list = (rows, label, val) => rows.length ? `<ol>${rows.map((r) => `<li><span>${label(r)}</span><b>${val(r)}</b></li>`).join("")}</ol>` : `<p class="none">Nothing yet.</p>`;
  const KIND = { view: "viewed", signup: "SIGNED UP", login: "logged in", logout: "logged out", signup_fail: "sign-up failed", login_fail: "log-in failed" };

  return send(`${HEAD("Waitlist dashboard", '<meta http-equiv="refresh" content="30">')}
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#050608;color:#f4f6fa;font:15px/1.4 "Inter Tight",system-ui,sans-serif;-webkit-font-smoothing:antialiased;padding:28px clamp(16px,4vw,48px) 60px}
a{color:#d9dce2}
header{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:24px}
h1{font-size:28px;letter-spacing:-.03em;font-weight:600}
.live{display:inline-flex;align-items:center;gap:8px;color:#8a92a3;font-size:14px}.live i{width:8px;height:8px;border-radius:50%;background:#22d38a}
.btn{display:inline-block;padding:9px 16px;border-radius:999px;background:#f2f3f5;color:#0a0b0d;font-weight:600;text-decoration:none;font-size:14px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:18px}
.stat,.box{background:linear-gradient(180deg,#0d1015,#090b0e);border:1px solid #161a21;border-radius:18px;padding:16px 18px}
.stat span{color:#8a92a3;font-size:13px}.stat b{display:block;font:500 30px/1.1 "JetBrains Mono",monospace;margin-top:6px}.stat small{color:#5d6575;font-size:12px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;margin-bottom:12px}
h2{font-size:14px;font-weight:600;color:#aeb4bf;margin-bottom:12px;letter-spacing:.02em;text-transform:uppercase}
ol{list-style:none;display:grid;gap:6px}ol li{display:flex;justify-content:space-between;gap:12px;font-size:14px}ol li span{color:#cfd6e4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}ol li b{font:500 13px "JetBrains Mono",monospace;color:#8a92a3}
.none{color:#5d6575;font-size:14px}
.bars{display:grid;gap:6px}.bar{display:grid;grid-template-columns:86px 1fr 90px;gap:10px;align-items:center;font-size:13px;color:#8a92a3}
.bar i{display:block;height:10px;border-radius:5px;background:linear-gradient(90deg,#59616f,#d9dce2)}
.bar em{font-style:normal;text-align:right;font-family:"JetBrains Mono",monospace;font-size:12px}
.wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:13.5px;min-width:640px}
th{text-align:left;color:#5d6575;font-weight:500;padding:8px 10px;border-bottom:1px solid #161a21;white-space:nowrap}
td{padding:9px 10px;border-bottom:1px solid #101318;color:#cfd6e4;white-space:nowrap;max-width:260px;overflow:hidden;text-overflow:ellipsis}
td.m{color:#8a92a3}
.k-signup{color:#22d38a;font-weight:600}.k-signup_fail,.k-login_fail{color:#ff8a96}
</style></head><body>
<header><div><h1>BLIX waitlist</h1><div class="live"><i></i>Live · tracked at the edge, works with your PC off · refreshes every 30s</div></div>
<a class="btn" href="/__admin.csv">Download sign-ups (CSV)</a></header>
<div class="stats">
${stat("Sign-ups", signups, `${D.signups || 0} today · ${W.signups || 0} this week`)}
${stat("Visitors today", D.visitors, `${D.views || 0} page views`)}
${stat("Visitors · 7 days", W.visitors)}
${stat("Visitors · all time", T.visitors, `${T.views || 0} page views`)}
${stat("Visitor → sign-up", conv)}
</div>
<div class="grid">
<div class="box"><h2>Last 14 days</h2>${daily.length ? `<div class="bars">${daily.map((d) => `<div class="bar"><span>${d.d}</span><i style="width:${Math.max(2, Math.round((d.visitors / maxDay) * 100))}%"></i><em>${d.visitors} · ${d.signups || 0} new</em></div>`).join("")}</div>` : `<p class="none">Nothing yet.</p>`}</div>
<div class="box"><h2>Where they come from</h2>${list(refs, (r) => esc(r.r), (r) => r.n)}</div>
<div class="box"><h2>Countries</h2>${list(countries, (r) => flag(r.c), (r) => r.n)}</div>
<div class="box"><h2>Pages</h2>${list(pages, (r) => esc(r.p), (r) => `${r.n} · ${r.u} people`)}</div>
<div class="box"><h2>Devices</h2>${list(devices, (r) => esc(r.d), (r) => r.n)}</div>
</div>
<div class="box" style="margin-bottom:12px"><h2>Sign-ups (${signups})</h2><div class="wrap"><table>
<tr><th>Name</th><th>Email</th><th>Signed up</th><th>Last seen</th><th>Logins</th><th>Visits</th><th>Where</th><th>Came from</th></tr>
${accts.map((a) => `<tr><td>${a.picture ? `<img src="${esc(a.picture)}" alt="" referrerpolicy="no-referrer" style="width:20px;height:20px;border-radius:50%;vertical-align:-5px;margin-right:8px">` : ""}${esc(a.name || "")}</td><td>${esc(a.email)}</td><td class="m" title="${new Date(a.created).toISOString()}">${ago(a.created)}</td><td class="m">${ago(a.last_seen)}</td><td class="m">${a.logins}</td><td class="m">${a.visits}</td><td class="m">${flag(a.country)}${a.city ? " · " + esc(a.city) : ""}</td><td class="m">${esc(a.referrer || "direct")}</td></tr>`).join("") || `<tr><td colspan="8" class="m">No sign-ups yet.</td></tr>`}
</table></div></div>
<div class="box"><h2>Live activity</h2><div class="wrap"><table>
<tr><th>When</th><th>What</th><th>Page</th><th>Who</th><th>Where</th><th>From</th><th>Device</th></tr>
${recent.map((e) => `<tr><td class="m">${ago(e.t)}</td><td class="k-${e.kind}">${KIND[e.kind] || esc(e.kind)}${e.detail ? ` <span class="m">(${esc(e.detail)})</span>` : ""}</td><td>${esc(e.path || "")}</td><td>${esc(e.email || "visitor")}</td><td class="m">${flag(e.country)}${e.city ? " · " + esc(e.city) : ""}</td><td class="m">${esc(e.referrer || "")}</td><td class="m">${esc(e.device || "")}</td></tr>`).join("") || `<tr><td colspan="7" class="m">Nothing yet.</td></tr>`}
</table></div></div>
</body></html>`);
}
