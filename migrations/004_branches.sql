-- One-time migration: adds TFAM Branches and the 4-category assignment
-- fields (Director Responsible, Surveyor Signing, Branch Handling,
-- Backstaff/Surveyor Responsible) replacing the old single "Assign To".
-- The legacy `assigned` column is kept as-is for backward compatibility.
-- Apply once: wrangler d1 execute TMS_DB --remote --file=migrations/004_branches.sql
-- Safe to skip if already applied — a duplicate-column error means it already ran.

ALTER TABLE jobs ADD COLUMN director_ids  TEXT NOT NULL DEFAULT '[]';
ALTER TABLE jobs ADD COLUMN surveyor_ids  TEXT NOT NULL DEFAULT '[]';
ALTER TABLE jobs ADD COLUMN branch_ids    TEXT NOT NULL DEFAULT '[]';
ALTER TABLE jobs ADD COLUMN backstaff_ids TEXT NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS branches (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  color      TEXT NOT NULL DEFAULT '#6B7AFF',
  created_at INTEGER NOT NULL
);
