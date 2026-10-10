// The radar's answers, kept by the page server.
//
// The radar does everything on one thread (the trade feed, the database, research, every page's data), so a
// request can wait behind it: measured 2026-10-06, /api/me took 56 ms at the median, 390 ms at the 90th
// percentile, with pauses of 1-9 s several times a minute, and nothing at all while it restarts. The page asks
// for the same few things every second or two, and a browser sends only six requests at a time to this PC, so
// one slow answer held everything behind it (requests sat 5-12 s in the browser's queue).
//
// The page server runs in its own process (bin/supervise.mjs) and has almost nothing else to do, so it keeps the
// last answer to every read the pages make:
//   - an answer under FRESH_MS old is sent as is (several tabs or parts of a page asking at once cost the
//     radar one request);
//   - otherwise the radar is asked, once per address however many are waiting. If it answers within RACE_MS
//     that answer is sent. If not, the kept answer goes out at once with its age in `x-blix-age` (ms), and the
//     radar's answer, when it lands, is kept for the next ask (the page asks again shortly: lib/api.ts);
//   - while the radar is down or restarting the kept answer is sent straight away, so pages stay drawn;
//   - a page that is just opening asks for the kept answer outright (x-blix-kept: the oldest it will take), draws
//     with it, and asks again at once for the radar's own.
// Nothing is kept for long-lived streams, writes, or anything not listed below. Views that show what the owner
// did (a paper trade, a research request) are read from the radar again after any write.
//
// The radar is asked for plain JSON: compressing for a browser on this PC is wasted work on the radar's thread.
// A browser coming in over the tunnel gets Brotli or gzip from here, done off the main thread.
import http from "node:http";
import zlib from "node:zlib";

const MINT = "[1-9A-HJ-NP-Za-km-z]{32,44}";
// Market data: the same for everyone, and nothing the reader does changes it.
const MARKET = [
  /^\/api\/(overview|market|sparks|ext-sparks|tokens|signals|narratives|narrative-feed|clusters|perf|health|briefs|events|fomo\/list|fomo\/feed|pump\/feed|pump\/board|triage|journal|discover|running|feed\/hot)$/,
  new RegExp(`^/api/(holders|candles)/${MINT}$`),
  new RegExp(`^/api/coin/${MINT}/(trades|big|people|callouts|fomo)$`),
];
// Views that also show what the owner did or asked for: kept the same way, but read again after any write.
const OWN = [
  /^\/api\/(x|fomo|fomo\/board|research|pulse|picks|picks\/all|wallets|paper|paper\/wallet)$/,
  /^\/api\/fomo\/trader\/[A-Za-z0-9_.-]{1,64}$/,
  new RegExp(`^/api/(token|research|wallet)/${MINT}$`),
  new RegExp(`^/api/coin/${MINT}$`),
];
// "market", "own", or null (not kept: passed straight to the radar).
export function kind(method, url) {
  if (method !== "GET") return null;
  const q = url.indexOf("?"), p = q < 0 ? url : url.slice(0, q);
  if (q >= 0 && /[?&]fresh=/.test(url)) return null;   // the reader asked for a new read
  // A chart's "what changed since <its last candle>": the chart lays the answer over what it has drawn, trades the
  // live stream pushed included, so an older answer would step the last candle back. Always the radar's own.
  if (q >= 0 && /[?&]since=/.test(url) && p.startsWith("/api/candles/")) return null;
  if (MARKET.some((re) => re.test(p))) return "market";
  if (OWN.some((re) => re.test(p))) return "own";
  return null;
}

const FRESH_MS = 200;          // younger than this: sent as is
const RACE_MS = 100;           // how long the radar has to answer before the kept answer goes out...
const RACE_COLD_MS = 300;      // ...and when the kept one is older than COLD_MS (a page just opened)
const COLD_MS = 15_000;
const MAX_KEPT_MS = 30 * 60_000;   // a kept answer older than this is not sent; the reader waits for the radar
const DOWN_MS = 400;           // after the radar refuses a connection, it is not asked again for this long
const MAX_ONE = 8e6, MAX_BYTES = 128e6, MAX_KEYS = 800;
const now = () => Date.now();
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms, null));

const kept = new Map();        // address -> entry; the least recently asked first
let bytes = 0, writes = 0, downUntil = 0;
export const cacheStats = { asks: 0, fromRadar: 0, fresh: 0, keptSent: 0, keptWhileDown: 0, waited: 0, failed: 0, radarCalls: 0, radarErrors: 0, keys: 0, bytes: 0 };

// A write went through (the page server calls this when one ends, however it ended): a view of the owner's own
// state is only sent if the radar was asked for it after that. Counted, not timed: an answer that was already on
// its way when the write landed may still describe the moment before it.
export function wrote() { writes++; }

