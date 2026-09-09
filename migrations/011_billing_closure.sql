-- TMS V1.1 — one-time migration: Billing & Closure.
-- Total Fee Received / Outstanding / Excess / Payment Status / Closure
-- Eligibility are all calculated (see computeBilling() in worker.js), never
-- stored as columns. closure_date/closed_by/closure_remarks are only ever
-- written by the dedicated POST /api/jobs/:id/close endpoint, never the
-- generic job PATCH.
--
-- NOTE: an earlier version of this migration tried 8 `ALTER TABLE jobs ADD
-- COLUMN` statements. That failed in production with "too many columns on
-- sqlite_altertab_jobs: SQLITE_ERROR" — the `jobs` table was already at 97
-- columns, and D1/SQLite enforces a hard per-table column limit (~100).
-- Verified the failed attempt rolled back cleanly with zero side effects
-- before writing this corrected version. Fix: a new 1:1 sidecar table,
-- `job_billing` (job_id PRIMARY KEY, FK to jobs.id), instead of more jobs
-- columns. This is now the standing pattern for future job-level fields —
-- see HANDOFF_NOTES.md.
--
-- Apply once: wrangler d1 execute TMS_DB --remote --file=migrations/011_billing_closure.sql
-- Safe to skip if already applied — a duplicate-table error means it already ran.

CREATE TABLE IF NOT EXISTS job_billing (
  job_id          TEXT    PRIMARY KEY,
  bill_required   TEXT    NOT NULL DEFAULT 'to_be_decided',
  bill_date       TEXT    DEFAULT '',
  bill_number     TEXT    DEFAULT '',
  bill_amount     TEXT    DEFAULT '',
  billing_remarks TEXT    DEFAULT '',
  closure_date    TEXT    DEFAULT '',
  closed_by       TEXT    DEFAULT '',
  closure_remarks TEXT    DEFAULT '',
  updated_at      INTEGER NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

CREATE TABLE IF NOT EXISTS fee_receipts (
  id            TEXT    PRIMARY KEY,
  job_id        TEXT    NOT NULL,
  receipt_date  TEXT    NOT NULL,
  amount        TEXT    NOT NULL,
  receipt_mode  TEXT    DEFAULT '',
  reference_no  TEXT    DEFAULT '',
  remarks       TEXT    DEFAULT '',
  created_by    TEXT    DEFAULT '',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);
CREATE INDEX IF NOT EXISTS idx_fee_receipts_job ON fee_receipts (job_id);
