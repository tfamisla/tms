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
