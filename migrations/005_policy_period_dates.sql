-- One-time migration: splits the free-text Policy Period field into two
-- proper date fields (from / expiry). The old `policy_period` text column
-- is left in place (not dropped) for backward compatibility — nothing
-- reads or writes it going forward.
-- Apply once: wrangler d1 execute TMS_DB --remote --file=migrations/005_policy_period_dates.sql
-- Safe to skip if already applied — a duplicate-column error means it already ran.

ALTER TABLE jobs ADD COLUMN policy_period_from TEXT DEFAULT '';
ALTER TABLE jobs ADD COLUMN policy_period_to   TEXT DEFAULT '';
