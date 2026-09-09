-- TMS V1.3 — one-time migration: Live Working / Task Time Tracking.
-- Creates the work-session table ONLY — does NOT touch `jobs`, which is
-- frozen at 97 columns (see migrations/011_billing_closure.sql and
-- HANDOFF_NOTES.md's permanent architecture rule). No new columns were
-- added to `tasks` either — live-work state (active worker, actual time)
-- is always derived from task_work_sessions, never cached redundantly.
--
-- The partial UNIQUE INDEX at the bottom is the database-level half of
-- the "one active work session per staff member" invariant — confirm it
-- applies cleanly before treating this migration as done; if D1 rejects
-- partial-index syntax for any reason, STOP, do not force it through, and
-- fall back to application-level-only enforcement (documented in
-- HANDOFF_NOTES.md) rather than guessing at a workaround.
--
-- Apply once: wrangler d1 execute TMS_DB --remote --file=migrations/014_task_work_sessions.sql
-- Safe to skip if already applied — a duplicate-table/index error means it already ran.

CREATE TABLE IF NOT EXISTS task_work_sessions (
  id                TEXT    PRIMARY KEY,
  task_id           TEXT    NOT NULL,
  staff_id          TEXT    NOT NULL,
  started_at        INTEGER NOT NULL,
  ended_at          INTEGER,
  duration_seconds  INTEGER,
  end_reason        TEXT    DEFAULT '',
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  adjusted_by       TEXT    DEFAULT '',
  adjustment_reason TEXT    DEFAULT '',
  FOREIGN KEY (task_id) REFERENCES tasks(id),
  FOREIGN KEY (staff_id) REFERENCES staff(id)
);
CREATE INDEX IF NOT EXISTS idx_task_work_sessions_task    ON task_work_sessions (task_id);
CREATE INDEX IF NOT EXISTS idx_task_work_sessions_staff   ON task_work_sessions (staff_id);
CREATE INDEX IF NOT EXISTS idx_task_work_sessions_started ON task_work_sessions (started_at);
CREATE INDEX IF NOT EXISTS idx_task_work_sessions_ended   ON task_work_sessions (ended_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_work_sessions_one_active_per_staff
  ON task_work_sessions (staff_id) WHERE ended_at IS NULL;
