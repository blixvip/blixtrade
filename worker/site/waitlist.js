// The waitlist behind the landing page's "Start trading": a visitor makes an account (email + password) and
// lands on a waiting page with their place in line. It all lives here at the edge (KV), so it works when
// the PC is off; the terminal itself (/app) still needs the owner's key.
//   /start            make an account (GET form, POST create)
//   /login            sign back in (GET form, POST check)
//   /waiting          the waiting page (needs the blix_wait session cookie)
//   /logout           clears the session
//   /__waitlist       the list as JSON, for Kai (x-reg-key header = REG_KEY)
// KV keys: acct:<email> → { salt, hash, n, t }, acct:count → number of accounts made.
const COOKIE = "blix_wait";
const DAYS = 30;
const enc = new TextEncoder();
const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sameStr = (a, b) => {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
};

async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return b64u(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: 100_000 }, key, 256));
}
async function sign(text, secret) {
  const key = await crypto.subtle.importKey("raw", enc.encode(`wait:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", key, enc.encode(text)));
}
async function session(req, env) {
  const raw = (String(req.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`)) || [])[1];
  if (!raw) return null;
  const [email64, exp, sig] = raw.split(".");
  if (!email64 || !exp || !sig || Number(exp) < Date.now()) return null;
  if (!sameStr(sig, await sign(`${email64}.${exp}`, env.REG_KEY || ""))) return null;
  try { return decodeURIComponent(escape(atob(email64.replace(/-/g, "+").replace(/_/g, "/")))); } catch { return null; }
}
async function sessionCookie(email, env) {
  const email64 = b64u(enc.encode(email)), exp = Date.now() + DAYS * 86400_000;
  return `${COOKIE}=${email64}.${exp}.${await sign(`${email64}.${exp}`, env.REG_KEY || "")}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${DAYS * 86400}`;
}

