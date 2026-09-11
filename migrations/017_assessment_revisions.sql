-- V1.8 ("Lean Workflow & D1 Optimization" per this version's own spec text,
-- tracked as V1.8 in HANDOFF_NOTES.md to keep the roadmap's version
-- sequence consistent — V1.6/V1.7 were already used for Director Control
-- Centre / Requirements Intelligence).
--
-- Assessment revision cycles: the ORIGINAL assessment continues to live on
-- `jobs` (assessment_status, assessed_amount, director_verification_*,
-- insurer_approval_*) exactly as V0.9/V1.0 always defined it — untouched,
-- never duplicated into this table. This table only ever holds INSURER-
-- DRIVEN REVISIONS (R1, R2, R3) created lazily the moment a revision is
-- actually requested — most jobs will never have a row here.
CREATE TABLE IF NOT EXISTS assessment_revisions (
  id                      TEXT    PRIMARY KEY,
  job_id                  TEXT    NOT NULL,
  revision_no             INTEGER NOT NULL,   -- 1, 2, or 3 (0/"Original" is jobs.* itself, never stored here)
  assessment_date         TEXT    DEFAULT '',
  assessed_amount         TEXT    DEFAULT '',
  prepared_by_staff_id    TEXT    DEFAULT '',
  director_status         TEXT    NOT NULL DEFAULT 'pending',  -- 'pending'|'approved'|'returned'
  director_verified_at    INTEGER,
  director_verified_by    TEXT    DEFAULT '',
  director_return_reason  TEXT    DEFAULT '',
  insurer_status          TEXT    NOT NULL DEFAULT 'pending',  -- 'pending'|'approved'|'revision_required'|'rejected'
  insurer_decision_date   TEXT    DEFAULT '',
  insurer_revision_reason TEXT    DEFAULT '',
  notes                   TEXT    DEFAULT '',
  created_by              TEXT    DEFAULT '',
  created_at              INTEGER NOT NULL,
  updated_at              INTEGER NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);
CREATE INDEX IF NOT EXISTS idx_assessment_revisions_job ON assessment_revisions (job_id);
-- Exactly one row per (job, revision number) — belt-and-braces alongside
-- the application-level "only one active/latest revision" logic.
CREATE UNIQUE INDEX IF NOT EXISTS idx_assessment_revisions_unique ON assessment_revisions (job_id, revision_no);
