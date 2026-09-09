-- TFAM Management System · Cloudflare D1 Schema
-- Run once: wrangler d1 execute TMS_DB --file=schema.sql

-- ── Job counter (auto-increment for TF-XXX IDs) ──────────────
CREATE TABLE IF NOT EXISTS counter (
  id      TEXT PRIMARY KEY DEFAULT 'main',
  next_val INTEGER NOT NULL DEFAULT 1
);
INSERT OR IGNORE INTO counter (id, next_val) VALUES ('main', 1);

-- ── Jobs ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS jobs (
  id                   TEXT    PRIMARY KEY,  -- e.g. "TF-001"
  title                TEXT    NOT NULL,     -- short description
  -- ── Insurer Details ──
  insurer              TEXT    DEFAULT '',
  insurer_branch       TEXT    DEFAULT '',
  appointing_office_address  TEXT DEFAULT '',
  appointing_office_district TEXT DEFAULT '',
  appointing_office_state    TEXT DEFAULT '',
  appointing_person    TEXT    DEFAULT '',
  appointing_person_email TEXT DEFAULT '',
  appointing_person_phone TEXT DEFAULT '',
  appointing_office    TEXT    DEFAULT '',   -- legacy combined field, superseded by appointing_office_*
  -- ── Claim Details ──
  insured              TEXT    DEFAULT '',
  address              TEXT    DEFAULT '',
  district             TEXT    DEFAULT '',
  insured_state        TEXT    DEFAULT '',
  insured_pincode      TEXT    DEFAULT '',
  contacts             TEXT    NOT NULL DEFAULT '[]',   -- JSON array of {name,designation,phone,email}
  contact_person       TEXT    DEFAULT '',   -- legacy single contact, superseded by `contacts`
  contact_phone        TEXT    DEFAULT '',   -- legacy single contact, superseded by `contacts`
  deputation_mode      TEXT    DEFAULT '',   -- 'Email' or 'Call'
  date_loss            TEXT    DEFAULT '',
  date_intimation      TEXT    DEFAULT '',   -- doubles as "Deputation Date"
  claim_no             TEXT    DEFAULT '',
  policy_no            TEXT    DEFAULT '',
  policy_name          TEXT    DEFAULT '',
  policy_period_from   TEXT    DEFAULT '',   -- date, e.g. "2025-04-01"
  policy_period_to     TEXT    DEFAULT '',   -- date, e.g. "2026-03-31"
  peril                TEXT    DEFAULT '',
  item_type            TEXT    DEFAULT '',   -- Type of Item/Property Involved
  estimated_loss       TEXT    DEFAULT '',
  claim_amount         TEXT    DEFAULT '',
  gross_loss           TEXT    DEFAULT '',
  department           TEXT    DEFAULT '',
  -- ── Survey scheduling ──
  survey_date          TEXT    DEFAULT '',   -- legacy single date, kept for backward compat; survey_visits is now authoritative
  survey_status        TEXT    NOT NULL DEFAULT 'not_surveyed',  -- 'not_surveyed' | 'in_progress' | 'completed'
  appointment_date     TEXT    DEFAULT '',
  appointment_confirmed INTEGER DEFAULT 0,
  stage                TEXT    NOT NULL DEFAULT 'new_claim',
  assigned             TEXT    NOT NULL DEFAULT '[]',   -- legacy JSON array of staff IDs
  director_ids         TEXT    NOT NULL DEFAULT '[]',   -- JSON array of staff IDs (Director Responsible)
  surveyor_ids         TEXT    NOT NULL DEFAULT '[]',   -- JSON array of staff IDs (Surveyor Signing)
  branch_ids           TEXT    NOT NULL DEFAULT '[]',   -- JSON array of branch IDs (TFAM Branch Handling)
  backstaff_ids        TEXT    NOT NULL DEFAULT '[]',   -- JSON array of staff IDs (Backstaff/Surveyor Responsible)
  notes                TEXT    DEFAULT '',
  docs                 TEXT    NOT NULL DEFAULT '{}',   -- JSON object of doc flags
  activity             TEXT    NOT NULL DEFAULT '[]',   -- JSON array of {text,ts,actor}
  -- ── Claim Milestones (V0.9) ──
  ila_required         TEXT    NOT NULL DEFAULT 'to_be_decided',  -- 'yes'|'no'|'to_be_decided'
  ila_issued           TEXT    DEFAULT '',                        -- ''|'yes'|'no'
  ila_issue_date       TEXT    DEFAULT '',
  ila_remarks          TEXT    DEFAULT '',
  lor_required         TEXT    NOT NULL DEFAULT 'to_be_decided',
  lor_issued           TEXT    DEFAULT '',
  lor_issue_date       TEXT    DEFAULT '',
  lor_remarks          TEXT    DEFAULT '',
  reminder_frequency          TEXT DEFAULT 'none',  -- 'none'|'daily'|'every_3_days'|'weekly'|'fortnightly'|'monthly'|'custom'
  reminder_frequency_custom_days TEXT DEFAULT '',
  assessment_status    TEXT    NOT NULL DEFAULT 'not_started',  -- 'not_started'|'in_preparation'|'prepared'|'revision_required'
  assessment_prepared_date TEXT DEFAULT '',
  assessed_amount      TEXT    DEFAULT '',   -- Assessed Loss Amount (new; estimated_loss/gross_loss/claim_amount already existed and are reused)
  assessment_remarks   TEXT    DEFAULT '',
  director_verification_status TEXT NOT NULL DEFAULT 'pending',  -- 'pending'|'approved'|'returned_for_revision'
  director_verification_date   TEXT DEFAULT '',
  director_verified_by TEXT    DEFAULT '',   -- staff id, must have a Director role
  director_verification_remarks TEXT DEFAULT '',
  insurer_approval_required TEXT NOT NULL DEFAULT 'to_be_decided',  -- 'yes'|'no'|'to_be_decided'
  insurer_approval_status   TEXT DEFAULT '',  -- 'pending'|'approved'|'partially_approved'|'query'|'rejected'
  insurer_approval_date     TEXT DEFAULT '',
  insurer_approved_amount   TEXT DEFAULT '',
  insurer_approval_remarks  TEXT DEFAULT '',
  insured_consent_status TEXT NOT NULL DEFAULT 'not_started',  -- 'not_started'|'pending'|'accepted'|'disputed'|'revised_consent_awaited'|'declined'
  insured_consent_date   TEXT DEFAULT '',
  insured_agreed_amount  TEXT DEFAULT '',
  insured_consent_remarks TEXT DEFAULT '',
  fsr_preparation_status TEXT NOT NULL DEFAULT 'not_started',  -- 'not_started'|'in_preparation'|'ready'
  fsr_preparation_date   TEXT DEFAULT '',
  fsr_preparation_remarks TEXT DEFAULT '',
  -- ── FSR Final Verification / Submission / Dispatch (V1.0) ──
  fsr_final_verification_status   TEXT NOT NULL DEFAULT 'pending',  -- 'pending'|'approved'|'returned_for_revision'
  fsr_final_verification_date     TEXT DEFAULT '',
  fsr_final_verified_by           TEXT DEFAULT '',   -- staff id, must have a Director role
  fsr_final_verification_remarks  TEXT DEFAULT '',
  fsr_submitted            TEXT DEFAULT '',   -- ''|'yes'|'no'
  fsr_submission_date      TEXT DEFAULT '',
  fsr_submission_mode      TEXT DEFAULT '',   -- 'Email'|'Portal'|'Hard Copy'|'Other'
  fsr_submission_remarks   TEXT DEFAULT '',
  mail_sent_date           TEXT DEFAULT '',
  hard_copy_required       TEXT NOT NULL DEFAULT 'to_be_decided',  -- 'yes'|'no'|'to_be_decided'
  hard_copy_sent           TEXT DEFAULT '',   -- ''|'yes'|'no'
  hard_copy_sent_date      TEXT DEFAULT '',
  courier_company          TEXT DEFAULT '',
  awb_tracking_no          TEXT DEFAULT '',
  dispatch_remarks         TEXT DEFAULT '',
  pod_status               TEXT NOT NULL DEFAULT 'pending',  -- 'pending'|'delivered'|'returned'|'not_applicable'
  pod_date                 TEXT DEFAULT '',
  pod_remarks              TEXT DEFAULT '',
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
);