const CSP = "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const page = (title, body, status = 200, extra = {}) => new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · BLIX</title><meta name="robots" content="noindex"><meta name="theme-color" content="#050608">
<link rel="icon" href="/_pub/icon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{min-height:100vh;display:grid;place-items:center;padding:24px 16px;background:radial-gradient(ellipse 70% 55% at 50% 0%,rgba(176,182,194,.14),transparent 70%),#050608;color:#f4f6fa;font-family:"Inter Tight",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
a{color:#d9dce2}
.card{width:min(420px,100%);background:linear-gradient(180deg,#0d1015,#090b0e);border:1px solid #161a21;border-radius:28px;padding:36px 30px;box-shadow:0 40px 80px -30px rgba(0,0,0,.9)}
.logo{display:flex;align-items:center;gap:4px;margin-bottom:28px;text-decoration:none}.logo img{height:36px}.logo img+img{height:46px;margin-left:-10px}
h1{font-size:34px;letter-spacing:-.04em;line-height:1.05;font-weight:600;margin-bottom:10px}
p{color:#8a92a3;font-size:16px;line-height:1.5}
form{display:grid;gap:12px;margin-top:26px}
label{font-size:14px;color:#aeb4bf;display:grid;gap:6px}
input{font:inherit;font-size:16px;color:#f4f6fa;background:#07080b;border:1px solid #1d222b;border-radius:14px;padding:13px 14px;outline:none;transition:border-color .2s}
input:focus{border-color:rgba(214,218,226,.45)}
button{margin-top:6px;font:inherit;font-weight:600;font-size:17px;background:#f2f3f5;color:#0a0b0d;border:0;border-radius:999px;padding:14px 22px;cursor:pointer;box-shadow:0 10px 30px -10px rgba(255,255,255,.35)}
button:hover{background:#fff}
.err{background:rgba(255,90,106,.1);border:1px solid rgba(255,90,106,.35);color:#ffb3bb;border-radius:12px;padding:10px 12px;font-size:14px;margin-top:18px}
.alt{margin-top:22px;font-size:15px;color:#8a92a3;text-align:center}
.pos{margin:26px 0 8px;padding:22px;border-radius:20px;background:#07080b;border:1px solid #161a21;text-align:center}
.pos b{display:block;font:500 54px/1 "JetBrains Mono",monospace;letter-spacing:-.04em}
.pos span{display:block;margin-top:8px;color:#8a92a3;font-size:14px}
.pill{display:inline-flex;align-items:center;gap:8px;padding:7px 14px;border-radius:999px;border:1px solid rgba(255,255,255,.12);font-size:14px;margin-bottom:18px}
.pill i{width:8px;height:8px;border-radius:50%;background:#e8c55a}
.foot{margin-top:24px;display:flex;justify-content:space-between;font-size:14px;color:#5d6575}.foot a{color:#8a92a3}
</style></head><body><main class="card">
<a class="logo" href="/" aria-label="BLIX home"><img src="/_pub/home/bx-logo.webp" alt=""><img src="/_pub/home/blix-logo.webp" alt="BLIX"></a>
${body}
</main></body></html>`, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": CSP, "x-content-type-options": "nosniff", "referrer-policy": "same-origin", "x-robots-tag": "noindex", ...extra } });

const form = (kind, err = "", email = "") => {
  const start = kind === "start";
  return page(start ? "Start trading" : "Log in", `
<h1>${start ? "Start trading" : "Welcome back"}</h1>
<p>${start ? "Make your BLIX account. We're letting traders in a few at a time, so you'll get a place in line." : "Log in to see your place in line."}</p>
${err ? `<div class="err" role="alert">${esc(err)}</div>` : ""}
<form method="post" action="/${kind}">
<label>Email<input type="email" name="email" required autocomplete="email" maxlength="200" value="${esc(email)}"></label>
<label>Password<input type="password" name="password" required minlength="8" maxlength="200" autocomplete="${start ? "new-password" : "current-password"}"></label>
<button>${start ? "Create account" : "Log in"}</button>
</form>
<div class="alt">${start ? `Already have an account? <a href="/login">Log in</a>` : `New here? <a href="/start">Create an account</a>`}</div>`, err ? 400 : 200);
};

const go = (to, cookie) => new Response(null, { status: 303, headers: { location: to, "cache-control": "no-store", ...(cookie ? { "set-cookie": cookie } : {}) } });

// Returns a Response for the waitlist's paths, or null for everything else.
export async function waitlist(req, env, url, limited) {
  const p = url.pathname.replace(/\/+$/, "") || "/";
  if (!["/start", "/login", "/waiting", "/logout", "/__waitlist"].includes(p)) return null;

  if (p === "/__waitlist") {
    if (!sameStr(req.headers.get("x-reg-key") || "", env.REG_KEY || "-")) return new Response("no", { status: 403 });
    const rows = [];
    let cursor;
    do {
      const l = await env.REG.list({ prefix: "acct:", cursor });
      for (const k of l.keys) if (k.name !== "acct:count") rows.push({ email: k.name.slice(5), ...(k.metadata || {}) });
      cursor = l.list_complete ? null : l.cursor;
    } while (cursor);
    rows.sort((a, b) => (a.n || 0) - (b.n || 0));
    return new Response(JSON.stringify({ count: rows.length, accounts: rows }, null, 2), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
  }

  if (p === "/logout") return go("/", `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);

  if (p === "/waiting") {
    const email = await session(req, env);
    if (!email) return go("/login");
    const acct = await env.REG.get(`acct:${email}`, "json");
    if (!acct) return go("/start");
    const total = Number(await env.REG.get("acct:count")) || acct.n;
    return page("You're on the list", `
<div class="pill"><i></i>On the waitlist</div>
<h1>You're in line.</h1>
<p>Your BLIX account is ready. We're opening the terminal to traders in order, and we'll email <b style="color:#dfe5ef;font-weight:500">${esc(email)}</b> when it's your turn.</p>
<div class="pos"><b>#${acct.n}</b><span>your place in line · ${total} ${total === 1 ? "trader" : "traders"} waiting</span></div>
<p style="font-size:14px">Follow <a href="https://x.com/blix_vip" rel="noopener" target="_blank">@blix_vip</a> for launch updates.</p>
<div class="foot"><a href="/">Back to BLIX</a><a href="/logout">Log out</a></div>`);
  }

  // /start and /login
  const kind = p.slice(1);
  if (req.method === "GET" || req.method === "HEAD") {
    if (await session(req, env)) return go("/waiting");
    return form(kind);
  }
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { allow: "GET, POST" } });
  const origin = req.headers.get("origin");
  if (origin && origin !== url.origin) return new Response("Bad origin", { status: 403 });
  if (limited) return form(kind, "Too many tries. Wait a minute and try again.");
  let data;
  try { data = await req.formData(); } catch { return form(kind, "Something went wrong. Try again."); }
  const email = String(data.get("email") || "").trim().toLowerCase().slice(0, 200);
  const password = String(data.get("password") || "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return form(kind, "Enter a valid email address.", email);
  if (password.length < 8 || password.length > 200) return form(kind, "Your password needs at least 8 characters.", email);

  const key = `acct:${email}`;
  const acct = await env.REG.get(key, "json");
  if (kind === "login") {
    if (!acct || !sameStr(await hashPassword(password, acct.salt), acct.hash)) return form(kind, "That email and password don't match an account.", email);
    return go("/waiting", await sessionCookie(email, env));
  }
  if (acct) return form(kind, "There's already an account with that email. Log in instead.", email);
  const n = (Number(await env.REG.get("acct:count")) || 0) + 1;
  const salt = b64u(crypto.getRandomValues(new Uint8Array(16)));
  const t = Date.now();
  await env.REG.put(key, JSON.stringify({ salt, hash: await hashPassword(password, salt), n, t }), { metadata: { n, t } });
  await env.REG.put("acct:count", String(n));
  return go("/waiting", await sessionCookie(email, env));
}
