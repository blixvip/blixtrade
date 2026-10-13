// Deploy only the reviewed routing patch, retaining the live Worker's modules,
// assets, bindings, secrets and settings. Refuse if another release intervened.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const dir = path.resolve('data/server-only');
const config = fs.readFileSync(path.join(process.env.USERPROFILE, '.wrangler/config/default.toml'), 'utf8');
const token = config.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
if (!token) throw Error('Cloudflare login missing');
const base = 'https://api.cloudflare.com/client/v4/accounts/1dad3c7d60b166f3642c8cb3b6bbc62a/workers/scripts/blix-trade';
async function api(suffix, options = {}) {
  const r = await fetch(base + suffix, { ...options, headers: { authorization: `Bearer ${token}`, ...options.headers } });
  if (!r.ok) throw Error(`Cloudflare ${suffix || 'script'}: ${r.status}`);
  return r;
}
const original = await new Response(fs.readFileSync(path.join(dir, 'live-worker.multipart')), { headers: { 'content-type': fs.readFileSync(path.join(dir, 'live-worker-type.txt'), 'utf8') } }).formData();
const current = await (await api('')).formData();
const previous = fs.existsSync(path.join(dir, 'deployment.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'deployment.json'), 'utf8')) : null;
const digest = async v => createHash('sha256').update(typeof v === 'string' ? v : Buffer.from(await v.arrayBuffer())).digest('hex');
for (const [name, value] of original) {
  const expected = name === 'index.js' && previous ? previous.sha256 : await digest(value);
  if (!current.has(name) || expected !== await digest(current.get(name))) throw Error(`Production changed: ${name}. Download and review again.`);
}
if ([...original.keys()].length !== [...current.keys()].length) throw Error('Production module count changed');
const settings = (await (await api('/settings')).json()).result;
const metadata = { main_module: 'index.js', keep_assets: true, keep_bindings: [...new Set(settings.bindings.map(b => b.type))] };
for (const key of ['compatibility_date', 'compatibility_flags', 'logpush', 'observability', 'tail_consumers', 'limits', 'placement']) if (settings[key] != null) metadata[key] = settings[key];
const upload = new FormData();
upload.set('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
for (const [name, value] of original) {
  const body = name === 'index.js' ? fs.readFileSync(path.join(dir, 'index.js')) : value;
  upload.set(name, new Blob([body], { type: name.endsWith('.js') ? 'application/javascript+module' : 'text/plain' }), name);
}
const response = await (await api('', { method: 'PUT', body: upload })).json();
if (!response.success) throw Error('Worker upload rejected');
const deployed = await (await api('')).formData();
if (await digest(deployed.get('index.js')) !== await digest(fs.readFileSync(path.join(dir, 'index.js'), 'utf8'))) throw Error('Deployed code mismatch');
const after = (await (await api('/settings')).json()).result;
const names = s => s.bindings.map(b => `${b.type}:${b.name}`).sort();
if (JSON.stringify(names(settings)) !== JSON.stringify(names(after))) throw Error('Binding set changed');
const report = { at: new Date().toISOString(), version: response.result?.deployment_id, sha256: await digest(deployed.get('index.js')), bindingsPreserved: true, assetsPreserved: true };
fs.writeFileSync(path.join(dir, 'deployment.json'), JSON.stringify(report, null, 2));
console.log(report);
