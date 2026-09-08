-- One-time migration: adds login (staff passwords + sessions), a separate
-- access_role for admin permissions, and insurer acronyms.
-- Apply once: wrangler d1 execute TMS_DB --remote --file=migrations/002_auth_and_acronyms.sql
-- Safe to skip if already applied — a duplicate-column error means it already ran.

ALTER TABLE staff ADD COLUMN access_role TEXT NOT NULL DEFAULT 'staff';
ALTER TABLE staff ADD COLUMN password_hash TEXT;
ALTER TABLE insurers ADD COLUMN acronym TEXT DEFAULT '';

-- rajanaren is the permanent super admin.
UPDATE staff SET access_role = 'admin' WHERE id = 'rajan';

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  staff_id   TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
