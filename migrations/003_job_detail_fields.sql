-- One-time migration: adds extra claim-detail fields to jobs.
-- Apply once: wrangler d1 execute TMS_DB --remote --file=migrations/003_job_detail_fields.sql
-- Safe to skip if already applied — a duplicate-column error means it already ran.

ALTER TABLE jobs ADD COLUMN policy_name       TEXT DEFAULT '';
ALTER TABLE jobs ADD COLUMN policy_period     TEXT DEFAULT '';
ALTER TABLE jobs ADD COLUMN estimated_loss    TEXT DEFAULT '';
ALTER TABLE jobs ADD COLUMN gross_loss        TEXT DEFAULT '';
ALTER TABLE jobs ADD COLUMN department        TEXT DEFAULT '';
ALTER TABLE jobs ADD COLUMN appointing_office TEXT DEFAULT '';
ALTER TABLE jobs ADD COLUMN appointing_person TEXT DEFAULT '';
ALTER TABLE jobs ADD COLUMN contact_person    TEXT DEFAULT '';
ALTER TABLE jobs ADD COLUMN contact_phone     TEXT DEFAULT '';
ALTER TABLE jobs ADD COLUMN address           TEXT DEFAULT '';
ALTER TABLE jobs ADD COLUMN district          TEXT DEFAULT '';
