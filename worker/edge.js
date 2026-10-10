// The public front door for the live terminal. A visitor's read is answered from the edge whenever it
// can be, so that any number of visitors cost Kai's PC about one request a second, and so the site still
// shows its last data when the PC is off:
//   fresh copy at the edge  -> served from there
//   otherwise               -> asked from the PC (4 s limit), kept at the edge, a few views also kept in KV
//   PC not answering        -> the last copy, however old, marked `x-blix-stale: <seconds>`
// Anything that is not a visitor's read (a member's request, any write) goes straight to the server.
const MINT = "[1-9A-HJ-NP-Za-km-z]{32,44}";
const API = [
  // [path, seconds a copy stays fresh, seconds between KV snapshots (0 = none), query params kept]
  [/^\/api\/pulse$/, 1, 300, []],
  [/^\/api\/(overview|bot)$/, 3, 900, []],
  [/^\/api\/me$/, 60, 0, []],
  [new RegExp(`^/api/coin/${MINT}/trades$`), 1, 0, ["limit", "before"]],
  [new RegExp(`^/api/(coin|token|research)/${MINT}$`), 3, 0, []],
  [new RegExp(`^/api/holders/${MINT}$`), 3, 0, ["top"]],
  [new RegExp(`^/api/candles/${MINT}$`), 1, 0, ["tf"]],
  [/^\/api\/(signals|tokens)$/, 5, 0, ["sort", "limit", "offset", "kind", "q", "minSafety", "theme", "class", "safe"]],
  [/^\/api\/(narratives|clusters|perf|briefs|research|triage|picks|picks\/all|health)$/, 5, 0, []],
];
const STATIC_EXT = /\.(html|js|css|svg|png|jpg|webp|ico|woff2|json|txt)$/;

// Is this a visitor's read? Everything someone not signed in (no member session, index.js) does is a read; a write
// is refused there.
export function isVisitorRead(method) {
  return method === "GET" || method === "HEAD";
}

// How a visitor's read is kept: { key, ttl, snap } or null when it must not be kept at all.
// The key drops every query parameter the view does not use, so made-up parameters cannot be used to
// get past the edge copy and onto the PC.
export function keepPlan(url) {
  const p = url.pathname;
  if (p.startsWith("/api/")) {
    for (const [re, ttl, snap, params] of API) {
      if (!re.test(p)) continue;
      const q = params.filter((k) => url.searchParams.has(k)).map((k) => `${k}=${encodeURIComponent(String(url.searchParams.get(k)).slice(0, 48))}`).join("&");
      return { key: `${url.origin}${p}${q ? `?${q}` : ""}`, ttl, snap };
    }
    return null;
  }
  if (p.startsWith("/__")) return null;
  if (new RegExp(`^/img/${MINT}$`).test(p)) return { key: `${url.origin}${p}`, ttl: 86400, snap: 0 };
  // The page and its files. Any other path is the app's own route and gets the page itself.
  const file = p === "/" || !STATIC_EXT.test(p) ? "/" : p;
  return { key: `${url.origin}${file}`, ttl: 30, snap: 6 * 3600, path: file };
}

const age = (res, now) => Math.max(0, Math.round((now - Number(res.headers.get("x-blix-t") || 0)) / 1000));
const stale = (res, now) => {
  const h = new Headers(res.headers);
  h.set("x-blix-stale", String(age(res, now)));
  h.set("cache-control", "no-store");
  return new Response(res.body, { status: 200, headers: h });
};
const pending = new Map();                     // one request to the PC per view at a time, shared by everyone waiting
const snapped = new Map();                     // view -> when this isolate last wrote it to KV

// `io` is what the Worker runtime provides: { cache, kv, toOrigin(url) -> Response, defer(promise), now() }.
// The PC is asked for the kept form of the address (plan.key), never for the visitor's own query string.
export async function visitorRead(plan, io) {
  const now = io.now(), req = new Request(plan.key);
  const hit = await io.cache.match(req);
  if (hit && now - Number(hit.headers.get("x-blix-t") || 0) < plan.ttl * 1000) return hit;
  let fresh = null;
  try {
    if (!pending.has(plan.key)) pending.set(plan.key, io.toOrigin(new URL(plan.key)).finally(() => pending.delete(plan.key)));
    const r = (await pending.get(plan.key)).clone();
    if (r.status === 200) {
      const h = new Headers(r.headers);
      h.delete("set-cookie");
      h.set("x-blix-t", String(now));
      h.set("cache-control", "public, max-age=86400");   // how long the edge may hold it as the fallback copy
      const body = await r.arrayBuffer();
      fresh = new Response(body, { status: 200, headers: h });
      io.defer(io.cache.put(req, fresh.clone()));
      if (plan.snap && io.kv && now - (snapped.get(plan.key) || 0) > plan.snap * 1000) {
        snapped.set(plan.key, now);
        io.defer(snapshot(plan, body, h.get("content-type") || "", now, io));
      }
      const out = new Headers(h);
      out.set("cache-control", plan.ttl >= 3600 ? "public, max-age=3600" : "no-store");
      return new Response(body, { status: 200, headers: out });
    }
    // The PC answered, with something other than the view (not open to visitors yet, not found, refused):
    // that answer is the truth, pass it on unkept.
    if (r.status < 500) return r;
  } catch {}
  if (hit) return stale(hit, now);
  if (plan.snap && io.kv) {
    const s = await io.kv.getWithMetadata(`snap:${plan.key}`, "arrayBuffer");
    if (s?.value) return stale(new Response(s.value, { headers: { "content-type": s.metadata?.type || "application/octet-stream", "x-blix-t": String(s.metadata?.t || 0) } }), now);
  }
  return null;
}

// Other isolates write the same snapshots: check the stored time first so the daily KV write allowance holds.
async function snapshot(plan, body, type, now, io) {
  const k = `snap:${plan.key}`;
  const had = await io.kv.getWithMetadata(k, "stream");
  try { had?.value?.cancel?.(); } catch {}
  if (had?.metadata?.t && now - had.metadata.t < plan.snap * 1000) return;
  await io.kv.put(k, body, { metadata: { t: now, type } });
}

// A visitor asking for too much that is not already at the edge (new pictures, new coin pages) is slowed
// down: 240 such requests a minute per address, counted per isolate.
const asked = new Map();
export function overLimit(ip, now, max = 240) {
  const cur = asked.get(ip);
  if (!cur || now - cur.t > 60_000) { if (asked.size > 5000) asked.clear(); asked.set(ip, { t: now, n: 1 }); return false; }
  return ++cur.n > max;
}
