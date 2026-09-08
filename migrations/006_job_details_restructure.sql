-- One-time migration: restructures Job Details into "Insurer Details" and
-- "Claim Details" — adds insurer branch/appointing-office breakdown,
-- insured state/pincode, multi-contact support, and deputation mode.
-- Legacy columns (appointing_office, contact_person, contact_phone) are
-- kept, not dropped, for backward compatibility — nothing reads/writes
-- them going forward.
-- Apply once: wrangler d1 execute TMS_DB --remote --file=migrations/006_job_details_restructure.sql
-- Safe to skip if already applied — a duplicate-column error means it already ran.

ALTER TABLE jobs ADD COLUMN insurer_branch             TEXT DEFAULT '';
ALTER TABLE jobs ADD COLUMN appointing_office_address  TEXT DEFAULT '';
ALTER TABLE jobs ADD COLUMN appointing_office_district TEXT DEFAULT '';
ALTER TABLE jobs ADD COLUMN appointing_office_state    TEXT DEFAULT '';
ALTER TABLE jobs ADD COLUMN appointing_person_email    TEXT DEFAULT '';
ALTER TABLE jobs ADD COLUMN appointing_person_phone    TEXT DEFAULT '';
ALTER TABLE jobs ADD COLUMN insured_state               TEXT DEFAULT '';
ALTER TABLE jobs ADD COLUMN insured_pincode             TEXT DEFAULT '';
ALTER TABLE jobs ADD COLUMN contacts                    TEXT NOT NULL DEFAULT '[]';
ALTER TABLE jobs ADD COLUMN deputation_mode             TEXT DEFAULT '';