-- ── Indexes ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_jobs_stage      ON jobs (stage);
CREATE INDEX IF NOT EXISTS idx_jobs_updated_at ON jobs (updated_at DESC);

-- ── Staff ────────────────────────────────────────────────────
-- "role" is the free-text job title (Director, Employee Surveyor, ...).
-- "access_role" is separate: 'staff' or 'admin', used for login permissions.
CREATE TABLE IF NOT EXISTS staff (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  role          TEXT DEFAULT '',
  access_role   TEXT NOT NULL DEFAULT 'staff',
  initials      TEXT NOT NULL,
  color         TEXT NOT NULL DEFAULT '#6B7AFF',
  password_hash TEXT,
  created_at    INTEGER NOT NULL
);

INSERT OR IGNORE INTO staff (id, name, role, access_role, initials, color, created_at) VALUES
  ('rajan',    'Raja Naren R',        'Director',          'admin', 'RN', '#1B2E5A', 0),
  ('thiravia', 'Raja Thiravia Kumar', 'Director',          'staff', 'RT', '#1A4FA0', 0),
  ('surv1',    'Employee Surveyor 1', 'Employee Surveyor', 'staff', 'S1', '#1A7A4A', 0),
  ('surv2',    'Employee Surveyor 2', 'Employee Surveyor', 'staff', 'S2', '#7C3AED', 0),
  ('train1',   'Trainee Surveyor 1',  'Trainee Surveyor',  'staff', 'T1', '#0284C7', 0),
  ('train2',   'Trainee Surveyor 2',  'Trainee Surveyor',  'staff', 'T2', '#D97706', 0),
  ('back1',    'Backend Staff 1',     'Backend Staff',     'staff', 'B1', '#BE185D', 0),
  ('back2',    'Backend Staff 2',     'Backend Staff',     'staff', 'B2', '#059669', 0),
  ('back3',    'Backend Staff 3',     'Backend Staff',     'staff', 'B3', '#B45309', 0),
  ('back4',    'Backend Staff 4',     'Backend Staff',     'staff', 'B4', '#6B7AFF', 0);

