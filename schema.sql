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
  insurer              TEXT    DEFAULT '',
  insured              TEXT    DEFAULT '',
  policy_no            TEXT    DEFAULT '',
  claim_no             TEXT    DEFAULT '',
  peril                TEXT    DEFAULT '',
  claim_amount         TEXT    DEFAULT '',
  date_loss            TEXT    DEFAULT '',
  date_intimation      TEXT    DEFAULT '',
  survey_date          TEXT    DEFAULT '',
  appointment_date     TEXT    DEFAULT '',
  appointment_confirmed INTEGER DEFAULT 0,
  stage                TEXT    NOT NULL DEFAULT 'new_claim',
  assigned             TEXT    NOT NULL DEFAULT '[]',   -- JSON array of member IDs
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
CREATE TABLE IF NOT EXISTS staff (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  role       TEXT DEFAULT '',
  initials   TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#6B7AFF',
  created_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO staff (id, name, role, initials, color, created_at) VALUES
  ('rajan',    'Raja Naren R',        'Director',          'RN', '#1B2E5A', 0),
  ('thiravia', 'Raja Thiravia Kumar', 'Director',          'RT', '#1A4FA0', 0),
  ('surv1',    'Employee Surveyor 1', 'Employee Surveyor', 'S1', '#1A7A4A', 0),
  ('surv2',    'Employee Surveyor 2', 'Employee Surveyor', 'S2', '#7C3AED', 0),
  ('train1',   'Trainee Surveyor 1',  'Trainee Surveyor',  'T1', '#0284C7', 0),
  ('train2',   'Trainee Surveyor 2',  'Trainee Surveyor',  'T2', '#D97706', 0),
  ('back1',    'Backend Staff 1',     'Backend Staff',      'B1', '#BE185D', 0),
  ('back2',    'Backend Staff 2',     'Backend Staff',      'B2', '#059669', 0),
  ('back3',    'Backend Staff 3',     'Backend Staff',      'B3', '#B45309', 0),
  ('back4',    'Backend Staff 4',     'Backend Staff',      'B4', '#6B7AFF', 0);

-- ── Insurers ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS insurers (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
