-- Sign-in is Google only now (no passwords). No accounts existed yet, so the table is simply rebuilt.
DROP TABLE accounts;
CREATE TABLE accounts (
  email TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,  -- Google's id for the person
  name TEXT, picture TEXT,
  created INTEGER NOT NULL,         -- ms
  last_seen INTEGER NOT NULL,       -- ms, any signed-in page view
  logins INTEGER NOT NULL DEFAULT 0,
  country TEXT, city TEXT, referrer TEXT, ua TEXT,
  visitor TEXT,                     -- the visitor id they had before signing up (ties earlier visits to them)
  status TEXT NOT NULL DEFAULT 'waiting'
);