-- ── Insurers ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS insurers (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  acronym    TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);

-- ── TFAM Branches ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS branches (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  color      TEXT NOT NULL DEFAULT '#6B7AFF',
  created_at INTEGER NOT NULL
);

-- ── Sessions (login tokens) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  staff_id   TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- ── Survey Visits ────────────────────────────────────────────
-- One job -> many survey visits (initial survey, reinspection, dismantling
-- inspection, ...). Authoritative visit history; jobs.survey_date/
-- survey_status remain for backward-compat/summary display only.
CREATE TABLE IF NOT EXISTS survey_visits (
  id               TEXT    PRIMARY KEY,
  job_id           TEXT    NOT NULL,
  visit_date       TEXT    NOT NULL,
  visit_time       TEXT    DEFAULT '',
  reason           TEXT    NOT NULL,
  inspected_by_ids TEXT    NOT NULL DEFAULT '[]',  -- JSON array of staff IDs
  remarks          TEXT    DEFAULT '',
  created_by       TEXT    DEFAULT '',
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);
CREATE INDEX IF NOT EXISTS idx_survey_visits_job ON survey_visits (job_id);

-- ── Settings (admin-controlled, global key/value) ─────────────
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO settings (key, value) VALUES ('inspection_staff_visibility', 'visible');

-- ── Claim Reminders (V0.9) ─────────────────────────────────────
-- One job -> many reminder events, unlimited.
CREATE TABLE IF NOT EXISTS claim_reminders (
  id            TEXT    PRIMARY KEY,
  job_id        TEXT    NOT NULL,
  reminder_date TEXT    NOT NULL,
  reminder_type TEXT    NOT NULL,   -- preset reason or custom "Other" text
  mode          TEXT    DEFAULT '',   -- 'Email'|'Call'|'WhatsApp'|'Letter'|'Other'
  remarks       TEXT    DEFAULT '',
  created_by    TEXT    DEFAULT '',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);
CREATE INDEX IF NOT EXISTS idx_claim_reminders_job ON claim_reminders (job_id);

