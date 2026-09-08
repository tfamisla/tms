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
  survey_date          TEXT    DEFAULT '',
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
