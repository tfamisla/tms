-- TMS V1.2 — one-time migration: Task Management.
-- Creates task-related tables ONLY — does NOT touch `jobs`, which is
-- frozen at 97 columns (see migrations/011_billing_closure.sql and
-- HANDOFF_NOTES.md's permanent architecture rule). Tasks are fully
-- normalized and independent of jobs/job_billing/milestone fields:
-- `job_id` is nullable so a task may be claim-linked or a standalone
-- office task, and task completion never alters claim milestones.
--
-- Apply once: wrangler d1 execute TMS_DB --remote --file=migrations/013_task_management.sql
-- Safe to skip if already applied — a duplicate-table error means it already ran.

CREATE TABLE IF NOT EXISTS tasks (
  id                  TEXT    PRIMARY KEY,
  job_id              TEXT    DEFAULT NULL,
  title               TEXT    NOT NULL,
  description         TEXT    DEFAULT '',
  task_type           TEXT    NOT NULL,
  priority            TEXT    NOT NULL DEFAULT 'normal',
  due_date            TEXT    DEFAULT '',
  due_time            TEXT    DEFAULT '',
  expected_minutes    INTEGER,
  status              TEXT    NOT NULL DEFAULT 'not_started',
  waiting_reason      TEXT    DEFAULT '',
  blocked_by_task_id  TEXT    DEFAULT NULL,
  assigned_by         TEXT    DEFAULT '',
  created_by          TEXT    DEFAULT '',
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  completed_at        INTEGER,
  completed_by        TEXT    DEFAULT '',
  completion_note     TEXT    DEFAULT '',
  cancelled_at        INTEGER,
  cancelled_by        TEXT    DEFAULT '',
  FOREIGN KEY (job_id) REFERENCES jobs(id),
  FOREIGN KEY (blocked_by_task_id) REFERENCES tasks(id)
);
CREATE INDEX IF NOT EXISTS idx_tasks_job       ON tasks (job_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status    ON tasks (status);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date  ON tasks (due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_priority  ON tasks (priority);
CREATE INDEX IF NOT EXISTS idx_tasks_task_type ON tasks (task_type);

CREATE TABLE IF NOT EXISTS task_assignees (
  task_id     TEXT    NOT NULL,
  staff_id    TEXT    NOT NULL,
  assigned_at INTEGER NOT NULL,
  assigned_by TEXT    DEFAULT '',
  PRIMARY KEY (task_id, staff_id),
  FOREIGN KEY (task_id) REFERENCES tasks(id),
  FOREIGN KEY (staff_id) REFERENCES staff(id)
);
CREATE INDEX IF NOT EXISTS idx_task_assignees_staff ON task_assignees (staff_id);

CREATE TABLE IF NOT EXISTS task_activity (
  id      TEXT    PRIMARY KEY,
  task_id TEXT    NOT NULL,
  text    TEXT    NOT NULL,
  ts      INTEGER NOT NULL,
  actor   TEXT    DEFAULT '',
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);
CREATE INDEX IF NOT EXISTS idx_task_activity_task ON task_activity (task_id);
