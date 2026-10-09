// The owner's dashboard at /__admin (behind isAdmin in site/waitlist.js): the page (site/admin.html) is static and
// always loads; everything on it comes from /__admin/data and then /__admin/live every few seconds.
//   /__admin/data   the last 30 days of events (bots included, the page sorts them out, so the live poll can use the
//                   same rules) + every account + sign-ups held in KV while D1 was down + who the owners are.
//                   One events read through events(t) instead of ten aggregate scans; kept 60 s in this data
//                   centre so tabs and reloads share it, and the last good copy is kept two days for when D1 is down.
//   /__admin/pic    a Google profile picture through the edge (lh3.googleusercontent.com answers hotlinks of many
//                   pictures at once with 429 and the page showed broken images), kept a day.
import PAGE from "./admin.html";
import { heldSignups, drainHeld } from "./pending.js";

const DAY = 86400_000;
const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
let built = null;   // { body, csp } per isolate: the page's inline script is allowed by its hash

async function page() {
  if (built) return built;
  const hashes = await Promise.all([...PAGE.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(async ([, s]) => `'sha256-${b64(await crypto.subtle.digest("SHA-256", enc.encode(s)))}'`));
  built = {
    body: PAGE,
    csp: `default-src 'none'; script-src ${hashes.join(" ")} https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com; style-src 'unsafe-inline'; font-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
  };
  return built;
}

const json = (o, status = 200, extra = {}) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store", "x-robots-tag": "noindex", ...extra } });
const owners = (env) => String(env.OWNER_EMAILS || "").toLowerCase().split(/[\s,]+/).filter(Boolean);
const keep = (url, name) => new Request(`${url.origin}/__admin/__${name}`);

// Columns with repeated text (kind, path, country, city, referrer, device, visitor) as indexes into one list: a
// month of events is ~5x smaller this way.
function pack(rows) {
  const dict = [], at = new Map();
  const id = (v) => { if (v == null) return -1; let i = at.get(v); if (i === undefined) { i = dict.length; dict.push(v); at.set(v, i); } return i; };
  const ev = rows.map((r) => [r.id, r.t, id(r.kind), id(r.path), r.email || null, id(r.visitor), id(r.country), id(r.city), id(r.referrer), id(r.device), r.detail || null]);
  return { dict, ev };
}

async function data(env, url) {
  const t = Date.now();
  const fresh = url.searchParams.has("fresh");
  const kept = fresh ? null : await caches.default.match(keep(url, "data")).catch(() => null);
  if (kept) { const o = await kept.json(); o.pending = await heldSignups(env); return json(o); }
  // Sign-ups held while D1 was down go in first, so they are counted (the cron does it too, every 10 min).
  if ((await heldSignups(env)).length) await drainHeld(env).catch(() => 0);
  try {
    const [events, accounts] = (await env.DB.batch([
      env.DB.prepare("SELECT id, t, kind, path, email, visitor, country, city, referrer, device, detail FROM events WHERE t > ? ORDER BY t LIMIT 80000").bind(t - 30 * DAY),
      env.DB.prepare("SELECT email, google_sub, name, picture, created, last_seen, logins, country, city, referrer, visitor, status FROM accounts ORDER BY created DESC LIMIT 5000"),
    ])).map((r) => r.results);
    for (const a of accounts) { a.recovered = String(a.google_sub || "").startsWith("session:"); delete a.google_sub; }
    const o = { now: t, from: t - 30 * DAY, owners: owners(env), accounts, ...pack(events), health: { db: true } };
    const body = JSON.stringify(o);
    await caches.default.put(keep(url, "data"), new Response(body, { headers: { "content-type": "application/json", "cache-control": "max-age=60" } })).catch(() => {});
    await caches.default.put(keep(url, "lastgood"), new Response(body, { headers: { "content-type": "application/json", "cache-control": "max-age=172800" } })).catch(() => {});
    o.pending = await heldSignups(env);
    return json(o);
  } catch (e) {
    // D1 down: the last good copy (marked stale), and the sign-ups held in KV meanwhile.
    const last = await caches.default.match(keep(url, "lastgood")).then((r) => r && r.json()).catch(() => null);
    const health = { db: false, error: String(e && e.message || e).slice(0, 200) };
    return json({ ...(last || { now: t, from: t - 30 * DAY, owners: owners(env), accounts: [], dict: [], ev: [] }), stale: Boolean(last), health, pending: await heldSignups(env, true), owners: owners(env) });
  }
}

async function pic(url) {
  const u = url.searchParams.get("u") || "";
  if (!/^https:\/\/lh3\.googleusercontent\.com\/[\w\-./=~%]+$/.test(u)) return new Response(null, { status: 404 });
  const key = new Request(`${url.origin}/__admin/__pic/${encodeURIComponent(u)}`);
  const hit = await caches.default.match(key).catch(() => null);
  if (hit) return hit;
  const r = await fetch(u, { headers: { accept: "image/*" }, signal: AbortSignal.timeout(6000) }).catch(() => null);
  if (!r || !r.ok || !/^image\//.test(r.headers.get("content-type") || "")) return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
  const out = new Response(r.body, { headers: { "content-type": r.headers.get("content-type"), "cache-control": "private, max-age=86400" } });
  await caches.default.put(key, out.clone()).catch(() => {});
  return out;
}

// Called by site/waitlist.js admin() once isAdmin passed; null for paths that are not the dashboard's.
export async function dashboard(req, env, url, p) {
  if (p === "/__admin/data") return data(env, url);
  if (p === "/__admin/pic") return pic(url);
  if (p !== "/__admin") return null;
  const { body, csp } = await page();
  return new Response(body, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": csp, "x-content-type-options": "nosniff", "referrer-policy": "same-origin", "x-robots-tag": "noindex" } });
}