const agent = new http.Agent({ keepAlive: true, maxSockets: 64, maxFreeSockets: 16 });
function ask(port, url) {
  return new Promise((resolve, reject) => {
    const go = (again) => {
      const out = http.request({ host: "127.0.0.1", port, path: url, method: "GET", agent,
        headers: { host: `localhost:${port}`, accept: "application/json", "accept-encoding": "identity" } }, (r) => {
        const parts = []; let n = 0;
        r.on("data", (c) => { n += c.length; if (n > MAX_ONE * 2) return out.destroy(new Error("answer too large")); parts.push(c); });
        r.on("end", () => resolve({ status: r.statusCode || 502, type: String(r.headers["content-type"] || "application/json"), body: Buffer.concat(parts) }));
        r.on("error", reject);
      });
      out.setTimeout(30_000, () => out.destroy(Object.assign(new Error("the radar took too long"), { code: "ETIMEDOUT" })));
      // A kept-alive connection the radar closed a moment ago fails the first write: ask once more on a new one.
      out.on("error", (e) => (!again && out.reusedSocket && e.code === "ECONNRESET" ? go(true) : reject(e)));
      out.end();
    };
    go(false);
  });
}

function drop(e) { if (kept.get(e.url) === e) { kept.delete(e.url); bytes -= e.body?.length || 0; } }
function trim() {
  for (const e of kept.values()) {
    if (kept.size <= MAX_KEYS && bytes <= MAX_BYTES) break;
    if (!e.pending) drop(e);
  }
  cacheStats.keys = kept.size; cacheStats.bytes = bytes;
}

// One request to the radar per address at a time, whoever is waiting. Resolves to the entry, updated.
function refresh(e, port) {
  if (e.pending) return e.pending;
  if (now() < downUntil) return Promise.reject(Object.assign(new Error("the radar is restarting"), { down: true }));
  cacheStats.radarCalls++;
  const asked = writes;
  e.pendingAsked = asked; e.pendingAt = now();
  const p = ask(port, e.url).then((got) => {
    // A server error is not an answer worth keeping over a good one.
    if (got.status >= 500) throw Object.assign(new Error(`the radar answered ${got.status}`), { got });
    if (kept.get(e.url) === e) bytes += got.body.length - (e.body?.length || 0);
    e.status = got.status; e.type = got.type; e.body = got.body; e.t = now(); e.asked = asked; e.zips = null; e.shaped = null;
    if (got.body.length > MAX_ONE) drop(e);   // sent to whoever is waiting, not kept
    trim();
    return e;
  }, (err) => {
    cacheStats.radarErrors++;
    if (err.code === "ECONNREFUSED" || err.code === "ECONNRESET") { downUntil = now() + DOWN_MS; err.down = true; }
    throw err;
  }).finally(() => { if (e.pending === p) e.pending = null; });
  p.catch(() => {});   // a refresh nobody is waiting on must not be an unhandled rejection
  e.pending = p;
  return p;
}

// Brotli (or gzip) for a reader over the tunnel, off the main thread, once per kept answer and encoding.
function zipped(e, enc) {
  e.zips ||= {};
  if (!e.zips[enc]) {
    const body = e.body;
    e.zips[enc] = new Promise((ok) => {
      const done = (err, out) => ok(err ? null : out);
      if (enc === "br") zlib.brotliCompress(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: body.length } }, done);
      else zlib.gzip(body, { level: 5 }, done);
    });
  }
  return e.zips[enc];
}

// `shape`: what this reader may see of the answer, when that is less than all of it (a 200 only).
async function send(req, res, e, local, age, shape) {
  if (res.destroyed || res.writableEnded) return;
  const headers = { "content-type": e.type, "cache-control": "no-store", "x-content-type-options": "nosniff" };
  if (age > 0) headers["x-blix-age"] = String(Math.round(age));
  // What this reader may see is worked out once per kept answer and shape (a Map on the entry, emptied when a new
  // answer lands) and compressed like any other: it used to be parsed, rebuilt and sent uncompressed per request.
  let src = e;
  if (shape && e.status === 200) {
    e.shaped ||= new Map();
    src = e.shaped.get(shape);
    if (!src) {
      try { src = { body: Buffer.from(JSON.stringify(shape(JSON.parse(e.body.toString("utf8"))))), zips: null }; }
      catch { res.writeHead(502, { "content-type": "application/json", "cache-control": "no-store" }); return res.end('{"error":"Blix is busy. Trying again."}'); }
      e.shaped.set(shape, src);
    }
  }
  let body = src.body;
  if (!local && body.length >= 1024) {
    const accepts = String(req.headers["accept-encoding"] || ""), enc = /\bbr\b/.test(accepts) ? "br" : /\bgzip\b/.test(accepts) ? "gzip" : null;
    const zip = enc ? await zipped(src, enc) : null;
    if (res.destroyed || res.writableEnded) return;
    if (zip) { body = zip; headers["content-encoding"] = enc; headers.vary = "accept-encoding"; }
  }
  res.writeHead(e.status, headers);
  res.end(body);
}

