// GET /api/vault/people (loopback, the wallet vault's service token): who each Blix member is, for the owner's
// wallet dashboard (blix-vault public/app.js). One record per email:
//   from the Worker's sign-up records (D1, read through /__edge/members every 5 min, kept on disk for when it is
//   down): Google name and photo, joined, last seen, sign-ins, country and city, where they came from, device;
//   from this server: their handle (handles.js), who invited them and whom they invited, their paper desk and
//   hosted wallet (adminmembers.js membersReport).
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DATA } from "./db.js";
import { settings } from "./settings.js";
import { membersReport } from "./adminmembers.js";

const CACHE = path.join(DATA, "vault-people.json");
const EVERY = 5 * 60_000;
let d1 = (() => { try { return JSON.parse(fs.readFileSync(CACHE, "utf8")); } catch { return { t: 0, accounts: [] }; } })();
let reading = null;

async function readD1() {
  const key = settings.edgeKey;
  if (!key) return;
  const r = await fetch("https://blixvip.com/__edge/members", { headers: { "x-blix-edge": key, accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`members ${r.status}`);
  const j = await r.json();
  if (!Array.isArray(j.accounts)) throw new Error("members: no list");
  d1 = { t: Date.now(), accounts: j.accounts };
  try { fs.writeFileSync(CACHE, JSON.stringify(d1)); } catch {}
}
function fresh() {
  if (!reading && Date.now() - d1.t > EVERY) reading = readD1().catch((e) => { d1.error = e.message; }).finally(() => { reading = null; });
  return d1.t ? null : reading;   // the very first read is waited for; later ones run behind the answer
}

let adb = null;
const accountsDb = () => { if (!adb) try { adb = new DatabaseSync(path.join(DATA, "accounts.db"), { readOnly: true }); } catch { adb = null; } return adb; };
const all = (sql) => { try { return accountsDb()?.prepare(sql).all() || []; } catch { return []; } };

// "Windows · Chrome", "iPhone · Safari" from a user agent.
function device(ua) {
  if (!ua) return null;
  const os = /iPhone|iPad/.test(ua) ? (/iPad/.test(ua) ? "iPad" : "iPhone") : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : null;
  const br = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Brave/.test(ua) ? "Brave" : /Firefox\//.test(ua) ? "Firefox" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : null;
  return [os, br].filter(Boolean).join(" · ") || null;
}
// Where someone came from before signing up; the sign-in hop itself (Google, our own pages) says nothing.
const host = (u) => { let h; try { h = new URL(u).hostname.replace(/^www\./, ""); } catch { h = u || null; } return h && !/(^|\.)(google\.com|blixvip\.com|trycloudflare\.com)$/.test(h) ? h : null; };

export async function vaultPeople() {
  const wait = fresh();
  if (wait) await wait;
  let report = null;
  try { report = await membersReport(); } catch {}
  const people = {};
  const get = (email) => (people[String(email).toLowerCase()] ||= { email: String(email).toLowerCase() });
  for (const a of d1.accounts || []) {
    const p = get(a.email);
    Object.assign(p, { name: a.name || null, picture: a.picture || null, joined: a.created || null, lastSeen: a.last_seen || null, logins: a.logins ?? null,
      country: a.country || null, city: a.city || null, cameFrom: host(a.referrer), device: device(a.ua), access: a.status || null, handle: a.handle || null, refEmail: a.ref || null });
  }
  // Handles and invites live here since 2026-10-10 (handles.js): they win over the Worker's older columns.
  for (const r of all("SELECT email, handle FROM handles")) get(r.email).handle = r.handle;
  const handleOf = (email) => people[String(email || "").toLowerCase()]?.handle || null;
  for (const r of all("SELECT email, ref, t FROM invites")) { const p = get(r.email); p.refEmail = String(r.ref).toLowerCase(); p.invitedAt = r.t; }
  for (const p of Object.values(people)) if (p.refEmail) {
    p.invitedBy = { email: p.refEmail, handle: handleOf(p.refEmail) };
    (get(p.refEmail).invited ||= []).push({ email: p.email, handle: p.handle || null, at: p.invitedAt || p.joined || null });
  }
  for (const p of Object.values(people)) delete p.refEmail;
  for (const [email, m] of Object.entries(report?.members || {})) {
    const p = get(email);
    if (m.paper) p.paper = m.paper;
    if (m.username && !p.handle) p.handle = m.username;
    if (m.display && !p.name) p.name = m.display;
  }
  return { now: Date.now(), read: d1.t || null, error: d1.t ? null : d1.error || null, people };
}
