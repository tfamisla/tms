-- TMS V0.8 — one-time migration: Survey Visit History.
-- A job can have unlimited survey visits (initial survey, reinspection,
-- dismantling inspection, ...) instead of one fixed set of survey fields.
-- jobs.survey_date is kept untouched for backward compatibility; the new
-- survey_visits table is authoritative for new visit tracking.
-- Apply once: wrangler d1 execute TMS_DB --remote --file=migrations/008_survey_visits.sql
-- Safe to skip if already applied — a duplicate-column/table error means it already ran.

CREATE TABLE IF NOT EXISTS survey_visits (
  id               TEXT    PRIMARY KEY,
  job_id           TEXT    NOT NULL,
  visit_date       TEXT    NOT NULL,
  visit_time       TEXT    DEFAULT '',
  reason           TEXT    NOT NULL,
  inspected_by_ids TEXT    NOT NULL DEFAULT '[]',
  remarks          TEXT    DEFAULT '',
  created_by       TEXT    DEFAULT '',
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);
CREATE INDEX IF NOT EXISTS idx_survey_visits_job ON survey_visits (job_id);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO settings (key, value) VALUES ('inspection_staff_visibility', 'visible');

ALTER TABLE jobs ADD COLUMN survey_status TEXT NOT NULL DEFAULT 'not_surveyed';
