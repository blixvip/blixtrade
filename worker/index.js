// trade.blixvip.com → the live Blix terminal on Kai's PC.
// Blix registers its current quick-tunnel address (POST /__register with the REG_KEY secret); every other
// request is forwarded to that address as-is, streaming (the live event stream included). The access key
// gate itself lives in Blix, so this Worker holds no logic about who may enter.
let cached = { origin: null, t: 0 };

const timingSafeEqual = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
};

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/__register") {
      if (req.method !== "POST" || !timingSafeEqual(req.headers.get("x-reg-key") || "", env.REG_KEY || "")) return new Response("no", { status: 403 });
      let body = {};
      try { body = await req.json(); } catch {}
      const origin = String(body.origin || "");
      if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(origin)) return new Response("bad origin", { status: 400 });
      await env.REG.put("origin", origin);
      cached = { origin, t: Date.now() };
      return new Response(JSON.stringify({ ok: true, origin }), { headers: { "content-type": "application/json" } });
    }
    if (Date.now() - cached.t > 20_000) cached = { origin: await env.REG.get("origin"), t: Date.now() };
    if (!cached.origin) return offline();
    const target = new URL(url.pathname + url.search, cached.origin);
    const headers = new Headers(req.headers);
    headers.set("x-forwarded-host", url.host);
    headers.set("x-forwarded-proto", "https");
    let r;
    try {
      r = await fetch(target, { method: req.method, headers, body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body, redirect: "manual" });
    } catch { return offline(); }
    // A dead tunnel answers 530/502 from Cloudflare's side: say so instead of showing an error page.
    if (r.status === 530 || r.status === 502 || r.status === 1033) return offline();
    const out = new Headers(r.headers);
    out.delete("content-security-policy-report-only");
    return new Response(r.body, { status: r.status, statusText: r.statusText, headers: out });
  },
};

const offline = () => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="20"><title>Blix</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1117;color:#e6e8ef;font:15px system-ui,sans-serif;text-align:center}h1{font-size:18px;margin:0 0 6px}p{color:#8b90a0;margin:0}</style>
<div><h1>Blix is offline</h1><p>The terminal runs on Kai's PC and it is not connected right now. This page retries every 20 seconds.</p></div>`,
  { status: 503, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "retry-after": "20" } });