function fail(res, err) {
  cacheStats.failed++;
  if (res.destroyed || res.writableEnded) return;
  const down = err?.down || err?.code === "ECONNREFUSED";
  if (err?.got) { res.writeHead(err.got.status, { "content-type": err.got.type, "cache-control": "no-store" }); return res.end(err.got.body); }
  res.writeHead(down ? 503 : 504, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify({ error: down ? "Blix is restarting. Back in a few seconds." : "Blix is busy. Trying again." }));
}

// Answers one GET the page server may keep (kind() said "market" or "own"). `local`: the browser is on this PC.
export async function answer(req, res, port, cls, local, shape) {
  const url = req.url, t = now();
  cacheStats.asks++;
  let e = kept.get(url);
  if (e) { kept.delete(url); kept.set(url, e); }   // asked most recently: last to go
  else { e = { url, cls, t: 0, asked: -1, status: 0, type: "", body: null, zips: null, pending: null, pendingAsked: -1 }; kept.set(url, e); trim(); }
  const has = Boolean(e.body), age = has ? t - e.t : Infinity;
  const behind = cls === "own" && e.asked !== writes;   // a write ended since the radar was asked for this
  // A reader that was just sent a kept copy asks again a moment later and says how long ago that was
  // (x-blix-fresh, ms): whatever the radar has answered since is news to it, and goes out without asking again.
  const fresh = Math.max(FRESH_MS, Math.min(5000, Number(req.headers["x-blix-fresh"]) || 0));
  if (has && !behind && age < fresh) { cacheStats.fresh++; return send(req, res, e, local, 0, shape); }
  // A page that is just opening (or about to be) says it will take a copy up to so old at once (x-blix-kept, ms,
  // two minutes at most): it draws with it and asks again straight away. The radar is asked now, for that.
  const takes = Math.min(120_000, Number(req.headers["x-blix-kept"]) || 0);
  if (has && !behind && age <= takes) { refresh(e, port); cacheStats.keptSent++; return send(req, res, e, local, Math.max(1, age), shape); }
  if (!has || behind || age >= MAX_KEPT_MS) {
    // Nothing to fall back on, or the reader just changed something: the radar's answer, however long it takes.
    cacheStats.waited++;
    try {
      // A request that left before the write ended does not count: wait it out, then ask again.
      if (behind && e.pending && e.pendingAsked !== writes) await e.pending.catch(() => {});
      await refresh(e, port);
      cacheStats.fromRadar++;
      return send(req, res, e, local, 0, shape);
    } catch (err) {
      // The radar is down or failing and something is kept after all: better than an error.
      if (e.body && now() - e.t < MAX_KEPT_MS) { cacheStats.keptWhileDown++; return send(req, res, e, local, now() - e.t, shape); }
      if (!e.body) drop(e);
      return fail(res, err);
    }
  }
  // How long the radar gets. Nothing when it has already had this request for over a second (it is slow with
  // this one: /api/market waits on an exchange for up to 12 s); the short wait for a reader that is asking again.
  const slow = e.pending && t - e.pendingAt > 1000;
  const p = refresh(e, port);
  const won = slow ? false : await Promise.race([p.then(() => true, (err) => (err?.down ? "down" : false)), wait(age < COLD_MS || req.headers["x-blix-fresh"] ? RACE_MS : RACE_COLD_MS)]);
  if (won === true) { cacheStats.fromRadar++; return send(req, res, e, local, 0, shape); }
  if (won === "down") cacheStats.keptWhileDown++; else cacheStats.keptSent++;
  return send(req, res, e, local, Math.max(1, now() - e.t), shape);
}

// What is kept right now, for the health view and for checking by hand (local only: /__cache on the page server).
export function cacheReport() {
  const list = [...kept.values()].map((e) => ({ url: e.url.length > 90 ? e.url.slice(0, 90) + "…" : e.url, cls: e.cls, bytes: e.body?.length || 0, age: e.t ? now() - e.t : null, pending: Boolean(e.pending) }));
  return { ...cacheStats, keys: kept.size, bytes, downFor: Math.max(0, downUntil - now()), newest: list.slice(-25).reverse() };
}
