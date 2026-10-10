// Sign-up behind the landing page's "Start trading": a visitor signs in with Google, gets an account and is a
// member at once (their own paper desk in the terminal; the Worker vouches for them on every request, index.js).
// Accounts and activity live in D1 at the edge (site/track.js). There is no access key any more: the owner is
// simply a member whose email is in OWNER_EMAILS (wrangler.jsonc), and the terminal runs their requests as its own.
//   /start, /login          "Continue with Google" (one page, two headings)
//   /auth/google            off to Google (state kept in a short-lived signed cookie)
//   /auth/google/callback   back from Google: code -> verified email -> account (status member) -> /app
//   /waiting                an account Kai paused (status blocked) lands here; anyone else goes on to /app
//   /logout                 clears the session
//   /__admin                Kai's dashboard (site/admin.js): only an OWNER_EMAILS Google session opens it; anyone
//                           else, signed in or not, gets a plain "not found"
//   /__admin.csv            every account as CSV (same login)
//   /__admin/live           what changed since ?since=<ms> (events, accounts), polled by the dashboard every 3 s
// Google client: GOOGLE_CLIENT_ID (var in wrangler.jsonc) + GOOGLE_CLIENT_SECRET (secret), the same OAuth
// client as data/google.json. Its "Authorized redirect URIs" must include https://trade.blixvip.com/auth/google/callback.
import { who, record } from "./track.js";
import { holdSignup, heldSignups, recover } from "./pending.js";
import { dashboard } from "./admin.js";
import { REF_COOKIE, inviteFrom } from "./handles.js";

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
export async function session(req, env) {
  const raw = cookieOf(req, COOKIE);
  if (!raw || raw.length > 2048 || !env.SESSION_KEY) return null;
  const [email64, exp, sig, extra] = raw.split(".");
  if (extra !== undefined || !email64 || !exp || !sig || !Number.isSafeInteger(Number(exp)) || Number(exp) <= Date.now() || Number(exp) > Date.now() + DAYS * 86400_000) return null;
  if (!sameStr(sig, await sign(`${email64}.${exp}`, `wait:${sessionKey(env)}`))) return null;
  try { return decodeURIComponent(escape(atob(email64.replace(/-/g, "+").replace(/_/g, "/")))); } catch { return null; }
}
// The key sessions and the sign-in state are signed with: its own secret (SESSION_KEY), so the key that registers
// the tunnel origin (REG_KEY, also on the server as settings.tunnelKey) cannot mint a session. REG_KEY stands in
// until SESSION_KEY is set.
export const sessionKey = (env) => {
  if (!env.SESSION_KEY) throw new Error('Session signing unavailable');
  return env.SESSION_KEY;
};
// A signed-in account that is not paused (status 'member'; /__admin can set 'blocked'): the email, or null. Kept
// five minutes per isolate (a minute made nearly every page view at low traffic wait on D1 first); a pause from
// /__admin takes effect within that.
const members = new Map();   // email -> { ok, t }
const MEMBER_MS = 5 * 60_000;
export async function memberOf(req, env) {
  const email = await session(req, env);
  if (!email) return null;
  const sensitive = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  const c = members.get(email);
  if (!sensitive && c && Date.now() - c.t < MEMBER_MS) return c.ok ? email : null;
  // D1 out of reach (the free tier's daily row-read limit ran out on 2026-10-07 and every request died with it):
  // a member stays what they were last known as; someone with a valid signed-in cookie but no known status is let
  // in for 10 minutes at a time, since the cookie itself was signed here at Google sign-in. A paused account is
  // kept out even then: /__admin writes every block to KV too (blocked:<email>), which does not run out.
  let row, ok;
  try {
    row = await env.DB.prepare("SELECT status, name, picture FROM accounts WHERE email = ?").bind(email).first();
    // Signed in (the cookie is only ever signed here, after Google said who this is) but no account: their sign-in
    // happened while D1 was down. Written now (site/pending.js), so they are on the dashboard from this visit on.
    // If D1 refuses the write (its free daily writes ran out, 2026-10-10: new sign-ups were turned away all day),
    // this is an outage like any other: on to the catch below, which lets the signed-in cookie in.
    if (!row) {
      if (!(await recover(env, email, req.cf))) throw new Error("account row could not be written");
      row = await env.DB.prepare("SELECT status, name, picture FROM accounts WHERE email = ?").bind(email).first();
    }
    ok = row?.status === "member";
  }
  catch (e) {
    // Writes too: refusing every one while D1 is down stopped all paper trading for the outage (D1's free reads ran
    // out on 2026-10-09 until midnight UTC). A paused account is still kept out by its KV block below.
    let blocked = false;
    try { blocked = Boolean(await env.REG.get(`blocked:${email}`)); } catch { return null; }
    if (blocked) { members.set(email, { ok: false, t: Date.now() }); return null; }
    if (c) { members.set(email, { ...c, t: Date.now() - MEMBER_MS + 10_000 }); return c.ok ? email : null; }
    members.set(email, { ok: !blocked, t: Date.now() + 10 * 60_000 - MEMBER_MS }); if (members.size > 5000) members.clear();
    return blocked ? null : email;
  }
  if (members.size > 5000) members.clear();
  members.set(email, { ok, t: Date.now(), profile: ok ? { name: row.name, picture: row.picture } : null });
  return ok ? email : null;
}
// Called only after memberOf; shares its lookup and five-minute lifetime.
export function memberProfile(email) { const entry = members.get(email); return entry?.ok ? entry.profile || null : null; }
async function sessionCookie(email, env) {
  const email64 = b64u(enc.encode(email)), exp = Date.now() + DAYS * 86400_000;
  return `${COOKIE}=${email64}.${exp}.${await sign(`${email64}.${exp}`, `wait:${sessionKey(env)}`)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${DAYS * 86400}`;
}
// Never keeps anyone out: with MEMBER_KEY missing or short there is simply no wallet cookie (go() skips a null).
async function walletCookie(profile, env) {
  try { return await walletCookieOrThrow(profile, env); } catch { return null; }
}
async function walletCookieOrThrow(profile, env) {
  if (!env.MEMBER_KEY || env.MEMBER_KEY.length < 32) throw new Error("Wallet identity signing is unavailable");
  const iat = Date.now();
  const payload = b64u(enc.encode(JSON.stringify({ sub: profile.sub, email: profile.email.toLowerCase(), iat, exp: iat + DAYS * 86400_000 })));
  const key = await crypto.subtle.importKey("raw", enc.encode(env.MEMBER_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`wallet-auth.${payload}`)))].map(b => b.toString(16).padStart(2, "0")).join("");
  return `blix_wallet=${payload}.${sig}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${DAYS * 86400}`;
}
async function isAdmin(req, env) {
  return Boolean(await ownerOf(req, env));
}
// The owner signed in with Google (an email in OWNER_EMAILS), or null. That is the only way into /__admin: the
// ADMIN_KEY login was removed (2026-10-09) so that no shared key can open it; the session is signed here at Google
// sign-in like any member's and cannot be made up without SESSION_KEY.
async function ownerOf(req, env) {
  const email = await session(req, env).catch(() => null);
  return email && String(env.OWNER_EMAILS || "").toLowerCase().split(/[\s,]+/).includes(email.toLowerCase()) ? email.toLowerCase() : null;
}

