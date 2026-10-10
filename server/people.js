// Who is who on Fomo: every profile picture Blix has seen for a handle, from wherever it came (a feed post, the
// leaderboard, a profile read, the traders list), so a post that arrives without one (Fomo leaves it out of some
// event types) still shows the person. Kept in the database; a handle's newest picture wins.
import { db } from "./db.js";

db.exec(`CREATE TABLE IF NOT EXISTS people_pics (handle TEXT PRIMARY KEY COLLATE NOCASE, pic TEXT NOT NULL, t INTEGER NOT NULL)`);
const put = db.prepare("INSERT INTO people_pics (handle, pic, t) VALUES (?, ?, ?) ON CONFLICT(handle) DO UPDATE SET pic = excluded.pic, t = excluded.t WHERE excluded.pic != people_pics.pic");
const get = db.prepare("SELECT pic FROM people_pics WHERE handle = ?");
// The other places a picture may already be on record, newest first.
const elsewhere = [
  db.prepare("SELECT pic FROM fomo_board WHERE handle = ? COLLATE NOCASE AND pic IS NOT NULL AND pic != '' ORDER BY day DESC LIMIT 1"),
  db.prepare("SELECT json_extract(data, '$.pic') AS pic FROM fomo_profiles WHERE handle = ? COLLATE NOCASE AND json_extract(data, '$.pic') IS NOT NULL LIMIT 1"),
  db.prepare("SELECT avatar AS pic FROM fomo_traders WHERE handle = ? COLLATE NOCASE AND avatar IS NOT NULL AND avatar != '' LIMIT 1"),
];
const cache = new Map();   // handle (lower) -> pic | null, the last looked up
const MAX = 5000;

// A picture just seen for a handle: remembered for the posts that come without one.
export function notePic(handle, pic) {
  if (!handle || !pic || typeof pic !== "string") return;
  const k = handle.toLowerCase();
  if (cache.get(k) === pic) return;
  cache.set(k, pic);
  try { put.run(handle, pic, Date.now()); } catch {}
  if (cache.size > MAX) cache.delete(cache.keys().next().value);
}

// The picture on record for a handle, or null.
export function knownPic(handle) {
  if (!handle) return null;
  const k = handle.toLowerCase();
  if (cache.has(k)) return cache.get(k);
  let pic = null;
  try {
    pic = get.get(handle)?.pic || null;
    for (const q of elsewhere) { if (pic) break; pic = q.get(handle)?.pic || null; }
  } catch { pic = null; }
  cache.set(k, pic);
  if (cache.size > MAX) cache.delete(cache.keys().next().value);
  return pic;
}

// A person as a post shows them: the picture they came with, else the one on record.
export function withPic(u) {
  if (!u || !u.handle) return u;
  if (u.pic) { notePic(u.handle, u.pic); return u; }
  const pic = knownPic(u.handle);
  return pic ? { ...u, pic } : u;
}
