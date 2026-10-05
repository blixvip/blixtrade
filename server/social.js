// Profiles and following, for Blix accounts (server/accounts.js). Each account gets a public page at
// #/u/<username>: banner, picture, name, bio, what the wallet holds and what it traded. People follow other
// Blix accounts, Fomo traders (by handle) and plain wallets. Pictures are stored in data/profiles and served
// from /api/account/media/<file>. Same database as the accounts (accounts.db), same local-only rule.
//
// Called from accounts.js route() before any body is read: return true when the request was answered here.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

let db = null, MEDIA = "";
export function initSocial(adb, dataDir) {
  db = adb;
  MEDIA = path.join(dataDir, "profiles");
  fs.mkdirSync(MEDIA, { recursive: true });
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (account_id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, display TEXT, bio TEXT,
      avatar TEXT, banner TEXT, show_holdings INTEGER NOT NULL DEFAULT 1, updated INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS follows (account_id INTEGER NOT NULL, kind TEXT NOT NULL, target TEXT NOT NULL, t INTEGER NOT NULL, PRIMARY KEY (account_id, kind, target));
    CREATE INDEX IF NOT EXISTS follows_target ON follows (kind, target);
  `);
}

const USERNAME = /^[a-z0-9_]{3,20}$/i, MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, HANDLE = /^[A-Za-z0-9_.-]{1,40}$/;
const RESERVED = new Set(["admin", "blix", "me", "settings", "account", "api", "support", "official"]);
const IMG = { avatar: 2.2e6, banner: 5.5e6 };   // bytes, after base64 decoding
const TYPES = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

// Every account has a profile: made on first use with a username from the email (kai.gu@… → kaigu).
function profileOf(acc) {
  let p = db.prepare("SELECT * FROM profiles WHERE account_id = ?").get(acc.id);
  if (p) return p;
  const base = (String(acc.email || "").split("@")[0].replace(/[^a-z0-9_]/gi, "").toLowerCase() || "trader").slice(0, 16).padEnd(3, "0");
  let name = RESERVED.has(base) ? `${base}1` : base;
  for (let i = 2; db.prepare("SELECT 1 FROM profiles WHERE username = ?").get(name); i++) name = `${base.slice(0, 16)}${i}`;
  db.prepare("INSERT INTO profiles (account_id, username, display, updated) VALUES (?, ?, ?, ?)").run(acc.id, name, acc.name || name, Date.now());
  return db.prepare("SELECT * FROM profiles WHERE account_id = ?").get(acc.id);
}

const media = (f) => (f ? `/api/account/media/${f}` : null);
const counts = (id) => ({
  followers: db.prepare("SELECT COUNT(*) n FROM follows WHERE kind = 'user' AND target = ?").get(String(id)).n,
  follows: db.prepare("SELECT COUNT(*) n FROM follows WHERE account_id = ?").get(id).n,   // how many they follow
});
const isFollowing = (me, kind, target) => Boolean(me && db.prepare("SELECT 1 FROM follows WHERE account_id = ? AND kind = ? AND target = ?").get(me.id, kind, String(target)));

// What everyone may see. Never the email.
function card(acc, me) {
  const p = profileOf(acc);
  return { id: acc.id, username: p.username, display: p.display || p.username, bio: p.bio || "", avatar: media(p.avatar) || acc.picture || null, banner: media(p.banner),
    address: acc.address || null, showHoldings: Boolean(p.show_holdings), joined: acc.created, ...counts(acc.id), following: isFollowing(me, "user", acc.id), isMe: me?.id === acc.id };
}

// A picture from the page (data URL) into data/profiles; the old one is removed.
function saveImage(acc, kind, dataUrl, old) {
  const m = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
  if (!m) throw Object.assign(new Error("Pictures must be PNG, JPG, GIF or WebP."), { status: 400 });
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length > IMG[kind]) throw Object.assign(new Error(`The ${kind} is over ${Math.round(IMG[kind] / 1e6)} MB.`), { status: 400 });
  const file = `${acc.id}-${kind}-${crypto.randomBytes(6).toString("hex")}.${m[1] === "jpeg" ? "jpg" : m[1]}`;
  fs.writeFileSync(path.join(MEDIA, file), bytes);
  if (old) fs.rm(path.join(MEDIA, path.basename(old)), () => {});
  return file;
}

export async function socialRoute(req, res, url, { me, send, fail, readBody, vault }) {
  const p = url.pathname, m = req.method;

  if (p.startsWith("/api/account/media/") && m === "GET") {
    const file = path.basename(decodeURIComponent(p.slice(19)));
    const ext = /\.(png|jpg|gif|webp)$/.exec(file)?.[1];
    const full = path.join(MEDIA, file);
    if (!ext || !fs.existsSync(full)) throw fail(404, "No such picture.");
    res.writeHead(200, { "content-type": TYPES[ext], "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" });
    fs.createReadStream(full).pipe(res);
    return true;
  }

  // Everyone on Blix, most followed first; ?q= searches names and usernames.
  if (p === "/api/account/people" && m === "GET") {
    const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
    for (const a of db.prepare("SELECT * FROM accounts").all()) profileOf(a);
    const rows = db.prepare(`SELECT a.*, p.username, p.display, (SELECT COUNT(*) FROM follows f WHERE f.kind = 'user' AND f.target = CAST(a.id AS TEXT)) followers
      FROM accounts a JOIN profiles p ON p.account_id = a.id ORDER BY followers DESC, a.created ASC LIMIT 200`).all();
    const people = rows.filter((r) => !q || `${r.username} ${r.display}`.toLowerCase().includes(q)).map((r) => card(r, me));
    return send(res, 200, { people }), true;
  }

  // One person's page: the profile, then (unless they hid it) what their wallet holds and what it traded.
  const u = /^\/api\/account\/u\/([^/]+)(\/follows)?$/.exec(p);
  if (u && m === "GET") {
    const prof = db.prepare("SELECT * FROM profiles WHERE username = ?").get(decodeURIComponent(u[1]));
    const acc = prof && db.prepare("SELECT * FROM accounts WHERE id = ?").get(prof.account_id);
    if (!acc) throw fail(404, "There is no Blix account with that username.");
    if (u[2]) {
      const dir = url.searchParams.get("dir") === "followers" ? "followers" : "following";
      if (dir === "followers") {
        const list = db.prepare("SELECT a.* FROM follows f JOIN accounts a ON a.id = f.account_id WHERE f.kind = 'user' AND f.target = ? ORDER BY f.t DESC").all(String(acc.id));
        return send(res, 200, { list: list.map((a) => ({ kind: "user", ...card(a, me) })) }), true;
      }
      const list = db.prepare("SELECT kind, target, t FROM follows WHERE account_id = ? ORDER BY t DESC").all(acc.id).map((f) => {
        if (f.kind !== "user") return { kind: f.kind, target: f.target, t: f.t, following: isFollowing(me, f.kind, f.target) };
        const a = db.prepare("SELECT * FROM accounts WHERE id = ?").get(Number(f.target));
        return a ? { kind: "user", ...card(a, me) } : null;
      }).filter(Boolean);
      return send(res, 200, { list }), true;
    }
    const out = card(acc, me);
    let holdings = null, activity = [], problem = null;
    if (out.showHoldings || out.isMe) {
      try { holdings = await vault(`/users/${acc.vault_id}/wallet`); } catch (e) { problem = e.message; }
      try {
        const txs = await vault(`/users/${acc.vault_id}/txs`);
        // Trades only: deposits and withdrawals name outside addresses, which stay private.
        activity = (Array.isArray(txs) ? txs : txs?.txs || []).filter((t) => ["buy", "sell", "launch"].includes(t.kind) && t.status !== "failed")
          .slice(0, 40).map((t) => ({ t: t.t, kind: t.kind, mint: t.mint, sol: t.sol, sig: t.sig, status: t.status }));
      } catch {}
    }
    return send(res, 200, { profile: out, holdings, activity, problem }), true;
  }

  // Following, by anyone viewing: is this kind/target followed by me?
  if (p === "/api/account/follow" && m === "GET") {
    return send(res, 200, { following: isFollowing(me, String(url.searchParams.get("kind")), String(url.searchParams.get("target") || "")), signedIn: Boolean(me) }), true;
  }

  if (!p.startsWith("/api/account/profile") && p !== "/api/account/follow") return false;
  if (!me) throw fail(401, "Sign in first.");

  if (p === "/api/account/profile" && m === "GET") return send(res, 200, card(me, me)), true;

  // Edit my profile. avatar/banner: a data URL replaces the picture, "" removes it, absent leaves it.
  if (p === "/api/account/profile" && m === "POST") {
    const b = await readBody(req, 1e7), cur = profileOf(me);
    const username = b.username == null ? cur.username : String(b.username).trim().replace(/^@/, "");
    if (!USERNAME.test(username)) throw fail(400, "Usernames are 3 to 20 letters, numbers or underscores.");
    if (RESERVED.has(username.toLowerCase()) && username.toLowerCase() !== cur.username.toLowerCase()) throw fail(400, "That username is taken.");
    const clash = db.prepare("SELECT account_id FROM profiles WHERE username = ?").get(username);
    if (clash && clash.account_id !== me.id) throw fail(409, "That username is taken.");
    const display = b.display == null ? cur.display : String(b.display).trim().slice(0, 40) || username;
    const bio = b.bio == null ? cur.bio : String(b.bio).replace(/\r/g, "").trim().slice(0, 280);
    let { avatar, banner } = cur;
    if (b.avatar === "") { if (avatar) fs.rm(path.join(MEDIA, avatar), () => {}); avatar = null; } else if (b.avatar) avatar = saveImage(me, "avatar", b.avatar, avatar);
    if (b.banner === "") { if (banner) fs.rm(path.join(MEDIA, banner), () => {}); banner = null; } else if (b.banner) banner = saveImage(me, "banner", b.banner, banner);
    const show = b.showHoldings == null ? cur.show_holdings : b.showHoldings ? 1 : 0;
    db.prepare("UPDATE profiles SET username = ?, display = ?, bio = ?, avatar = ?, banner = ?, show_holdings = ?, updated = ? WHERE account_id = ?")
      .run(username, display, bio, avatar, banner, show, Date.now(), me.id);
    return send(res, 200, card(me, me)), true;
  }

  // Follow or unfollow: { kind: "user" | "trader" | "wallet", target, on }.
  if (p === "/api/account/follow" && m === "POST") {
    const b = await readBody(req), kind = String(b.kind), target = String(b.target || "").trim().replace(/^@/, "");
    if (kind === "user") {
      if (!db.prepare("SELECT 1 FROM accounts WHERE id = ?").get(Number(target))) throw fail(404, "No such Blix account.");
      if (Number(target) === me.id) throw fail(400, "You cannot follow yourself.");
    } else if (kind === "trader") { if (!HANDLE.test(target)) throw fail(400, "That is not a Fomo handle."); }
    else if (kind === "wallet") { if (!MINT.test(target)) throw fail(400, "That is not a Solana address."); }
    else throw fail(400, "Follow a user, a trader or a wallet.");
    if (b.on === false) db.prepare("DELETE FROM follows WHERE account_id = ? AND kind = ? AND target = ?").run(me.id, kind, target);
    else db.prepare("INSERT OR IGNORE INTO follows (account_id, kind, target, t) VALUES (?, ?, ?, ?)").run(me.id, kind, target, Date.now());
    return send(res, 200, { following: b.on !== false, ...(kind === "user" ? counts(Number(target)) : {}) }), true;
  }
  throw fail(404, "Not found.");
}
