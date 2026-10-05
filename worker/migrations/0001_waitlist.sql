-- Waitlist accounts and site activity for trade.blixvip.com (site/waitlist.js, site/track.js).
CREATE TABLE accounts (
  email TEXT PRIMARY KEY,
  salt TEXT NOT NULL,
  hash TEXT NOT NULL,
  created INTEGER NOT NULL,         -- ms
  last_seen INTEGER NOT NULL,       -- ms, any signed-in page view
  logins INTEGER NOT NULL DEFAULT 0,
  country TEXT, city TEXT, referrer TEXT, ua TEXT,
  visitor TEXT,                     -- the visitor id they had before signing up (ties earlier visits to them)
  status TEXT NOT NULL DEFAULT 'waiting'
);
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  t INTEGER NOT NULL,               -- ms
  kind TEXT NOT NULL,               -- view, signup, login, login_fail, signup_fail, logout
  path TEXT, email TEXT, visitor TEXT,
  country TEXT, city TEXT, referrer TEXT, device TEXT, detail TEXT
);
CREATE INDEX events_t ON events(t);
CREATE INDEX events_kind_t ON events(kind, t);
CREATE INDEX events_visitor ON events(visitor);
