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
-- V1.1A note: `bill_amount` and `billing_remarks` are superseded by
-- `professional_fees`/`expenses` (Base Total/GST/Invoice Value are derived
-- from those, never stored) and are no longer written by the frontend, but
-- are kept as dormant/legacy columns for backward compatibility — no
-- production billing data existed at the time of this change (confirmed
-- via `SELECT COUNT(*) FROM job_billing` = 0), so there was nothing to
-- migrate or reinterpret.
CREATE TABLE IF NOT EXISTS job_billing (
  job_id            TEXT    PRIMARY KEY,
  bill_required     TEXT    NOT NULL DEFAULT 'to_be_decided',  -- 'yes'|'no'|'to_be_decided'
  bill_date         TEXT    DEFAULT '',
  bill_number       TEXT    DEFAULT '',
  bill_amount       TEXT    DEFAULT '',   -- legacy/dormant (V1.1) — superseded by professional_fees+expenses
  professional_fees TEXT    DEFAULT '',   -- rupees (V1.1A) — TFAM invoice: Professional Fees
  expenses          TEXT    DEFAULT '',   -- rupees (V1.1A) — TFAM invoice: Expenses
  billing_remarks   TEXT    DEFAULT '',   -- legacy/dormant (V1.1) — removed from active UI in V1.1A
  closure_date      TEXT    DEFAULT '',   -- only ever set via POST /api/jobs/:id/close
  closed_by         TEXT    DEFAULT '',   -- staff id, derived server-side from the authenticated user
  closure_remarks   TEXT    DEFAULT '',
  updated_at        INTEGER NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

-- ── Fee Receipts (V1.1, extended V1.1A) ─────────────────────────
-- One job -> many fee receipts, unlimited. `amount` = Received Amount,
-- `reference_no` = UTR/Reference (both reused from V1.1, not duplicated).
-- `tds_deduction`/`writeoff_amount` are always manual entry — TMS never
-- calculates or assumes a TDS percentage or write-off amount. Total
-- Received/TDS/Write-off/Accounted/Outstanding/Payment Status/Closure
-- Eligibility are always calculated from these + job_billing's invoice
-- fields, never stored.
CREATE TABLE IF NOT EXISTS fee_receipts (
  id              TEXT    PRIMARY KEY,
  job_id          TEXT    NOT NULL,
  receipt_date    TEXT    NOT NULL,
  amount          TEXT    NOT NULL,               -- Received Amount, rupees, e.g. "20000" or "20000.50"
  tds_deduction   TEXT    NOT NULL DEFAULT '0',    -- rupees; manual entry only, never calculated (V1.1A)
  writeoff_amount TEXT    NOT NULL DEFAULT '0',    -- rupees; manual entry only, never calculated (V1.1A)
  receipt_mode    TEXT    DEFAULT '',   -- 'NEFT / RTGS'|'UPI'|'Cheque'|'Cash'|'Bank Transfer'|'Adjustment'|'Other'
  reference_no    TEXT    DEFAULT '',   -- UTR / Reference / Cheque No.
  remarks         TEXT    DEFAULT '',
  created_by      TEXT    DEFAULT '',
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);
CREATE INDEX IF NOT EXISTS idx_fee_receipts_job ON fee_receipts (job_id);

-- ── Tasks (V1.2) ─────────────────────────────────────────────
-- Normalized, independent of jobs — the jobs table is frozen at 97
-- columns (see HANDOFF_NOTES.md). `job_id` is nullable: NULL means a
-- standalone office task, non-NULL means a claim-linked task. Task
-- completion never touches claim milestone fields and claim milestones
-- never touch tasks — the two systems stay independent in V1.2.
CREATE TABLE IF NOT EXISTS tasks (
  id                  TEXT    PRIMARY KEY,
  job_id              TEXT    DEFAULT NULL,   -- nullable: NULL = standalone office task
  title               TEXT    NOT NULL,
  description         TEXT    DEFAULT '',
  task_type           TEXT    NOT NULL,        -- see TASK_TYPES in worker.js — the TFAM Task Type Master
  priority            TEXT    NOT NULL DEFAULT 'normal',    -- 'low'|'normal'|'high'|'urgent'
  due_date            TEXT    DEFAULT '',      -- optional, YYYY-MM-DD
  due_time            TEXT    DEFAULT '',      -- optional, HH:MM
  expected_minutes    INTEGER,                 -- optional, positive integer minutes
  status              TEXT    NOT NULL DEFAULT 'not_started',  -- 'not_started'|'in_progress'|'waiting'|'completed'|'cancelled'
  waiting_reason      TEXT    DEFAULT '',      -- required (enforced in worker.js) when status='waiting'
  blocked_by_task_id  TEXT    DEFAULT NULL,    -- optional simple dependency; display-only, never forces status
  assigned_by         TEXT    DEFAULT '',      -- staff id, derived server-side from the authenticated user
  created_by          TEXT    DEFAULT '',      -- staff id, derived server-side from the authenticated user
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  completed_at        INTEGER,                 -- only ever set/cleared server-side
  completed_by        TEXT    DEFAULT '',      -- only ever set/cleared server-side
  completion_note     TEXT    DEFAULT '',
  cancelled_at        INTEGER,                 -- only ever set/cleared server-side
  cancelled_by        TEXT    DEFAULT '',      -- only ever set/cleared server-side
  FOREIGN KEY (job_id) REFERENCES jobs(id),
  FOREIGN KEY (blocked_by_task_id) REFERENCES tasks(id)
);
CREATE INDEX IF NOT EXISTS idx_tasks_job       ON tasks (job_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status    ON tasks (status);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date  ON tasks (due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_priority  ON tasks (priority);
CREATE INDEX IF NOT EXISTS idx_tasks_task_type ON tasks (task_type);

-- One task -> one or many assignees. Never comma-separated staff IDs.
CREATE TABLE IF NOT EXISTS task_assignees (
  task_id     TEXT    NOT NULL,
  staff_id    TEXT    NOT NULL,
  assigned_at INTEGER NOT NULL,
  assigned_by TEXT    DEFAULT '',   -- staff id, derived server-side from the authenticated user
  PRIMARY KEY (task_id, staff_id),  -- doubles as UNIQUE(task_id, staff_id); (task_id, staff_id) already
                                     -- indexes lookups by task_id, so only staff_id needs its own index
  FOREIGN KEY (task_id) REFERENCES tasks(id),
  FOREIGN KEY (staff_id) REFERENCES staff(id)
);
CREATE INDEX IF NOT EXISTS idx_task_assignees_staff ON task_assignees (staff_id);

-- Task audit history — a dedicated table rather than reusing jobs.activity,
-- since standalone tasks have no job_id to attach a job-scoped log entry to.
CREATE TABLE IF NOT EXISTS task_activity (
  id      TEXT    PRIMARY KEY,
  task_id TEXT    NOT NULL,
  text    TEXT    NOT NULL,
  ts      INTEGER NOT NULL,
  actor   TEXT    DEFAULT '',
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);
CREATE INDEX IF NOT EXISTS idx_task_activity_task ON task_activity (task_id);

-- ── Task Work Sessions (V1.3) ───────────────────────────────────
-- Normalized work-session history — the source of truth for actual time
-- spent. An active session is `ended_at IS NULL`; live elapsed time is
-- always derived (now - started_at), never continuously written. A closed
-- session's duration_seconds is computed once, server-side, from
-- (ended_at - started_at) at close time. Sessions are never hard-deleted
-- — corrections (Admin/Director only) update the row in place and record
-- who/why via adjusted_by/adjustment_reason, never silently.
CREATE TABLE IF NOT EXISTS task_work_sessions (
  id                TEXT    PRIMARY KEY,
  task_id           TEXT    NOT NULL,
  staff_id          TEXT    NOT NULL,
  started_at        INTEGER NOT NULL,
  ended_at          INTEGER,             -- NULL = this is the staff member's one active session
  duration_seconds  INTEGER,             -- NULL while active; computed once on close
  end_reason        TEXT    DEFAULT '',  -- 'paused'|'switched_task'|'task_completed'|'cancelled'|'assignment_removed'|'manual_correction'
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  adjusted_by       TEXT    DEFAULT '',  -- staff id, set only via the Admin/Director correction endpoint
  adjustment_reason TEXT    DEFAULT '',
  FOREIGN KEY (task_id) REFERENCES tasks(id),
  FOREIGN KEY (staff_id) REFERENCES staff(id)
);
CREATE INDEX IF NOT EXISTS idx_task_work_sessions_task    ON task_work_sessions (task_id);
CREATE INDEX IF NOT EXISTS idx_task_work_sessions_staff   ON task_work_sessions (staff_id);
CREATE INDEX IF NOT EXISTS idx_task_work_sessions_started ON task_work_sessions (started_at);
CREATE INDEX IF NOT EXISTS idx_task_work_sessions_ended   ON task_work_sessions (ended_at);
-- The actual "one active session per staff member" invariant — a second,
-- database-level safety net beneath the application-level check in
-- startOrResumeWork(). A partial unique index over rows where ended_at IS
-- NULL means SQLite/D1 itself rejects a second concurrently-open row for
-- the same staff_id, even under a race between two near-simultaneous
-- requests.
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_work_sessions_one_active_per_staff
  ON task_work_sessions (staff_id) WHERE ended_at IS NULL;

-- ── Task Personal Preferences (V1.4) ────────────────────────────
-- Exactly one "Do Next" pin per staff member — staff_id itself is the
-- PRIMARY KEY, so the schema guarantees the one-pin invariant the same
-- way the partial unique index above guarantees one-active-session.
-- Purely a personal ranking override for My Work; never affects global
-- task priority, never visible to/affects any other staff member's
-- recommendations even on a shared task.
CREATE TABLE IF NOT EXISTS task_personal_preferences (
  staff_id     TEXT    PRIMARY KEY,
  next_task_id TEXT    NOT NULL,
  updated_at   INTEGER NOT NULL,
  FOREIGN KEY (staff_id) REFERENCES staff(id),
  FOREIGN KEY (next_task_id) REFERENCES tasks(id)
);
-- V1.7 — Requirements & Document Intelligence
-- Normalized only — jobs stays frozen at 97 columns, untouched here.

-- ── Requirement Master ──────────────────────────────────────────
-- Reusable catalogue of requirement definitions (documents, information,
-- clarifications, certificates, ...). Admin-managed. Never hard-deleted
-- once used by a claim — use is_active instead (see worker.js).
CREATE TABLE IF NOT EXISTS requirement_master (
  id                TEXT    PRIMARY KEY,
  name              TEXT    NOT NULL,
  category          TEXT    NOT NULL DEFAULT 'Other',
  requirement_type  TEXT    NOT NULL DEFAULT 'document',
  description       TEXT    DEFAULT '',
  request_text      TEXT    DEFAULT '',
  default_mandatory INTEGER NOT NULL DEFAULT 1,
  is_active         INTEGER NOT NULL DEFAULT 1,
  created_by        TEXT    DEFAULT '',
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_requirement_master_active   ON requirement_master (is_active);
CREATE INDEX IF NOT EXISTS idx_requirement_master_category ON requirement_master (category);

-- ── Requirement Templates ───────────────────────────────────────
-- A reusable named collection of requirement_master items for a recurring
-- claim type (e.g. "Fire — Stock"). department/peril/policy_name are
-- optional deterministic-matching hints, not hard constraints.
CREATE TABLE IF NOT EXISTS requirement_templates (
  id           TEXT    PRIMARY KEY,
  name         TEXT    NOT NULL,
  department   TEXT    DEFAULT '',
  peril        TEXT    DEFAULT '',
  policy_name  TEXT    DEFAULT '',
  description  TEXT    DEFAULT '',
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_by   TEXT    DEFAULT '',
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_requirement_templates_active ON requirement_templates (is_active);

CREATE TABLE IF NOT EXISTS requirement_template_items (
  id             TEXT    PRIMARY KEY,
  template_id    TEXT    NOT NULL,
  requirement_id TEXT    NOT NULL,
  mandatory      INTEGER NOT NULL DEFAULT 1,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  notes          TEXT    DEFAULT '',
  FOREIGN KEY (template_id) REFERENCES requirement_templates(id),
  FOREIGN KEY (requirement_id) REFERENCES requirement_master(id)
);
CREATE INDEX IF NOT EXISTS idx_rti_template ON requirement_template_items (template_id);
-- A given master requirement can only appear once per template.
CREATE UNIQUE INDEX IF NOT EXISTS idx_rti_unique ON requirement_template_items (template_id, requirement_id);

-- ── Per-Job Requirements ────────────────────────────────────────
-- The actual checklist for one claim. requirement_id nullable: NULL means
-- a custom, one-off requirement typed directly on this claim.
-- requirement_name/requirement_type/category are always a SNAPSHOT taken
-- at creation time (from master, or typed directly for custom items) so
-- later master edits never silently rewrite a claim's historical wording.
CREATE TABLE IF NOT EXISTS job_requirements (
  id                TEXT    PRIMARY KEY,
  job_id            TEXT    NOT NULL,
  requirement_id    TEXT    DEFAULT NULL,
  requirement_name  TEXT    NOT NULL,
  requirement_type  TEXT    NOT NULL DEFAULT 'document',
  category          TEXT    DEFAULT '',
  mandatory         INTEGER NOT NULL DEFAULT 1,
  status            TEXT    NOT NULL DEFAULT 'pending',
  requested_date    TEXT    DEFAULT '',
  received_date     TEXT    DEFAULT '',
  waived_date       TEXT    DEFAULT '',
  waived_by         TEXT    DEFAULT '',
  waiver_reason     TEXT    DEFAULT '',
  remarks           TEXT    DEFAULT '',
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_by        TEXT    DEFAULT '',
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id),
  FOREIGN KEY (requirement_id) REFERENCES requirement_master(id)
);
CREATE INDEX IF NOT EXISTS idx_job_requirements_job    ON job_requirements (job_id);
CREATE INDEX IF NOT EXISTS idx_job_requirements_status ON job_requirements (status);
-- Duplicate prevention for template application: the same master
-- requirement can't be linked twice on the same job (custom/NULL-linked
-- requirements are exempt — they have no master id to collide on).
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_requirements_unique_master
  ON job_requirements (job_id, requirement_id) WHERE requirement_id IS NOT NULL;

-- ── Requirement Follow-ups ──────────────────────────────────────
-- Requirement-level follow-up history — distinct from and never replacing
-- claim_reminders (claim-level). source='reminder' rows carry
-- claim_reminder_id back to the claim_reminders row that created them.
CREATE TABLE IF NOT EXISTS requirement_followups (
  id                  TEXT    PRIMARY KEY,
  job_requirement_id  TEXT    NOT NULL,
  followup_date       TEXT    NOT NULL,
  mode                TEXT    DEFAULT '',
  source              TEXT    NOT NULL DEFAULT 'manual_followup',
  remarks             TEXT    DEFAULT '',
  claim_reminder_id   TEXT    DEFAULT '',
  created_by          TEXT    DEFAULT '',
  created_at          INTEGER NOT NULL,
  FOREIGN KEY (job_requirement_id) REFERENCES job_requirements(id)
);
CREATE INDEX IF NOT EXISTS idx_requirement_followups_jr ON requirement_followups (job_requirement_id);

-- ── Document Receipt Event → Requirement Links ──────────────────
-- Junction table connecting V0.9's document_receipt_events (a received
-- batch log) to the specific job_requirements it satisfies. A receipt
-- event may link to several requirements; a requirement may be linked by
-- several receipt events over time. Existing/old receipt events remain
-- valid and simply unlinked — this table is purely additive.
CREATE TABLE IF NOT EXISTS document_receipt_requirement_links (
  id                  TEXT    PRIMARY KEY,
  receipt_event_id    TEXT    NOT NULL,
  job_requirement_id  TEXT    NOT NULL,
  created_at          INTEGER NOT NULL,
  FOREIGN KEY (receipt_event_id) REFERENCES document_receipt_events(id),
  FOREIGN KEY (job_requirement_id) REFERENCES job_requirements(id)
);
CREATE INDEX IF NOT EXISTS idx_drrl_receipt     ON document_receipt_requirement_links (receipt_event_id);
CREATE INDEX IF NOT EXISTS idx_drrl_requirement ON document_receipt_requirement_links (job_requirement_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_drrl_unique ON document_receipt_requirement_links (receipt_event_id, job_requirement_id);
