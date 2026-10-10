// Where the radar may fetch from. quality.js publicUrl() looks at the name alone (no localhost, no literal
// address, no .local). A name can still point at this machine or the network it is on (127.0.0.1.nip.io, a DNS
// record the launcher controls, a cloud metadata address), so before a fetch the name is resolved and every
// address it gives is checked. Shared by the radar (images.js) and the page server (pagepics.js); no database.
import dns from "node:dns";
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { publicUrl } from "./quality.js";

const CACHE_MS = 60_000, CACHE_MAX = 5000;
const known = new Map();   // host -> { ok, t }

// A unicast address on the public internet? Loopback, link-local, private ranges, carrier NAT, multicast,
// "this network", the mapped/NAT64 forms of those, and anything unparseable are not.
export function publicAddress(ip) {
  const s = String(ip || "").toLowerCase();
  if (!isIP(s)) return false;
  const v4 = (a) => {
    const p = a.split(".").map(Number);
    if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
    const [a0, a1] = p;
    if (a0 === 0 || a0 === 10 || a0 === 127 || a0 >= 224) return false;
    if (a0 === 169 && a1 === 254) return false;
    if (a0 === 172 && a1 >= 16 && a1 <= 31) return false;
    if (a0 === 192 && a1 === 168) return false;
    if (a0 === 100 && a1 >= 64 && a1 <= 127) return false;
    if (a0 === 198 && (a1 === 18 || a1 === 19)) return false;
    return true;
  };
  if (!s.includes(":")) return v4(s);
  const mapped = s.match(/^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return v4(mapped[1]);
  if (s === "::" || s === "::1") return false;
  if (/^f[cd]/.test(s) || /^fe[89ab]/.test(s) || /^ff/.test(s)) return false;
  if (/^(::ffff:|64:ff9b:|2001:db8:|::)/.test(s)) return false;
  return /^[0-9a-f:]+$/.test(s);
}

// Resolve once, then connect to that exact public address while keeping the original TLS hostname.
// Never follows redirects; callers must validate every hop. Bounds DNS, connection, and body time together.
export async function fetchPublic(input, { maxBytes = 3_000_000, timeout = 7000, headers = {}, httpsOnly = false } = {}) {
  const safe = publicUrl(input);
  if (!safe || (httpsOnly && !safe.startsWith('https:'))) throw Error('Unsafe destination');
  const url = new URL(safe);
  if (!['http:', 'https:'].includes(url.protocol)) throw Error('Unsafe destination');
  let timer, outgoing, timedOut = false;
  const expired = new Promise((_, reject) => { timer = setTimeout(() => { timedOut = true; outgoing?.destroy(); reject(Error('Image request timed out')); }, timeout); });
  try {
    return await Promise.race([expired, (async () => {
      const addresses = await dns.promises.lookup(url.hostname, { all: true, verbatim: true });
      if (timedOut) throw Error('Image request timed out');
      if (!addresses.length || !addresses.every(a => publicAddress(a.address))) throw Error('Unsafe destination');
      const address = addresses[0];
      return await new Promise((resolve, reject) => {
        outgoing = (url.protocol === 'https:' ? https : http).request(url, {
          agent: false, headers: { ...headers, 'accept-encoding': 'identity' },
          lookup(_host, options, callback) { callback(null, options.all ? [address] : address.address, address.family); },
        }, res => {
          const rejectBody = message => { res.destroy(); reject(Error(message)); };
          if (Number(res.headers['content-length']) > maxBytes) return rejectBody('Image too large');
          const chunks = []; let bytes = 0;
          res.on('error', reject);
          res.on('aborted', () => reject(Error('Image response interrupted')));
          res.on('data', chunk => {
            bytes += chunk.length;
            if (bytes > maxBytes) return rejectBody('Image too large');
            chunks.push(chunk);
          });
          res.on('end', () => {
            if (bytes > maxBytes) return;
            const status = res.statusCode || 502;
            const responseHeaders = new Headers();
            for (const [key, value] of Object.entries(res.headers)) if (value !== undefined) responseHeaders.set(key, Array.isArray(value) ? value.join(', ') : value);
            resolve(new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks, bytes), { status, headers: responseHeaders }));
          });
        });
        outgoing.on('error', reject); outgoing.end();
      });
    })()]);
  } finally { clearTimeout(timer); }
}

async function hostIsPublic(host) {
  const hit = known.get(host);
  if (hit && Date.now() - hit.t < CACHE_MS) return hit.ok;
  let ok = false;
  try {
    const list = await dns.promises.lookup(host, { all: true, verbatim: true });
    ok = list.length > 0 && list.every((a) => publicAddress(a.address));
  } catch { ok = false; }
  if (known.size >= CACHE_MAX) known.clear();
  known.set(host, { ok, t: Date.now() });
  return ok;
}

// The address to fetch, or null: a public name (publicUrl) that resolves only to public addresses. With
// { https: true }, https only.
export async function safeToFetch(u, { https = false } = {}) {
  const s = publicUrl(u);
  if (!s) return null;
  const url = new URL(s);
  if (https && url.protocol !== "https:") return null;
  if (!publicAddress(url.hostname) && /^[\d.]+$|:/.test(url.hostname)) return null;
  return (await hostIsPublic(url.hostname)) ? s : null;
}