// Cloudflare Web Analytics (injected by Cloudflare at the zone) is the only script allowed; Google profile
// pictures are the only outside images.
const CSP = "default-src 'none'; script-src https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com; style-src 'unsafe-inline'; font-src 'self'; img-src 'self' https://lh3.googleusercontent.com; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const HEAD = (title, extra = "") => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · BLIX</title><meta name="robots" content="noindex"><meta name="theme-color" content="#050608">${extra}
<link rel="icon" href="/_pub/icon.svg?v=eye2" type="image/svg+xml">
<link rel="preload" href="/_pub/fonts/inter-tight.woff2" as="font" type="font/woff2" crossorigin>
<style>@font-face{font-family:'Inter Tight';font-style:normal;font-weight:400 700;font-display:swap;src:url(/_pub/fonts/inter-tight.woff2) format('woff2')}@font-face{font-family:'JetBrains Mono';font-style:normal;font-weight:400 500;font-display:swap;src:url(/_pub/fonts/jetbrains-mono.woff2) format('woff2')}</style>`;
const send = (html, status = 200, extra = {}) => new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": CSP, "x-content-type-options": "nosniff", "referrer-policy": "same-origin", "x-robots-tag": "noindex", ...extra } });

const page = (title, body, status = 200) => send(`${HEAD(title)}
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{min-height:100vh;display:grid;place-items:center;padding:32px 16px;background:radial-gradient(ellipse 60% 45% at 50% -5%,rgba(190,198,214,.13),transparent 70%),radial-gradient(ellipse 40% 30% at 50% 105%,rgba(120,130,150,.06),transparent 70%),#050608;color:#f4f6fa;font-family:"Inter Tight",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
body::before{content:"";position:fixed;inset:0;pointer-events:none;background-image:linear-gradient(rgba(255,255,255,.028) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.028) 1px,transparent 1px);background-size:48px 48px;mask-image:radial-gradient(ellipse 55% 50% at 50% 40%,#000,transparent 75%);-webkit-mask-image:radial-gradient(ellipse 55% 50% at 50% 40%,#000,transparent 75%)}
a{color:#d9dce2}
a:focus-visible{outline:2px solid #f4f6fa;outline-offset:5px}
.back{display:flex;align-items:center;justify-content:center;min-height:40px;margin-top:6px;font-size:13.5px;color:#7d8594;text-decoration:none;transition:color .15s}.back:hover{color:#f4f6fa}
.alt a{display:inline-flex;align-items:center;min-height:44px}
.card{position:relative;width:min(420px,100%);background:linear-gradient(180deg,rgba(18,21,27,.92),rgba(9,11,14,.96));border:1px solid rgba(255,255,255,.07);border-radius:24px;padding:40px 32px 28px;box-shadow:0 1px 0 rgba(255,255,255,.06) inset,0 50px 100px -40px rgba(0,0,0,.95),0 0 0 1px rgba(0,0,0,.6);backdrop-filter:blur(12px);animation:rise .5s cubic-bezier(.2,.8,.2,1) both}
.card::before{content:"";position:absolute;top:0;left:18%;right:18%;height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.35),transparent)}
@keyframes rise{from{opacity:0;transform:translateY(10px)}}
.logo{display:inline-flex;margin-bottom:26px;border-radius:16px;box-shadow:0 0 0 1px rgba(255,255,255,.09),0 12px 30px -8px rgba(0,0,0,.9),0 0 40px -6px rgba(200,206,220,.18)}.logo img{display:block;width:52px;height:52px;border-radius:16px}
.si{text-align:center}.card:has(.si){text-align:center}.si h1{font-size:30px}.si>p{max-width:330px;margin:0 auto;font-size:15.5px}
.perks{display:grid;gap:11px;margin:26px 0 0;padding:20px 0 0;border-top:1px solid rgba(255,255,255,.06);text-align:left}.perks li{display:flex;align-items:center;gap:11px;padding:0;font-size:14.5px;color:#c3c8d1}.perks li::before{display:none}.perks svg{width:18px;height:18px;flex:none;padding:3px;border-radius:50%;background:rgba(34,211,138,.12);color:#22d38a}
h1{font-size:34px;letter-spacing:-.035em;line-height:1.08;font-weight:650;margin-bottom:10px;background:linear-gradient(180deg,#fff 30%,#c9ced8);-webkit-background-clip:text;background-clip:text;color:transparent}
p{color:#9aa1ad;font-size:16px;line-height:1.55}
.g{display:flex;align-items:center;justify-content:center;gap:12px;margin-top:28px;font-weight:600;font-size:16px;background:#f4f5f7;color:#0a0b0d;border-radius:14px;height:52px;padding:0 22px;text-decoration:none;box-shadow:0 1px 0 #fff inset,0 10px 28px -12px rgba(255,255,255,.4);transition:transform .15s,background .15s,box-shadow .15s}
.g:hover{background:#fff;transform:translateY(-1px)}.g svg{width:20px;height:20px;flex:none}
.fine{margin-top:14px;font-size:12.5px;color:#7d8594;text-align:center;line-height:1.5}
.me{display:flex;align-items:center;gap:12px;margin:22px 0 4px;padding:12px 14px;border-radius:16px;background:#07080b;border:1px solid #161a21}
.me img{width:40px;height:40px;border-radius:50%;flex:none}.me div{min-width:0}.me b{display:block;font-weight:600;font-size:15px}.me span{display:block;color:#aeb4bf;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.err{background:rgba(255,90,106,.1);border:1px solid rgba(255,90,106,.35);color:#ffb3bb;border-radius:12px;padding:10px 12px;font-size:14px;margin-top:18px}
.alt{margin-top:22px;font-size:14.5px;color:#8f97a4;text-align:center}.alt a{color:#f4f6fa;font-weight:500;text-decoration:none;border-bottom:1px solid rgba(255,255,255,.25);min-height:0;padding-bottom:1px}.alt a:hover{border-color:#fff}
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
.foot{margin-top:26px;display:flex;justify-content:space-between;font-size:14px;color:#a0a8b7}.foot a{color:#aeb4bf}
</style></head><body><main class="card">
<a class="logo" href="/" aria-label="BLIX home"><img src="/_pub/home/eye-logo.webp" alt="BLIX" width="52" height="52"></a>
${body}
</main></body></html>`, status);

const GOOGLE_G = `<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;

// /start and /login: a page of its own (not `page` above, which the waiting and account pages share): just the
// sign-in, centred on a dark page. Everything inline (the CSP above).
const SIGN_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{min-height:100vh;display:grid;place-items:center;padding:32px 20px;background:radial-gradient(ellipse 60% 40% at 50% 0%,rgba(190,198,214,.07),transparent 70%),#050608;color:#f4f6fa;font-family:"Inter Tight",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit}
a:focus-visible{outline:2px solid #f4f6fa;outline-offset:4px;border-radius:6px}
.form{width:100%;max-width:380px;animation:rise .5s cubic-bezier(.2,.8,.2,1) both}
@keyframes rise{from{opacity:0;transform:translateY(8px)}}
h1{font-size:40px;line-height:1.05;letter-spacing:-.035em;font-weight:700}
.lead{margin-top:12px;color:#9aa1ad;font-size:15.5px;line-height:1.55}
.err{margin-top:20px;background:rgba(255,90,106,.08);border:1px solid rgba(255,90,106,.32);color:#ffb3bb;border-radius:12px;padding:11px 13px;font-size:14px;line-height:1.45}
.g{display:flex;align-items:center;justify-content:center;gap:12px;margin-top:28px;height:54px;border-radius:14px;background:#f5f6f8;color:#0a0b0d;font-weight:600;font-size:16px;text-decoration:none;box-shadow:0 1px 0 #fff inset,0 18px 40px -18px rgba(255,255,255,.45);transition:transform .15s,background .15s,box-shadow .15s}
.g:hover{background:#fff;transform:translateY(-1px);box-shadow:0 1px 0 #fff inset,0 22px 46px -18px rgba(255,255,255,.55)}
.g:active{transform:none}
.g svg{width:20px;height:20px;flex:none}
.alt{margin-top:22px;font-size:14.5px;color:#8a919d;text-align:center}
.alt a{color:#f4f6fa;font-weight:600;text-decoration:none;border-bottom:1px solid rgba(255,255,255,.25);padding-bottom:1px}.alt a:hover{border-color:#fff}
@media (max-width:480px){h1{font-size:34px}}
@media (prefers-reduced-motion:reduce){.form{animation:none}}`;

const signIn = (kind, err = "") => {
  const start = kind !== "login";
  const title = start ? "Start trading" : "Log in";
  return send(`${HEAD(title)}
<style>${SIGN_CSS}</style></head><body>
<main class="form">
<h1>${start ? "Start trading" : "Welcome back"}</h1>
<p class="lead">${start ? "Sign in with Google to get started." : "Sign in with Google to get back to your desk."}</p>
${err ? `<div class="err" role="alert">${esc(err)}</div>` : ""}
<a class="g" href="/auth/google?from=${start ? "start" : "login"}">${GOOGLE_G}Continue with Google</a>
<div class="alt">${start ? `Already have an account? <a href="/login">Log in</a>` : `New here? <a href="/start">Create an account</a>`}</div>
</main>
</body></html>`, err ? 400 : 200);
};

const go = (to, ...cookies) => {
  const h = new Headers({ location: to, "cache-control": "no-store" });
  for (const c of cookies) if (c) h.append("set-cookie", c);
  return new Response(null, { status: 303, headers: h });
};
// `prefix`: "/trade" when reached as blixvip.com/trade/... (index.js), "" on trade.blixvip.com.
const callbackUrl = (url, prefix = "") => `${url.origin}${prefix}/auth/google/callback`;
const clearState = `${STATE}=; Path=/auth/google; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
const ERRORS = {
  denied: "You cancelled the Google sign-in. Try again whenever you're ready.",
  busy: "Too many tries. Wait a minute and try again.",
  setup: "Google sign-in isn't switched on yet. Check back soon.",
  expired: "That sign-in took too long or was opened in another browser. Try again.",
  google: "Google couldn't finish the sign-in. Try again.",
  failed: "The sign-in didn't go through. Try again.",
};

// The id_token comes straight from Google's token endpoint over TLS, so its signature need not be checked
// again; who it was issued to, by whom, and until when are.
async function googleProfile(code, url, env, prefix) {
  let r, j;
  try {
    r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: callbackUrl(url, prefix), grant_type: "authorization_code" }) });
    j = await r.json();
  } catch { throw new Error("Google didn't answer. Try again."); }
  if (!r.ok || !j?.id_token) throw new Error(`Google refused the sign-in${j?.error ? ` (${j.error})` : ""}. Try again.`);
  let c;
  try { c = JSON.parse(decodeURIComponent(escape(atob(j.id_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))))); } catch { throw new Error("Google sent an unreadable answer. Try again."); }
  if (c.aud !== env.GOOGLE_CLIENT_ID || !["https://accounts.google.com", "accounts.google.com"].includes(c.iss) || !Number.isSafeInteger(c.exp) || c.exp * 1000 <= Date.now()) throw new Error("That Google sign-in wasn't meant for BLIX.");
  if (!c.sub || !c.email || c.email_verified !== true) throw new Error("That Google account has no verified email.");
  return { sub: String(c.sub), email: String(c.email).toLowerCase(), name: c.name ? String(c.name).slice(0, 120) : null,
    picture: /^https:\/\/lh3\.googleusercontent\.com\//.test(c.picture || "") ? String(c.picture).slice(0, 500) : null };
}

// Returns a Response for the waitlist's paths, or null for everything else.
export async function waitlist(req, env, url, { limited, defer, prefix = "", callbackPrefix = prefix }) {
  const p = url.pathname.toLowerCase().replace(/\/+$/, "") || "/";
  if (p === "/__admin" || p === "/__admin.csv" || p === "/__admin/status" || p === "/__admin/live" || p === "/__admin/data" || p === "/__admin/pic") return admin(req, env, url, p, limited);
  if (!["/start", "/login", "/waiting", "/logout", "/auth/google", "/auth/google/callback"].includes(p)) return null;
  if (req.method !== "GET" && req.method !== "HEAD") return new Response(null, { status: 405, headers: { allow: "GET" } });
  const info = await who(req, env, url);

  if (p === "/logout") {
    record(env, defer, info, "logout", { path: p, email: await session(req, env) });
    // Also the member cookie for the direct line (index.js memberCookie), set for the whole domain.
    return go("/", `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`, "blix_m=; Domain=.blixvip.com; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0", "blix_wallet=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0");
  }

  if (p === "/waiting") {
    const email = await session(req, env);
    if (!email) return go("/login");
    // On to /app only when memberOf agrees right now: /app sends anyone it turns away back here (via /start), and a
    // "yes" here against a "no" there (D1 down with a KV block, or a cached answer) went round in a redirect loop.
    const onward = async () => (await memberOf(req, env)) ? go("/app") : page("One moment", `
<div class="pill"><i style="background:#ffb020;box-shadow:none;animation:none"></i>One moment</div>
<h1>BLIX is checking your account.</h1>
<p>That is taking longer than it should. Try again in a minute.</p>
<div class="foot"><a href="/waiting">Try again</a><a href="/logout">Log out</a></div>`);
    // D1 out of reach: into the terminal if memberOf lets this session in while D1 is down, rather than an error.
    let acct;
    try { acct = await env.DB.prepare("SELECT email, name, picture, status FROM accounts WHERE email = ?").bind(email).first(); } catch { return onward(); }
    // No row for a valid session: a sign-up from while D1 was down; memberOf writes it (site/pending.js recover).
    if (!acct) { members.delete(email); return onward(); }
    if (acct.status !== "blocked") {
      // An account from before everyone was let in at once: a member from here on.
      if (acct.status !== "member") { try { await env.DB.prepare("UPDATE accounts SET status = 'member' WHERE email = ?").bind(email).run(); } catch {} }
      members.delete(email);
      return onward();
    }
    defer(env.DB.prepare("UPDATE accounts SET last_seen = ? WHERE email = ?").bind(Date.now(), email).run());
    const first = (acct.name || "").split(/\s+/)[0];
    return page("Account paused", `
<div class="pill"><i style="background:#ffb020;box-shadow:none;animation:none"></i>Account paused</div>
<h1>Your account is paused${first ? `, ${esc(first)}` : ""}.</h1>
<p>BLIX has put this account on hold for now. If you think that's a mistake, get in touch and we'll take a look.</p>
<div class="wait" aria-hidden="true"><span class="ring"></span><span class="ring"></span><img src="/_pub/home/bx-logo.webp" alt=""></div>
<ul>
<li>Signed in as <b>${esc(email)}</b>.</li>
<li>Follow <a href="https://x.com/blix_vip" rel="noopener" target="_blank">@blix_vip</a> for news.</li>
</ul>
<div class="me">${acct.picture ? `<img src="${esc(acct.picture)}" alt="" referrerpolicy="no-referrer">` : ""}<div><b>${esc(acct.name || email)}</b><span>Signed in with Google · ${esc(email)}</span></div></div>
<div class="foot"><a href="/">Back to BLIX</a><a href="/logout">Log out</a></div>`);
  }

  if (p === "/start" || p === "/login") {
    // Signed in already: a member straight to /app (two redirects and a D1 read fewer than through /waiting); a
    // paused account to /waiting, which says so (/app would send it back here).
    if (await session(req, env)) return go((await memberOf(req, env)) ? "/app" : "/waiting");
    const e = url.searchParams.get("e");
    // Only the site's own wording: free text from the address would let anyone put words on this page.
    return signIn(p.slice(1), e ? ERRORS[e] || ERRORS.failed : "");
  }

  const back = (kind, e) => go(`/${kind === "login" ? "login" : "start"}?e=${encodeURIComponent(e)}`, clearState);
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return back("start", "setup");

  // Off to Google, with a random state tied to this browser by a signed cookie.
  if (p === "/auth/google") {
    const from = url.searchParams.get("from") === "login" ? "login" : "start";
    if (limited) return back(from, "busy");
    const state = `${b64u(crypto.getRandomValues(new Uint8Array(18)))}.${from}${url.searchParams.get("wallet") === "1" ? ".wallet" : ""}`;
    const q = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: callbackUrl(url, callbackPrefix), response_type: "code", scope: "openid email profile", state, prompt: "select_account", ...(state.endsWith(".wallet") ? { max_age: "0" } : {}) });
    return go(`https://accounts.google.com/o/oauth2/v2/auth?${q}`, `${STATE}=${state}.${await sign(state, `oauth:${sessionKey(env)}`)}; Path=/auth/google; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  }

  // Back from Google.
  const state = url.searchParams.get("state") || "", kept = cookieOf(req, STATE) || "";
  const from = state.endsWith(".login") ? "login" : "start", failKind = from === "login" ? "login_fail" : "signup_fail";
  const cut = kept.lastIndexOf(".");
  if (!state || kept.slice(0, cut) !== state || !sameStr(kept.slice(cut + 1), await sign(state, `oauth:${sessionKey(env)}`))) {
    record(env, defer, info, failKind, { path: p, detail: "state" });
    return back(from, "expired");
  }
  const gerr = url.searchParams.get("error");
  if (gerr) {
    record(env, defer, info, failKind, { path: p, detail: gerr.slice(0, 60) });
    return back(from, gerr === "access_denied" ? "denied" : "google");
  }
  let g;
  try { g = await googleProfile(url.searchParams.get("code") || "", url, env, callbackPrefix); }
  catch (err) { record(env, defer, info, failKind, { path: p, detail: err.message.slice(0, 80) }); return back(from, "failed"); }

  const now = Date.now();
  // Google has said who this is: from here on a D1 failure (the free tier's daily row reads ran out twice on
  // 2026-10-07, and every sign-in died on it) must not keep them out. They get their session and go in; the
  // account row is written when D1 is back (memberOf lets a valid session in meanwhile).
  let had = null, dbDown = false;
  try { had = await env.DB.prepare("SELECT email, status FROM accounts WHERE google_sub = ? OR email = ?").bind(g.sub, g.email).first(); } catch { dbDown = true; }
  if (had) {
    // Signing in again makes an older account a member too; a paused one stays paused (and lands on /waiting).
    // An account recovered from a session alone (site/pending.js) has a `session:` stand-in id: Google's real one now.
    try { await env.DB.prepare("UPDATE accounts SET logins = logins + 1, last_seen = ?, name = ?, picture = ?, google_sub = CASE WHEN google_sub LIKE 'session:%' THEN ? ELSE google_sub END, country = COALESCE(country, ?), city = COALESCE(city, ?), status = CASE WHEN status = 'blocked' THEN 'blocked' ELSE 'member' END WHERE email = ?").bind(now, g.name ?? null, g.picture ?? null, g.sub, info.country ?? null, info.city ?? null, had.email).run(); } catch {}
    members.delete(had.email);
    record(env, defer, info, "login", { path: p, email: had.email });
    return go(had.status === "blocked" ? "/waiting" : state.endsWith(".wallet") ? "/app#/account" : "/app", await sessionCookie(had.email, env), clearState, ...(had.status !== "blocked" && had.email.toLowerCase() === g.email.toLowerCase() ? [await walletCookie(g, env)] : []));
  }
  // Whose invite link (blixvip.com/<handle>, site/handles.js) they came through, if any: credited on the server
  // (which owns invites), so it counts even while D1 refuses writes.
  const ref = await inviteFrom(env, cookieOf(req, REF_COOKIE), g.email);
  if (!dbDown) {
    try {
      // Where they first came from: their earliest visit with a referrer, else this request's.
      const first = await env.DB.prepare("SELECT referrer FROM events WHERE visitor = ? AND referrer IS NOT NULL ORDER BY t LIMIT 1").bind(info.visitor ?? null).first().catch(() => null);
      // A member from the first sign-in: straight into the terminal, with a paper desk of their own.
      await env.DB.prepare("INSERT OR IGNORE INTO accounts (email, google_sub, name, picture, created, last_seen, logins, country, city, referrer, ua, visitor, status, ref) VALUES (?,?,?,?,?,?,1,?,?,?,?,?,'member',?)")
        // D1 refuses undefined (a visitor with no country or city on record threw here, error 1101): null instead.
        .bind(...[g.email, g.sub, g.name, g.picture, now, now, info.country, info.city, first?.referrer || info.referrer, info.ua, info.visitor, ref && ref !== g.email ? ref : null].map((v) => v ?? null)).run();
    } catch { dbDown = true; }
  }
  // D1 down: the sign-up is kept in KV and moves into accounts when D1 answers again (site/pending.js). Without this
  // everyone who signed up during an outage got in but never showed up anywhere.
  if (dbDown) await holdSignup(env, g, info, now);
  record(env, defer, info, dbDown ? "login" : "signup", { path: p, email: g.email });
  return go(state.endsWith(".wallet") ? "/app#/account" : "/app", await sessionCookie(g.email, env), clearState, await walletCookie(g, env));
}

// ---------- Kai's dashboard ----------
const DAY = 86400_000;
const ago = (t) => {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`;
};
const flag = (c) => c && /^[A-Z]{2}$/.test(c) ? String.fromCodePoint(...[...c].map((ch) => 127397 + ch.charCodeAt(0))) + " " + c : "—";

async function admin(req, env, url, p, limited) {
  // Signing in: the key goes in a POST body (never in the address, where it lands in logs, history and referers),
  // paced like sign-ins (20 a minute per address, index.js). A GET without the cookie is a plain "not found".
  const owner = await ownerOf(req, env);
  if (!owner) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store", "x-robots-tag": "noindex" } });

  // Pause someone's account (they land on /waiting instead of the terminal), or let them back in: a form on each row.
  // Every block is in KV as well, so memberOf keeps a paused account out while D1 is unreachable.
  if (p === "/__admin/status") {
    if (req.method !== "POST") return new Response(null, { status: 405 });
    const f = await req.formData(), email = String(f.get("email") || "").toLowerCase(), status = f.get("status") === "blocked" ? "blocked" : "member";
    await env.DB.prepare("UPDATE accounts SET status = ? WHERE email = ?").bind(status, email).run();
    try { if (status === "blocked") await env.REG.put(`blocked:${email}`, "1"); else await env.REG.delete(`blocked:${email}`); } catch {}
    members.delete(email);
    // The kept dashboard (10 min) would still show the old button, and a click there undoes this.
    await caches.default.delete(new Request(`${url.origin}/__admin/__data`)).catch(() => {});
    return new Response(null, { status: 303, headers: { location: "/__admin", "cache-control": "no-store" } });
  }

  // The dashboard's live view: every event and every account changed since `since` (ms), read by index (events_t,
  // accounts_last_seen / accounts_created), so a look every 3 s reads only the rows that are new. Bots' page views
  // come too; the page leaves them out.
  if (p === "/__admin/live") {
    const t = Date.now(), since = Math.max(t - DAY, Math.min(t, Number(url.searchParams.get("since")) || t - 300_000));
    const out = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store", "x-robots-tag": "noindex" } });
    try {
      const [events, accounts] = (await env.DB.batch([
        env.DB.prepare("SELECT id, t, kind, path, email, visitor, country, city, referrer, device, detail FROM events WHERE t > ? ORDER BY t DESC LIMIT 300").bind(since),
        env.DB.prepare("SELECT email, name, picture, created, last_seen, logins, country, city, referrer, status FROM accounts WHERE last_seen > ? ORDER BY last_seen DESC LIMIT 300").bind(since),
      ])).map((r) => r.results);
      return out({ now: t, events, accounts, health: { db: true }, pending: await heldSignups(env) });
    } catch (e) {
      // D1 down: still an answer (not `error`, which the page stops at), with the sign-ups held in KV meanwhile.
      return out({ now: t, events: [], accounts: [], health: { db: false, error: String(e && e.message || e).slice(0, 160) }, pending: await heldSignups(env) });
    }
  }

  if (p === "/__admin.csv") {
    // Every account, then the sign-ups held in KV while D1 was down (status "held"); with D1 down, only those.
    const results = await env.DB.prepare("SELECT email, name, created, last_seen, logins, country, city, referrer, status, handle, ref FROM accounts ORDER BY created").all().then((r) => r.results, () => []);
    const known = new Set(results.map((r) => r.email));
    for (const h of await heldSignups(env, true)) if (!known.has(h.email)) results.push({ email: h.email, name: h.name, created: h.t, last_seen: h.last || h.t, logins: h.logins, country: h.country, city: h.city, referrer: h.referrer, status: "held" });
    // A cell that starts like a formula gets a quote first: a spreadsheet must not run what a sign-up typed as a name.
    const cell = (v) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
    const csv = ["email,name,signed_up,last_seen,logins,country,city,came_from,status,handle,invited_by", ...results.map((r) => [r.email, r.name, new Date(r.created).toISOString(), new Date(r.last_seen).toISOString(), r.logins, r.country, r.city, r.referrer, r.status, r.handle, r.ref].map(cell).join(","))].join("\n");
    return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="blix-waitlist-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "no-store" } });
  }

  // The dashboard page, its data and the profile pictures (site/admin.js, site/admin.html).
  return (await dashboard(req, env, url, p, owner)) || new Response("Not found", { status: 404 });
}
