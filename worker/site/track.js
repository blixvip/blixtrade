// Site activity for trade.blixvip.com, kept in D1 (binding DB, schema in migrations/) so it is recorded
// whether or not the PC is on. Every page view of the public pages is one row in `events`; nothing is
// written for assets, API calls or pictures. A visitor is a keyed hash of their address + browser (no
// cookie, raw addresses are never stored), which ties their visits before signing up to their account.
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function visitorOf(req, env) {
  const ip = req.headers.get("cf-connecting-ip") || "", ua = req.headers.get("user-agent") || "";
  const key = await crypto.subtle.importKey("raw", enc.encode(`visitor:${env.REG_KEY || ""}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(`${ip}|${ua}`))).slice(0, 16);
}

export function deviceOf(ua) {
  ua = String(ua || "");
  if (!ua || /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|curl|wget|python|node-fetch|headless|lighthouse|monitor/i.test(ua)) return "bot";
  if (/ipad|tablet/i.test(ua)) return "tablet";
  if (/mobi|iphone|android/i.test(ua)) return "mobile";
  return "desktop";
}

// Where they came from: another site's address (host + path), or ?ref= / ?utm_source= on the link.
export function referrerOf(req, url) {
  const tag = url.searchParams.get("ref") || url.searchParams.get("utm_source");
  if (tag) return tag.slice(0, 80);
  const r = req.headers.get("referer");
  if (!r) return null;
  try { const u = new URL(r); return u.host === url.host ? null : (u.host + u.pathname).replace(/\/$/, "").slice(0, 120); } catch { return null; }
}

export async function who(req, env, url) {
  const cf = req.cf || {};
  return {
    visitor: await visitorOf(req, env),
    country: cf.country || null,
    city: cf.city || null,
    referrer: referrerOf(req, url),
    device: deviceOf(req.headers.get("user-agent")),
    ua: (req.headers.get("user-agent") || "").slice(0, 300),
  };
}

// Record one event; `defer` keeps the response from waiting on the write.
export function record(env, defer, info, kind, { path = null, email = null, detail = null } = {}) {
  if (!env.DB) return;
  defer(env.DB.prepare("INSERT INTO events (t, kind, path, email, visitor, country, city, referrer, device, detail) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .bind(Date.now(), kind, path, email, info.visitor, info.country, info.city, info.referrer, info.device, detail).run());
}

// Pages worth a row: what a person opens in a browser, not the files and data those pages load.
export function isPageView(req, url) {
  if (req.method !== "GET") return false;
  const p = url.pathname;
  if (/^\/(_pub|api|img|assets|brand|cdn-cgi|auth|__)\//.test(p) || p.startsWith("/__")) return false;
  if (/\.(js|css|png|jpe?g|webp|svg|ico|woff2?|json|txt|xml|map)$/i.test(p)) return false;
  return /text\/html/.test(req.headers.get("accept") || "") || p === "/";
}
