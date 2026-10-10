-- Handles: blixvip.com/<handle> is a member's public page and invite link (site/handles.js). Kept lower-case.
-- ref: the email of the member whose link a new account signed up through (emails never change; handles can).
-- Apply with `wrangler d1 execute blix-waitlist --remote --file migrations/0004_handles.sql` (never `migrations apply`: 0002 drops accounts).
ALTER TABLE accounts ADD COLUMN handle TEXT;
ALTER TABLE accounts ADD COLUMN handle_t INTEGER;   -- ms, when the handle was last set (one change a day)
ALTER TABLE accounts ADD COLUMN ref TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS accounts_handle ON accounts(handle);
CREATE INDEX IF NOT EXISTS accounts_ref ON accounts(ref);
