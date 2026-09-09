-- TMS V1.0 — one-time migration: FSR Final Verification, Submission,
-- Hard Copy Dispatch, POD, and Queries (child table).
-- Reuses fsr_preparation_status/date/remarks from V0.9 as-is — not
-- duplicated here.
-- Apply once: wrangler d1 execute TMS_DB --remote --file=migrations/010_fsr_submission_dispatch.sql
-- Safe to skip if already applied — a duplicate-column/table error means it already ran.

ALTER TABLE jobs ADD COLUMN fsr_final_verification_status  TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE jobs ADD COLUMN fsr_final_verification_date    TEXT DEFAULT '';
ALTER TABLE jobs ADD COLUMN fsr_final_verified_by          TEXT DEFAULT '';
ALTER TABLE jobs ADD COLUMN fsr_final_verification_remarks TEXT DEFAULT '';

ALTER TABLE jobs ADD COLUMN fsr_submitted           TEXT DEFAULT '';
ALTER TABLE jobs ADD COLUMN fsr_submission_date     TEXT DEFAULT '';
ALTER TABLE jobs ADD COLUMN fsr_submission_mode     TEXT DEFAULT '';
ALTER TABLE jobs ADD COLUMN fsr_submission_remarks  TEXT DEFAULT '';
ALTER TABLE jobs ADD COLUMN mail_sent_date          TEXT DEFAULT '';

ALTER TABLE jobs ADD COLUMN hard_copy_required   TEXT NOT NULL DEFAULT 'to_be_decided';
ALTER TABLE jobs ADD COLUMN hard_copy_sent       TEXT DEFAULT '';
ALTER TABLE jobs ADD COLUMN hard_copy_sent_date  TEXT DEFAULT '';
ALTER TABLE jobs ADD COLUMN courier_company      TEXT DEFAULT '';
ALTER TABLE jobs ADD COLUMN awb_tracking_no      TEXT DEFAULT '';
ALTER TABLE jobs ADD COLUMN dispatch_remarks     TEXT DEFAULT '';

ALTER TABLE jobs ADD COLUMN pod_status  TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE jobs ADD COLUMN pod_date    TEXT DEFAULT '';
ALTER TABLE jobs ADD COLUMN pod_remarks TEXT DEFAULT '';

CREATE TABLE IF NOT EXISTS claim_queries (
  id               TEXT    PRIMARY KEY,
  job_id           TEXT    NOT NULL,
  query_date       TEXT    NOT NULL,
  query_from       TEXT    DEFAULT '',
  query_type       TEXT    NOT NULL,
  query_details    TEXT    NOT NULL DEFAULT '',
  status           TEXT    NOT NULL DEFAULT 'open',
  response_date    TEXT    DEFAULT '',
  response_details TEXT    DEFAULT '',
  created_by       TEXT    DEFAULT '',
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);
CREATE INDEX IF NOT EXISTS idx_claim_queries_job ON claim_queries (job_id);