-- ── Document Receipt Events (V0.9) ──────────────────────────────
-- One job -> many receipt batches, unlimited. Not the final document-
-- compliance checklist (that's a later version) — just a received-batch log.
CREATE TABLE IF NOT EXISTS document_receipt_events (
  id                 TEXT    PRIMARY KEY,
  job_id             TEXT    NOT NULL,
  receipt_date       TEXT    NOT NULL,
  receipt_mode       TEXT    DEFAULT '',   -- 'Email'|'Courier'|'WhatsApp'|'Hand'|'Portal'|'Other'
  documents_received TEXT    NOT NULL DEFAULT '[]',  -- JSON array of document name strings
  remarks            TEXT    DEFAULT '',
  created_by         TEXT    DEFAULT '',
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);
CREATE INDEX IF NOT EXISTS idx_document_receipt_events_job ON document_receipt_events (job_id);

-- ── Claim Queries (V1.0) ─────────────────────────────────────
-- One job -> many queries, unlimited. Status: 'open'|'replied'|'closed'.
CREATE TABLE IF NOT EXISTS claim_queries (
  id               TEXT    PRIMARY KEY,
  job_id           TEXT    NOT NULL,
  query_date       TEXT    NOT NULL,
  query_from       TEXT    DEFAULT '',   -- 'Insurer'|'Insured'|'Broker'|'Internal'|'Other'
  query_type       TEXT    NOT NULL,     -- preset type or custom "Other" text
  query_details    TEXT    NOT NULL DEFAULT '',
  status           TEXT    NOT NULL DEFAULT 'open',  -- 'open'|'replied'|'closed'
  response_date    TEXT    DEFAULT '',
  response_details TEXT    DEFAULT '',
  created_by       TEXT    DEFAULT '',
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);
CREATE INDEX IF NOT EXISTS idx_claim_queries_job ON claim_queries (job_id);

-- ── Job Billing (V1.1) ───────────────────────────────────────
-- 1:1 sidecar table, NOT more columns on jobs — jobs was already at 97
-- columns and D1/SQLite enforces a ~100-column-per-table limit (confirmed
-- via a failed ALTER TABLE during V1.1 development: "too many columns on
-- sqlite_altertab_jobs"). Any future version needing more single-value
-- job-level fields should add a new sidecar table like this one rather
-- than more ALTER TABLE jobs ADD COLUMN — see HANDOFF_NOTES.md.
-- Total received/outstanding/excess/payment status/closure eligibility are
-- all CALCULATED from bill_amount + fee_receipts, never stored — see
-- computeBilling() in worker.js and index.html.
CREATE TABLE IF NOT EXISTS job_billing (
  job_id          TEXT    PRIMARY KEY,
  bill_required   TEXT    NOT NULL DEFAULT 'to_be_decided',  -- 'yes'|'no'|'to_be_decided'
  bill_date       TEXT    DEFAULT '',
  bill_number     TEXT    DEFAULT '',
  bill_amount     TEXT    DEFAULT '',   -- rupees, e.g. "50000" or "50000.50"
  billing_remarks TEXT    DEFAULT '',
  closure_date    TEXT    DEFAULT '',   -- only ever set via POST /api/jobs/:id/close
  closed_by       TEXT    DEFAULT '',   -- staff id, derived server-side from the authenticated user
  closure_remarks TEXT    DEFAULT '',
  updated_at      INTEGER NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

-- ── Fee Receipts (V1.1) ──────────────────────────────────────
-- One job -> many fee receipts, unlimited. Total received/outstanding/
-- excess/payment status are always calculated from these + job_billing.bill_amount,
-- never stored.
CREATE TABLE IF NOT EXISTS fee_receipts (
  id            TEXT    PRIMARY KEY,
  job_id        TEXT    NOT NULL,
  receipt_date  TEXT    NOT NULL,
  amount        TEXT    NOT NULL,   -- rupees, e.g. "20000" or "20000.50"
  receipt_mode  TEXT    DEFAULT '',   -- 'NEFT / RTGS'|'UPI'|'Cheque'|'Cash'|'Bank Transfer'|'Adjustment'|'Other'
  reference_no  TEXT    DEFAULT '',
  remarks       TEXT    DEFAULT '',
  created_by    TEXT    DEFAULT '',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);
CREATE INDEX IF NOT EXISTS idx_fee_receipts_job ON fee_receipts (job_id);
