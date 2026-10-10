// Blix's service worker (registered by src/main.tsx on blixvip.com, scope /app): repeat visits draw the terminal
// without waiting on the network for its page and built files.
// - /app itself: the copy from the last visit is drawn at once, and a fresh one is fetched behind it for next time
//   (the same as the Worker's edge copy, worker/index.js keepPage). Only while the member cookie that came with the
//   last fresh copy (or the last api/me) is still good (blix_m, 20 minutes): after that the page comes from the
//   network as before, so its reads can go straight to the server (the direct line) with a new cookie.
// - assets/<name>-<hash>.js|css never change under the same name: kept here, and the coin page's files are fetched
//   ahead a few seconds after a fresh page, so the first coin opened does not wait for them.
// - Everything else (api reads, streams, logos) is not touched.
// Signed out (the fresh /app is a redirect to /start): the kept page is dropped and the open page reloads.
// To switch it off for everyone: replace this file with one that calls self.registration.unregister() and
// deletes the blix-* caches, and deploy web/dist.
// blix-page-v2 (2026-10-10): every kept page dropped once; old builds had an Update bar that could not leave them.
const PAGE = "blix-page-v2", FILES = "blix-files-v1", META = "blix-meta-v1";
const FRESH_MS = 15 * 60_000;   // under blix_m's 20 minutes (worker/index.js memberCookie)
const MAX_FILES = 400;
const ASSET = /^\/assets\/[\w.-]+$/;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith("blix-") && ![PAGE, FILES, META].includes(k)) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === "navigate") { if (url.pathname === "/app") e.respondWith(page(e)); return; }
  if (ASSET.test(url.pathname)) return e.respondWith(file(req));
  // The terminal's ping (src/lib/role.ts) sets a new blix_m too.
  if (url.pathname === "/api/me") e.respondWith(fetch(req).then((r) => { if (r.ok) e.waitUntil(stamp()); return r; }));
});

// When the member cookie was last set (kept in a cache: the worker itself does not live between visits).
const stamp = async () => (await caches.open(META)).put("/stamp", new Response(String(Date.now())));
const stampAt = async () => { try { return Number(await (await (await caches.open(META)).match("/stamp"))?.text()) || 0; } catch { return 0; } };
const forget = async () => { await caches.delete(PAGE); await caches.delete(META); };

async function page(e) {
  const cache = await caches.open(PAGE);
  const kept = await cache.match("/app");
  const quick = Boolean(kept) && Date.now() - await stampAt() < FRESH_MS;
  const net = fetch(e.request).then(async (r) => {
    // A navigation's redirect comes back as an opaque one (type "opaqueredirect", not ok).
    if (r.ok && r.type === "basic" && /text\/html/.test(r.headers.get("content-type") || "")) {
      await cache.put("/app", r.clone());
      await stamp();
      e.waitUntil(ahead(r.clone()));
    } else if (kept && (r.type === "opaqueredirect" || r.status === 401 || r.status === 403)) {
      await forget();
      // The page this navigation opens may not exist yet when the answer is back: asked for until it does (5 s).
      if (quick) for (let i = 0; i < 50; i++) {
        const c = e.resultingClientId && await self.clients.get(e.resultingClientId);
        if (c) { c.postMessage("blix:reload"); break; }
        await new Promise((ok) => setTimeout(ok, 100));
      }
    }
    return r;
  });
  if (quick) { e.waitUntil(net.catch(() => {})); return kept; }
  try { return await net; } catch { return kept || Response.error(); }
}

async function file(req) {
  const cache = await caches.open(FILES);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  const r = await fetch(req);
  if (r.ok && r.type === "basic") await cache.put(req.url, r.clone());
  return r;
}

// The page's own files and the coin page's (index.html's page list, vite.config.ts pageChunks), a few seconds
// after the page has loaded so they never compete with it; then the oldest kept files past MAX_FILES go.
async function ahead(res) {
  const html = await res.text();
  const names = new Set([...html.matchAll(/(?:src|href)="\/?(assets\/[\w.-]+)"/g)].map((m) => m[1]));
  const coin = html.match(/"coin":\[([^\]]*)\]/);
  if (coin) for (const m of coin[1].matchAll(/"(assets\/[\w.-]+)"/g)) names.add(m[1]);
  await new Promise((ok) => setTimeout(ok, 8000));
  const cache = await caches.open(FILES);
  for (const n of names) {
    const u = new URL("/" + n, self.location.origin).href;
    if (await cache.match(u)) continue;
    try { const r = await fetch(u); if (r.ok) await cache.put(u, r); } catch {}
  }
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_FILES))) await cache.delete(k);
}
