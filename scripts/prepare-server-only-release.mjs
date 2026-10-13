// Patch only routing in the downloaded production bundle; preserve concurrent SEO releases.
import fs from 'node:fs';
import path from 'node:path';
const dir = path.resolve('data/server-only');
const type = fs.readFileSync(path.join(dir, 'live-worker-type.txt'), 'utf8');
const form = await new Response(fs.readFileSync(path.join(dir, 'live-worker.multipart')), { headers: { 'content-type': type } }).formData();
for (const [name, value] of form) fs.writeFileSync(path.join(dir, path.basename(name)), typeof value === 'string' ? value : Buffer.from(await value.arrayBuffer()));
let s = fs.readFileSync(path.join(dir, 'index.js'), 'utf8');
function replace(a, b) {
  const next = s.replace(a, b);
  if (next === s) throw Error(`Production bundle changed: ${a}`);
  s = next;
}
replace(/var cached = \{ origin: null, t: 0 \};[\s\S]*?var PC_PATH = [^\n]+;/, 'var SERVER_ORIGIN = "https://origin.blixvip.com";\nvar cached = { origin: SERVER_ORIGIN };');
replace(/      if \(!\/\^https:[\s\S]*?      return new Response\(JSON.stringify\(\{ ok: true, origin \}\)/,
  '      if (body.role === "pc") return json2(200, { ok: true, ignored: "server-only" });\n      if (origin !== SERVER_ORIGIN) return new Response("server origin required", { status: 400 });\n      return new Response(JSON.stringify({ ok: true, origin })');
replace(/    const reread = [^\n]+\n    \[cached, cachedPc\] = [^\n]+\n/, '');
replace('Blix is offline: the PC that runs it is not connected right now.', "Blix's server is temporarily unavailable. Please retry shortly.");
replace(/    const viaPc = [^\n]+\n    if \(!cached.origin && !viaPc\) return down\(\);\n    const target = [^\n]+;/,
  '    if (!cached.origin) return down();\n    const target = new URL(url.pathname + url.search, cached.origin);');
replace(' && !viaPc ? edgeKey2', ' ? edgeKey2');
replace(/    if \(viaPc && cached.origin[\s\S]*?\n    if \(!r\) return offline\(\);/, '    if (!r) return offline();');
replace('if (!r) return offline();', 'if (!r) return down();');
replace('if (r.status === 530 || r.status === 502 || r.status === 1033) return offline();', 'if (r.status === 530 || r.status === 502 || r.status === 503 || r.status === 1033) return down();');
replace("<h1>Blix is offline</h1><p>The terminal runs on Kai's PC and it is not connected right now.", '<h1>Blix is reconnecting</h1><p>The server is temporarily unavailable.');
if (/cachedPc|viaPc|PC_PATH/.test(s)) throw Error('PC routing remains');
fs.writeFileSync(path.join(dir, 'index.js'), s);
console.log('Production bundle patched; original preserved in live-worker.multipart.');
