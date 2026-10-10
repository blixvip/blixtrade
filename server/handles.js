// Handles and invites, kept on this server (the accounts database) rather than in the Worker's D1: D1's free daily
// writes are shared with other projects and run out (2026-10-10: every claim failed with "Handles are unavailable").
//   GET  /api/account/handle          a member's own: { handle, link, joined, canChangeAt, suggestion, invites }
//   GET  /api/account/handle?check=h  whether h is free for this member: { handle, available, error? } (writes nothing)
//   POST /api/account/handle          { handle } claims or changes it (first come; one change a day)
//   GET  /api/edge/handle/<h>         the Worker only (edge key): who owns <h> and how many joined, for blixvip.com/@<h>
//   POST /api/edge/invite             the Worker only: { email, handle } a new sign-up came through <h>'s link
// invites.ref is the inviter's email (emails never change; handles can). The wallet service is told it with each
// trade (hosted-accounts.js): the inviter earns a share of the fee and the invited trader pays less.
// A handle someone moved off stays theirs for KEEP_OLD (handles_old): links already shared keep opening their page
// and keep crediting them, and nobody else can take the name and collect their invites. They can take it back.
const HANDLE = /^[a-z0-9_]{3,20}$/;
const DAY = 86400_000, KEEP_OLD = 30 * DAY;
// Every first path part the site or the terminal uses, plus names nobody should be able to pass themselves off as
// (the same list as worker/site/handles.js).
const RESERVED = new Set(`app api mcp demo start login logout waiting auth trade assets brand img fonts admin __admin
  robots sitemap llms favicon register blix blixvip bx official support help team staff mod mods moderator owner
  root system security billing pay payment payments wallet wallets vault account accounts settings profile profiles
  me you user users u ref refer invite join signup signin home index about terms privacy legal contact docs status
  pulse feed coins coin token tokens portfolio paper trade trades trading launch replay www mail email null
  undefined true false new edit delete search explore edge _pub`.split(/\s+/).filter(Boolean));
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const same = (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase();

export function validHandle(h) {
  const v = String(h || "").trim().replace(/^@/, "").toLowerCase();
  if (!HANDLE.test(v)) return { error: "Handles are 3 to 20 letters, numbers or underscores." };
  if (RESERVED.has(v) || /^_|_$/.test(v)) return { error: "That handle isn't available." };
  return { handle: v };
}

export function createHandles({ db, now = Date.now }) {
  db.exec(`CREATE TABLE IF NOT EXISTS handles (email TEXT PRIMARY KEY COLLATE NOCASE, handle TEXT NOT NULL UNIQUE, t INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS handles_old (handle TEXT PRIMARY KEY, email TEXT NOT NULL COLLATE NOCASE, t INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS invites (email TEXT PRIMARY KEY COLLATE NOCASE, ref TEXT NOT NULL COLLATE NOCASE, handle TEXT, t INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS invites_ref ON invites(ref);`);
  const fail = (status, message) => Object.assign(new Error(message), { status });
  const send = (res, status, data) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" }); res.end(JSON.stringify(data)); };
  const readBody = async (req) => {
    let body = "";
    for await (const chunk of req) { body += chunk; if (body.length > 4096) throw fail(413, "Request too large."); }
    try { const j = JSON.parse(body || "{}"); return j && typeof j === "object" ? j : {}; } catch { return {}; }
  };
  const mineRow = (email) => db.prepare("SELECT handle, t FROM handles WHERE email = ?").get(email);
  const ownerOf = (h) => db.prepare("SELECT email, handle, t FROM handles WHERE handle = ?").get(h);
  // A handle its owner moved off within KEEP_OLD: still theirs (their current handle comes with it).
  const oldOwnerOf = (h) => db.prepare("SELECT o.email, n.handle, n.t FROM handles_old o JOIN handles n ON n.email = o.email WHERE o.handle = ? AND o.t > ?").get(h, now() - KEEP_OLD);
  const joined = (email) => db.prepare("SELECT COUNT(*) n FROM invites WHERE ref = ?").get(email).n;
  // Who invited `email` (their email), or null: the wallet service is told it with each trade.
  const refOf = (email) => (email ? db.prepare("SELECT ref FROM invites WHERE email = ?").get(email)?.ref || null : null);
  const link = (h) => `https://blixvip.com/@${h}`;

  // Why `handle` cannot be this member's, or null when it is free (or already theirs).
  function blocked(handle, email) {
    const v = validHandle(handle);
    if (v.error) return v.error;
    const live = ownerOf(v.handle);
    if (live && !same(live.email, email)) return "That handle is taken.";
    const old = oldOwnerOf(v.handle);
    if (old && !same(old.email, email)) return "That handle is taken.";
    return null;
  }
  // The member's own name, cleaned into a free handle (adding a number when the plain one is taken), or null.
  function suggest(email) {
    const base = String(email).split("@")[0].toLowerCase().replace(/[^a-z0-9_]/g, "").replace(/^_+|_+$/g, "").slice(0, 17);
    if (base.length < 3) return null;
    for (const s of ["", ...Array.from({ length: 30 }, (_, i) => String(i + 2))]) if (!blocked(base + s, email)) return base + s;
    return null;
  }

  function mine(email) {
    const r = mineRow(email);
    // The newest people who signed up through this member's link: when, and a masked email (never the whole one).
    const recent = db.prepare("SELECT email, t FROM invites WHERE ref = ? ORDER BY t DESC LIMIT 8").all(email)
      .map((x) => ({ who: x.email.replace(/^(.)[^@]*?(.)?@.*$/, (_, a, b) => `${a}•••${b || ""}`), t: x.t }));
    return { handle: r?.handle || null, link: r ? link(r.handle) : null, joined: joined(email), canChangeAt: r ? r.t + DAY : 0,
      suggestion: r ? null : suggest(email), invited: Boolean(refOf(email)), recent };
  }

  // Claims `handle` for `email` in one transaction: the UNIQUE index is the last word when two people race for it.
  function take(email, handle, had) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const why = blocked(handle, email);
      if (why) throw fail(409, why);
      db.prepare("INSERT INTO handles (email, handle, t) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET handle = excluded.handle, t = excluded.t").run(email, handle, now());
      // The name they leave stays theirs for a while; the one they take is no longer anyone's old name.
      db.prepare("DELETE FROM handles_old WHERE handle = ?").run(handle);
      if (had?.handle) db.prepare("INSERT INTO handles_old (handle, email, t) VALUES (?, ?, ?) ON CONFLICT(handle) DO UPDATE SET email = excluded.email, t = excluded.t").run(had.handle, email, now());
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      if (/UNIQUE/i.test(String(e?.message))) throw fail(409, "That handle is taken.");
      throw e;
    }
  }

  // /api/account/handle for a signed-in member (req.walletMember, vouched for by the Worker). True when answered.
  async function member(req, res, url) {
    if (url.pathname !== "/api/account/handle") return false;
    const email = req.walletMember;
    try {
      if (!email) throw fail(401, "Sign in to claim a handle.");
      if (req.method === "GET" || req.method === "HEAD") {
        if (url.searchParams.has("check")) {
          const v = validHandle(url.searchParams.get("check")), why = blocked(url.searchParams.get("check"), email);
          send(res, 200, { handle: v.handle || null, available: !why, ...(why ? { error: why } : {}) }); return true;
        }
        send(res, 200, mine(email)); return true;
      }
      if (req.method !== "POST") throw fail(405, "Method not allowed.");
      const v = validHandle((await readBody(req)).handle);
      if (v.error) throw fail(400, v.error);
      const had = mineRow(email);
      if (had?.handle === v.handle) { send(res, 200, mine(email)); return true; }
      if (had && now() - had.t < DAY) throw fail(429, "You can change your handle once a day.");
      take(email, v.handle, had);
      send(res, 200, mine(email));
    } catch (e) { send(res, e.status || 503, { error: e.status ? e.message : "Handles are unavailable right now. Try again later." }); }
    return true;
  }

  // /api/edge/*: the Worker's own calls, made with the edge key (webapp.js checks it before this is reached).
  async function edge(req, res, url) {
    const p = url.pathname;
    try {
      const m = /^\/api\/edge\/handle\/([A-Za-z0-9_]{3,20})$/.exec(p);
      if (m && req.method === "GET") {
        const h = m[1].toLowerCase(), r = ownerOf(h) || oldOwnerOf(h);
        // moved: an old name; the page sends visitors on to the current one.
        send(res, 200, r ? { handle: r.handle, email: r.email, since: r.t, joined: joined(r.email), ...(r.handle !== h ? { moved: true } : {}) } : null); return true;
      }
      if (p === "/api/edge/invite" && req.method === "POST") {
        const b = await readBody(req), email = String(b.email || "").trim().toLowerCase(), v = validHandle(b.handle);
        if (!EMAIL.test(email) || email.length > 254 || v.error) throw fail(400, "email and handle, please.");
        const r = ownerOf(v.handle) || oldOwnerOf(v.handle);
        // Credited once, to the first link they came through; never to themselves.
        if (!r || same(r.email, email)) { send(res, 200, { credited: false }); return true; }
        const out = db.prepare("INSERT OR IGNORE INTO invites (email, ref, handle, t) VALUES (?, ?, ?, ?)").run(email, r.email, r.handle, now());
        send(res, 200, { credited: out.changes > 0, ref: refOf(email) }); return true;
      }
      throw fail(404, "Not found.");
    } catch (e) { send(res, e.status || 503, { error: e.status ? e.message : "Unavailable." }); }
    return true;
  }

  return { member, edge, refOf };
}
