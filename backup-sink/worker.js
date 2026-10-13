// Off-box home for the VM's nightly backup (bin/offsite-backup.mjs): a tiny Worker in front of the R2 bucket
// "blix-backups". The archives are already encrypted on the VM; this only stores, lists, serves and deletes them.
// Every call needs the header x-sink-key equal to the SINK_KEY secret (also in /etc/blix-sink.key on the VM).
// Uploads go in parts (a Worker request body is capped at 100 MB on the free plan), all the same size but the last.
//   POST   /mp/create?key=K                    -> { uploadId }
//   PUT    /mp/part?key=K&uploadId=U&part=N     body = bytes -> { part, etag }
//   POST   /mp/complete?key=K&uploadId=U        body = [{ part, etag }] -> { key, size }
//   POST   /mp/abort?key=K&uploadId=U
//   GET    /list                               -> [{ key, size, uploaded }]
//   GET    /obj?key=K                          -> the archive (for a restore)
//   DELETE /obj?key=K
//   POST   /alert                              body = { subject, text } -> emails the owner (the ALERT binding is
//                                              locked to one verified Email Routing address; see wrangler.jsonc)
import { EmailMessage } from "cloudflare:email";
const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
const okKey = (k) => typeof k === "string" && /^blix-[\w.-]{1,80}\.enc$/.test(k);

// Constant-time compare, so the key can't be guessed a byte at a time.
function same(a, b) {
  const x = new TextEncoder().encode(a || ""), y = new TextEncoder().encode(b || "");
  if (x.length !== y.length || !x.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

export default {
  async fetch(req, env) {
    if (!env.SINK_KEY || !same(req.headers.get("x-sink-key"), env.SINK_KEY)) return json({ error: "no" }, 403);
    const u = new URL(req.url), key = u.searchParams.get("key"), id = u.searchParams.get("uploadId");
    const B = env.BACKUPS;
    try {
      if (u.pathname === "/alert" && req.method === "POST") {
        const b = await req.json();
        const subject = String(b.subject || "Blix alert").replace(/[\r\n]+/g, " ").slice(0, 150);
        const text = String(b.text || "").slice(0, 20000);
        const from = "alerts@blixvip.com", to = env.ALERT_TO;
        const raw = [`From: Blix alerts <${from}>`, `To: ${to}`, `Subject: =?utf-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(subject)))}?=`,
          `Date: ${new Date().toUTCString()}`, `Message-ID: <${crypto.randomUUID()}@blixvip.com>`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=utf-8",
          "Content-Transfer-Encoding: 8bit", "", text].join("\r\n");
        await env.ALERT.send(new EmailMessage(from, to, raw));
        return json({ ok: true });
      }
      if (u.pathname === "/list" && req.method === "GET") {
        const out = [];
        let cursor;
        do { const r = await B.list({ cursor, limit: 1000 }); for (const o of r.objects) out.push({ key: o.key, size: o.size, uploaded: o.uploaded }); cursor = r.truncated ? r.cursor : undefined; } while (cursor);
        return json(out);
      }
      if (!okKey(key)) return json({ error: "bad key name" }, 400);
      if (u.pathname === "/mp/create" && req.method === "POST") return json({ uploadId: (await B.createMultipartUpload(key)).uploadId });
      if (u.pathname === "/mp/part" && req.method === "PUT") {
        const part = Number(u.searchParams.get("part"));
        if (!id || !Number.isInteger(part) || part < 1 || part > 10000) return json({ error: "bad part" }, 400);
        const r = await B.resumeMultipartUpload(key, id).uploadPart(part, req.body);
        return json({ part: r.partNumber, etag: r.etag });
      }
      if (u.pathname === "/mp/complete" && req.method === "POST") {
        const parts = await req.json();
        const o = await B.resumeMultipartUpload(key, id).complete(parts.map((p) => ({ partNumber: p.part, etag: p.etag })));
        return json({ key: o.key, size: o.size });
      }
      if (u.pathname === "/mp/abort" && req.method === "POST") { await B.resumeMultipartUpload(key, id).abort(); return json({ ok: true }); }
      if (u.pathname === "/obj" && req.method === "GET") {
        const o = await B.get(key);
        return o ? new Response(o.body, { headers: { "content-type": "application/octet-stream", "content-length": String(o.size) } }) : json({ error: "not found" }, 404);
      }
      if (u.pathname === "/obj" && req.method === "DELETE") { await B.delete(key); return json({ ok: true }); }
      return json({ error: "not found" }, 404);
    } catch (e) {
      return json({ error: String(e?.message || e).slice(0, 300) }, 500);
    }
  },
};
