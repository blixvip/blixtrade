-- The live admin dashboard (/__admin/live, site/waitlist.js) asks every few seconds which accounts changed since
-- its last look: by these, that reads only the rows that changed, never the whole table.
CREATE INDEX IF NOT EXISTS accounts_last_seen ON accounts(last_seen);
CREATE INDEX IF NOT EXISTS accounts_created ON accounts(created);
