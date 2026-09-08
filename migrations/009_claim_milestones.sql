-- TMS V0.9 — one-time migration: Complete Claim Milestones.
-- Adds structured post-survey lifecycle tracking: ILA, LOR, Reminders
-- (child table), Document Receipts (child table), Assessment, Director
-- Verification, conditional Insurer Approval, Insured Consent, and FSR
-- Preparation readiness. jobs.estimated_loss/gross_loss/claim_amount are
-- reused as-is, not duplicated.
-- Apply once: wrangler d1 execute TMS_DB --remote --file=migrations/009_claim_milestones.sql
-- Safe to skip if already applied — a duplicate-column/table error means it already ran.

ALTER TABLE jobs ADD COLUMN ila_required          TEXT NOT NULL DEFAULT 'to_be_decided';
ALTER TABLE jobs ADD COLUMN ila_issued            TEXT DEFAULT '';
ALTER TABLE jobs ADD COLUMN ila_issue_date        TEXT DEFAULT '';
ALTER TABLE jobs ADD COLUMN ila_remarks           TEXT DEFAULT '';

ALTER TABLE jobs ADD COLUMN lor_required          TEXT NOT NULL DEFAULT 'to_be_decided';
ALTER TABLE jobs ADD COLUMN lor_issued            TEXT DEFAULT '';
ALTER TABLE jobs ADD COLUMN lor_issue_date        TEXT DEFAULT '';
ALTER TABLE jobs ADD COLUMN lor_remarks           TEXT DEFAULT '';

ALTER TABLE jobs ADD COLUMN reminder_frequency             TEXT DEFAULT 'none';
ALTER TABLE jobs ADD COLUMN reminder_frequency_custom_days TEXT DEFAULT '';

ALTER TABLE jobs ADD COLUMN assessment_status        TEXT NOT NULL DEFAULT 'not_started';
ALTER TABLE jobs ADD COLUMN assessment_prepared_date TEXT DEFAULT '';
ALTER TABLE jobs ADD COLUMN assessed_amount          TEXT DEFAULT '';
ALTER TABLE jobs ADD COLUMN assessment_remarks       TEXT DEFAULT '';

ALTER TABLE jobs ADD COLUMN director_verification_status   TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE jobs ADD COLUMN director_verification_date     TEXT DEFAULT '';
ALTER TABLE jobs ADD COLUMN director_verified_by           TEXT DEFAULT '';
ALTER TABLE jobs ADD COLUMN director_verification_remarks  TEXT DEFAULT '';

ALTER TABLE jobs ADD COLUMN insurer_approval_required TEXT NOT NULL DEFAULT 'to_be_decided';
ALTER TABLE jobs ADD COLUMN insurer_approval_status   TEXT DEFAULT '';
ALTER TABLE jobs ADD COLUMN insurer_approval_date     TEXT DEFAULT '';
ALTER TABLE jobs ADD COLUMN insurer_approved_amount   TEXT DEFAULT '';
ALTER TABLE jobs ADD COLUMN insurer_approval_remarks  TEXT DEFAULT '';

ALTER TABLE jobs ADD COLUMN insured_consent_status  TEXT NOT NULL DEFAULT 'not_started';
ALTER TABLE jobs ADD COLUMN insured_consent_date    TEXT DEFAULT '';
ALTER TABLE jobs ADD COLUMN insured_agreed_amount   TEXT DEFAULT '';
ALTER TABLE jobs ADD COLUMN insured_consent_remarks TEXT DEFAULT '';

ALTER TABLE jobs ADD COLUMN fsr_preparation_status  TEXT NOT NULL DEFAULT 'not_started';
ALTER TABLE jobs ADD COLUMN fsr_preparation_date    TEXT DEFAULT '';
ALTER TABLE jobs ADD COLUMN fsr_preparation_remarks TEXT DEFAULT '';

CREATE TABLE IF NOT EXISTS claim_reminders (
  id            TEXT    PRIMARY KEY,
  job_id        TEXT    NOT NULL,
  reminder_date TEXT    NOT NULL,
  reminder_type TEXT    NOT NULL,
  mode          TEXT    DEFAULT '',
  remarks       TEXT    DEFAULT '',
  created_by    TEXT    DEFAULT '',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);
CREATE INDEX IF NOT EXISTS idx_claim_reminders_job ON claim_reminders (job_id);

CREATE TABLE IF NOT EXISTS document_receipt_events (
  id                 TEXT    PRIMARY KEY,
  job_id             TEXT    NOT NULL,
  receipt_date       TEXT    NOT NULL,
  receipt_mode       TEXT    DEFAULT '',
  documents_received TEXT    NOT NULL DEFAULT '[]',
  remarks            TEXT    DEFAULT '',
  created_by         TEXT    DEFAULT '',
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);
CREATE INDEX IF NOT EXISTS idx_document_receipt_events_job ON document_receipt_events (job_id);
