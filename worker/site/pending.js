// Sign-ups held while D1 is out of reach. D1's free daily row reads are shared by every database on the
// Cloudflare account; when another project used them up (2026-10-06, -07, -09) D1 refused every query until
// midnight UTC, and anyone who signed in with Google meanwhile got a session but no account row: they were never
// on the dashboard. Now the callback keeps them in KV (`held:<email>`, the profile in the key's metadata so a
// list reads them all at once) and they move into `accounts` when D1 answers again: every 10 minutes (index.js
// scheduled) and whenever that person comes back (memberOf, recover()).
// Someone whose sign-in was lost before this existed still has a valid 30-day session cookie: on their next visit
// recover() writes them an account from what is known (email, the visit's place), marked `session:` in google_sub
// until their next Google sign-in fills in the rest.
const PFX = "held:";
const clip = (v, n) => (v == null ? null : String(v).slice(0, n));

// KV's free tier allows 1,000 lists a day: the dashboard's 3-second poll reads a copy kept per isolate.
let kept = { t: 0, rows: [] };
const KEEP_MS = 120_000;

export async function holdSignup(env, g, info, t = Date.now()) {
  try {
    const key = PFX + g.email, had = (await env.REG.getWithMetadata(key)).metadata;
    const row = {
      email: g.email, sub: clip(g.sub, 64), name: clip(g.name ?? had?.name, 120), picture: clip(g.picture ?? had?.picture, 300),
      t: had?.t || t, last: t, logins: (had?.logins || 0) + 1,
      country: clip(info?.country ?? had?.country, 2), city: clip(info?.city ?? had?.city, 60), referrer: clip(had?.referrer ?? info?.referrer, 120),
      visitor: clip(info?.visitor ?? had?.visitor, 16),
    };
    // Metadata is capped at 1,024 bytes: the picture goes first if a long name pushes it over.
    if (JSON.stringify(row).length > 1000) row.picture = null;
    await env.REG.put(key, "1", { metadata: row });
    kept.t = 0;
    return true;
  } catch { return false; }
}

export async function heldSignups(env, fresh = false) {
  if (!fresh && Date.now() - kept.t < KEEP_MS) return kept.rows;
  const rows = [];
  try {
    let cursor;
    do {
      const page = await env.REG.list({ prefix: PFX, cursor });
      for (const k of page.keys) if (k.metadata?.email) rows.push(k.metadata);
      cursor = page.list_complete ? null : page.cursor;
    } while (cursor && rows.length < 2000);
  } catch { return kept.rows; }
  rows.sort((a, b) => b.t - a.t);
  kept = { t: Date.now(), rows };
  return rows;
}

// Into accounts: a new row, or merged into one that exists (a `session:` stand-in takes the real Google id; the
// earliest sign-up time and the first known place win; logins add up). A sign-up event is written for a new one,
// dated when it happened, so the dashboard's daily counts include it.
async function upsert(env, h, detail = "held while D1 was down") {
  const existed = await env.DB.prepare("SELECT 1 FROM accounts WHERE email = ?").bind(h.email).first();
  await env.DB.prepare(`INSERT INTO accounts (email, google_sub, name, picture, created, last_seen, logins, country, city, referrer, ua, visitor, status)
      VALUES (?,?,?,?,?,?,?,?,?,?,NULL,?,'member')
      ON CONFLICT(email) DO UPDATE SET
        google_sub = CASE WHEN accounts.google_sub LIKE 'session:%' THEN excluded.google_sub ELSE accounts.google_sub END,
        name = COALESCE(excluded.name, accounts.name), picture = COALESCE(excluded.picture, accounts.picture),
        created = MIN(accounts.created, excluded.created), last_seen = MAX(accounts.last_seen, excluded.last_seen),
        logins = accounts.logins + excluded.logins,
        country = COALESCE(accounts.country, excluded.country), city = COALESCE(accounts.city, excluded.city),
        referrer = COALESCE(accounts.referrer, excluded.referrer), visitor = COALESCE(accounts.visitor, excluded.visitor)`)
    .bind(...[h.email, h.sub || `session:${h.email}`, h.name, h.picture, h.t, h.last || h.t, h.logins ?? 1, h.country, h.city, h.referrer, h.visitor].map((v) => v ?? null)).run();
  if (!existed) {
    await env.DB.prepare("INSERT INTO events (t, kind, path, email, visitor, country, city, referrer, device, detail) VALUES (?,'signup','/auth/google/callback',?,?,?,?,?,NULL,?)")
      .bind(...[h.t, h.email, h.visitor, h.country, h.city, h.referrer, detail].map((v) => v ?? null)).run();
  }
}

// Every held sign-up into D1; stops at the first D1 failure (still down) and leaves the rest held.
export async function drainHeld(env) {
  const rows = await heldSignups(env, true);
  let moved = 0;
  for (const h of rows) {
    try { await upsert(env, h); } catch (e) {
      // A Google id already on another email (should not happen): keep the person under a stand-in id instead.
      if (/UNIQUE/i.test(String(e?.message)) && h.sub) { try { await upsert(env, { ...h, sub: null }); } catch { break; } }
      else break;
    }
    await env.REG.delete(PFX + h.email).catch(() => {});
    moved++;
  }
  if (moved) kept.t = 0;
  return moved;
}

// A valid session with no account row (memberOf): the held sign-up if there is one, else a stand-in account.
// Returns true when the row now exists.
export async function recover(env, email, info) {
  try {
    const h = (await env.REG.getWithMetadata(PFX + email)).metadata;
    if (h?.email) { await upsert(env, h); await env.REG.delete(PFX + email).catch(() => {}); kept.t = 0; return true; }
    const t = Date.now();
    await upsert(env, { email, sub: null, name: null, picture: null, t, last: t, logins: 0, country: clip(info?.country, 2), city: clip(info?.city, 60), referrer: null, visitor: null }, "recovered: signed in while D1 was down");
    return true;
  } catch { return false; }
}
