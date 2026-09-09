-- TMS V1.4 — one-time migration: My Work / Now–Next–Later.
-- Adds ONLY the personal "Do Next" pin table — does NOT touch `jobs`,
-- frozen at 97 columns (see HANDOFF_NOTES.md's permanent architecture
-- rule). The recommendation engine itself (NOW/NEXT/LATER, scoring,
-- eligibility) is entirely computed on read from existing tasks/
-- task_assignees/task_work_sessions/jobs data — no ranking-score column,
-- no cached queue, nothing else persisted.
--
-- Apply once: wrangler d1 execute TMS_DB --remote --file=migrations/015_my_work_preferences.sql
-- Safe to skip if already applied — a duplicate-table error means it already ran.

CREATE TABLE IF NOT EXISTS task_personal_preferences (
  staff_id     TEXT    PRIMARY KEY,
  next_task_id TEXT    NOT NULL,
  updated_at   INTEGER NOT NULL,
  FOREIGN KEY (staff_id) REFERENCES staff(id),
  FOREIGN KEY (next_task_id) REFERENCES tasks(id)
);
