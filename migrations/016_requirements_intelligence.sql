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
