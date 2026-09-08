# TMS (TFAM Management System) — Handoff Notes

Written 2026-09-09 for continuity to another AI assistant / developer picking up this work.

## What this is

A claims/survey job tracker built for TFAM, an insurance loss-assessor/surveyor firm. It's a Kanban-style board of insurance claim jobs moving through a pipeline (New Claim → Awaiting Inspection → ... → Closed), with staff assignment, document checklists, an activity log, and now real login/auth.

## Live deployment

- **Live app**: https://tms-worker.tfamisla.workers.dev
- **GitHub repo**: https://github.com/tfamisla/tms.git (branch `main`)
- **Cloudflare account**: tfamisla@gmail.com
- **GitHub account**: tfamisla (auth via `gh auth login`, browser flow — do NOT try username/password git push, GitHub rejects it; use the `gh` CLI's credential helper, already configured on this machine)
- Local project path: `/Users/rajanaren/Documents/TMS`

### Architecture — single Worker serves everything

There is **no separate Cloudflare Pages site**. One Cloudflare Worker (`worker.js`) does two jobs:
1. Serves the static frontend (`public/index.html`) via Wrangler's `[assets]` config in `wrangler.toml` (directory `./public`, binding `ASSETS`)
2. Handles the JSON API under `/api/*`

This was a deliberate choice (see git log) instead of the classic "separate Pages + Workers" split, because Cloudflare's dashboard "Connect to Git" flow auto-detected `wrangler.toml` and defaulted to a Workers Git integration anyway. So `index.html` and the API are same-origin — the frontend's `API` const is just `''` (empty string), all fetches are relative paths like `/api/jobs`.

**Cloudflare Git integration**: the repo is connected to Cloudflare's Workers Builds — every push to `main` on GitHub triggers `npx wrangler deploy` automatically on Cloudflare's side. In addition, deploys have also been run manually from this machine via `wrangler deploy` throughout development. Both point at the same Worker, so they're redundant, not conflicting.

### Database — Cloudflare D1

- Database name: `TMS_DB`, id `bde9756d-49c9-45d9-b4f9-21420b904a32`, bound as `TMS_DB` in `wrangler.toml`
- **`schema.sql`** is the fresh-install source of truth — every statement uses `CREATE TABLE IF NOT EXISTS` / `INSERT OR IGNORE`, safe to re-run
- **`migrations/*.sql`** are one-time, non-idempotent scripts (mostly `ALTER TABLE ... ADD COLUMN`) applied to the already-live database as features were added. Applied in order: `002_auth_and_acronyms.sql`, `003_job_detail_fields.sql`. If you add more schema changes, add a new numbered migration file rather than editing schema.sql's `CREATE TABLE` in a way that would break `ALTER TABLE` idempotency — and apply it with:
  ```
  wrangler d1 execute TMS_DB --remote --file=migrations/00X_name.sql
  ```

## ⚠️ Important constraint: do not touch the live database directly

The user has real employee data loaded (all placeholder names have been replaced with real staff — Aswin Joseph, Subramanian P, Ramanathan, Iyappan, Murugan C, Thendralarasi, Keethana, Magesh D, plus Raja Naren R and Raja Thiravia Kumar) and has explicitly said: **never alter the database directly once real data is in it.** Schema migrations (new columns/tables) are fine when a feature genuinely needs them, but never run ad-hoc `INSERT`/`UPDATE`/`DELETE` against real rows, and don't create throwaway test data on the live DB to verify things — verify via code review, syntax checks (`node --check worker.js`, extracting and `new Function()`-checking the inline `<script>`), and read-only `SELECT`/`PRAGMA` queries only.

## Data model (current, as of migration 003)

### `jobs`
Primary key `id` (e.g. `"TF-001"`, auto-numbered via the `counter` table, OR manually entered — see below). Columns: `title`, `insurer`, `insured`, `policy_no`, `policy_name`, `policy_period`, `claim_no`, `peril`, `claim_amount`, `estimated_loss`, `gross_loss`, `department`, `appointing_office`, `appointing_person`, `contact_person`, `contact_phone`, `address`, `district`, `date_loss`, `date_intimation`, `survey_date`, `appointment_date`, `appointment_confirmed` (0/1), `stage` (pipeline stage id), `assigned` (JSON array of staff ids — **legacy**, see "In progress" below), `notes`, `docs` (JSON object of doc-checklist flags), `activity` (JSON array of `{text, ts, actor}`), `created_at`, `updated_at`.

### `staff`
`id`, `name`, `role` (free-text job title like "Director", "Employee Surveyor" — **not** the same as `access_role`), `access_role` ('staff' or 'admin' — controls login permissions), `initials`, `color`, `password_hash` (PBKDF2, nullable until the user has a password), `created_at`.

**`rajan` (Raja Naren R) is permanently locked to `access_role = 'admin'`** — enforced server-side in `worker.js`, can never be demoted or deleted by anyone, including other admins.

### `insurers`
`id`, `name` (unique), `acronym` (up to 5 letters, auto-suggested from the name but editable), `created_at`.

### `sessions`
`token` (primary key, the session cookie value), `staff_id`, `created_at`, `expires_at` (30-day TTL).

### `counter`
Single row (`id='main'`) tracking the next auto-generated job number (`TF-XXX`).

## Auth system

- Passwords hashed with PBKDF2-SHA256 (100,000 iterations, random 16-byte salt), stored as `base64(salt):base64(hash)` in `staff.password_hash`
- Sessions are **HttpOnly, Secure, SameSite=Lax cookies** (`tms_session`), validated server-side against the `sessions` table on every request
- **Bootstrap flow**: on a fresh install, no one has a password. Only `rajan` may self-activate — his first login attempt sets whatever password he types as his permanent password. Every other staff member must be given a password by an admin (via the Staff screen's edit modal → "Reset Password" field) before they can log in at all — this prevents anyone else from claiming an account
- **Authorization**: every `/api/*` route requires a valid session except `POST /api/auth/login` and `GET /api/auth/roster` (id+name only, used to populate the login screen's dropdown, no sensitive data). Staff create/edit/delete/password-reset requires `access_role === 'admin'` (checked server-side in `worker.js`, not just hidden client-side). Any signed-in user can change their own password via `POST /api/auth/change-password`
- Client-side: `public/index.html` shows a full-screen login overlay until `GET /api/auth/me` succeeds; a 401 from any API call anywhere in the app triggers `sessionExpired()` which re-shows the login screen

## API endpoints (all in `worker.js`)

```
GET    /api/auth/roster              — public, {id,name} list for login dropdown
POST   /api/auth/login               — public, body {id, password} → sets session cookie
GET    /api/auth/me                  — current session's staff record
POST   /api/auth/logout              — clears session
POST   /api/auth/change-password     — body {oldPassword, newPassword}

GET    /api/jobs                     — list all jobs
POST   /api/jobs                     — create; body.id optional (manual numbering), else auto TF-XXX
PATCH  /api/jobs/:id                 — partial update; body.activity_add appends to the activity log

GET    /api/log                      — flattened activity feed across all jobs (latest 500)

GET    /api/staff                    — list (password_hash never included in responses)
POST   /api/staff                    — admin only
PATCH  /api/staff/:id                — admin only; body.access_role and body.password both gated
                                        server-side (rajan's access_role can't be changed)
DELETE /api/staff/:id                — admin only; rajan cannot be deleted

GET    /api/insurers                 — list
POST   /api/insurers                 — any signed-in user; dedupes case-insensitively by name
PATCH  /api/insurers/:id             — any signed-in user
DELETE /api/insurers/:id             — any signed-in user
```

## Frontend structure (`public/index.html` — single file, ~1400 lines)

- Inline `<style>` (CSS custom properties for a light/dark navy+amber theme), inline `<script>`, no build step, no framework
- Views: Dashboard (Kanban board), Staff (team grid + insurance companies list), Work Log (activity feed with filters)
- Modals: New Job, New/Edit Staff (admin), New/Edit Insurer, Change My Password, plus a slide-out side panel for job detail/edit
- Key state variables: `jobs`, `log`, `TEAM` (staff, was `const` originally, now mutable and API-driven), `INSURERS`, `currentUser`/`currentUserRecord` (from session), `panelState` (pending edits in the open job's side panel before Save)
- `fetchAll()` polls every 5 seconds while logged in (`pollTimer`)

## Git / deploy workflow used throughout this project

```bash
# Local dev tools already installed on this Mac Mini:
wrangler --version   # 4.130.0, installed globally via npm
gh auth status        # authenticated as tfamisla

# Typical change cycle:
# 1. Edit worker.js / public/index.html / schema.sql
# 2. If schema changed: write migrations/00X_*.sql, then:
wrangler d1 execute TMS_DB --remote --file=migrations/00X_name.sql
# 3. Deploy:
wrangler deploy
# 4. Commit + push (also triggers Cloudflare's own auto-deploy):
git add -A && git commit -m "..." && git push
```

Syntax-checking before deploy (no test runner exists in this repo):
```bash
node --check worker.js
node -e "
const fs = require('fs');
const html = fs.readFileSync('public/index.html', 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>/);
new Function(m[1]); console.log('JS syntax OK');
"
grep -oE 'id=\"[^\"]+\"' public/index.html | sort | uniq -d   # must be empty (no dup DOM ids)
```

## Feature history (chronological, see `git log` for exact commits)

1. Initial deploy: Wrangler install, D1 database creation, schema apply, Worker deploy, GitHub push, Cloudflare Pages→Workers Git integration pivot
2. Restructured to single-Worker-serves-everything (moved `index.html` into `public/`, added `[assets]` to `wrangler.toml`)
3. Database-backed staff (replacing a hardcoded `TEAM` JS array) + insurers + manual job-ID numbering, with add/edit/delete for staff and insurers
4. Full login/session auth, `access_role` admin/staff split, `rajan` locked as permanent super admin, insurer acronyms
5. Extra job-detail fields (Policy Name/Period, Estimated/Gross Loss, Department, Appointing Office/Person, Contact Person/Phone, Address, District)

6. **TFAM Branches feature (done, migration `004_branches.sql`)**: new `branches` table (`id`, `name`, `color`, `created_at`), admin-gated CRUD (`GET/POST /api/branches`, `PATCH/DELETE /api/branches/:id`). The old single "Assign To" chip-grid on both the New Job form and the job detail side panel was replaced with **4 separate multi-select categories**: Director Responsible (staff), Surveyor Who Is Signing (staff), TFAM Branch Which Is Handling (branches), Backstaff/Surveyor Responsible (staff) — new `jobs` columns `director_ids`/`surveyor_ids`/`branch_ids`/`backstaff_ids` (JSON arrays). The legacy `assigned` column was kept (not dropped) for backward compatibility with pre-existing jobs; a new `jobStaffIds(j)` helper in the frontend unions all of `assigned` + the 3 staff-referencing category fields for display purposes (job card avatars, staff "my jobs" count) so old and new jobs both display correctly. The per-chip toggle logic was generalized into one reusable `chipsHtml(options, selectedIds)` + `toggleChip(el)` pair (driven by `data-id`/`data-color` attributes) instead of writing near-duplicate code 4 times. Branch management lives in a new "TFAM Branches" section on the Staff view, admin-gated like staff (an "+ Add Branch" button, click-to-edit chips), mirroring the insurer pattern.

7. **Admin rename + role-based assignment filtering (commit `acabd2a`)**: the "Staff" nav tab is now labeled "🛠 Admin" (UI-only — `view-staff` id, `switchView('staff')`, and the staff API/data model are all unchanged; `switchView()`'s active-state matching was made robust via a `data-view` attribute instead of parsing button text). The Director Responsible and Surveyor Who Is Signing chip selectors (both New Job form and job detail panel) are now filtered by the real `staff.role` text values (confirmed via read-only query: `"Director"`, `"Employee Surveyor"`, `"Trainee Surveyor"`, `"Backend Staff"` — no other variants exist) using new `isDirector()`/`isSurveyor()`/`isTrainee()`/`canSignSurvey()` helpers: Director Responsible → Director only; Surveyor Who Is Signing → Director + Employee Surveyor (Trainee Surveyor and Backend Staff excluded, since trainees can't sign a report); Backstaff/Surveyor Responsible and TFAM Branch Handling stay unfiltered. The job detail panel's filtered selectors union in anyone already assigned even if they wouldn't pass the filter today, so a role change never silently drops existing assignment data on save. Worker-side, `director_ids`/`surveyor_ids`/`branch_ids`/`backstaff_ids` are now validated against real `staff`/`branches` rows in both `createJob` and `updateJob` (`validateJobAssignments()`), and branch name uniqueness (case-insensitive) is a rejected error rather than silently reusing the existing row.

8. **Job Details restructure (commit `b09afa0`, migration `006_job_details_restructure.sql`)**: split into two labeled sections on both the New Job form and job detail panel — **Insurer Details** (Insurance Company, Insurer Branch Name, Appointing Office Address/District/State, Appointing Person + Email + Phone) and **Claim Details** (Insured Name/Address/District/State/Pincode, multi-contact list, Deputation Date/Mode, Loss Date, Claim No., Policy Name/No./Period, Peril, Estimated Loss, Claim Amount, Gross Loss, Department). New `jobs.contacts` JSON column (array of `{name,designation,phone,email}`) replaces the old single `contact_person`/`contact_phone` fields (kept, unused, for backward compat) — reusable helpers `contactRowHtml()`/`addContactRow()`/`renderContacts()`/`collectContacts()` drive an add/remove-row UI shared between both forms. "Deputation Date" reuses the existing `date_intimation` column (just relabeled) per the user's explicit clarification that intimation/deputation/appointment dates mean the same thing in their workflow — the separate `appointment_date`/`appointment_confirmed` pair (used for survey scheduling status) was deliberately left untouched as a distinct feature. "Deputation Mode" (Email/Call) is a new `deputation_mode` column. The old combined `appointing_office` text column is kept but no longer read/written, superseded by the split `appointing_office_address`/`_district`/`_state` columns.

## TMS V0.7 — Finalize New Job Entry (done, commit `574a67b`, migration `007_item_type.sql`)

Reorganized the New Job form (and lightly touched the job detail panel — see below) into the exact required sequence, verified live via DOM inspection:

1. **Job Title** (unlabeled, unchanged — still the only hard-required field) → **Job Number** section (relabeled from "Job ID"; blank still means auto-numbered TF-XXX, unchanged behavior)
2. **Insurer Details**: Insurance Company → Insurer Branch Name → *Appointing Office* subgroup (Address/District/State) → *Appointing Person* subgroup (Name/Email/Phone)
3. **Insured Details** (newly split out as its own top-level section, previously merged into Claim Details): Insured Name → *Insured Address* subgroup (Address/District/State/Pincode) → Contact Person(s) (multi-contact, unchanged `contactRowHtml()`/`addContactRow()`/`renderContacts()`/`collectContacts()`)
4. **Claim Details**, now organized into labeled subgroups: *Deputation* (Date, Mode) → *Loss Details* (Date of Loss, Department, Peril/Nature of Loss, **Type of Item/Property Involved** — new field, see below) → *Claim Identification* (Claim No., Policy Name, Policy No.) → *Policy Period* (From/To — reuses the existing `policy_period_from`/`policy_period_to` columns from V0.6, not renamed) → *Financial Details* (Estimated Loss, Claim Amount, Gross Loss Amount)
5. **Responsibility Allocation** (moved to be the final section before the button, now explicitly labeled — previously unlabeled): Director Responsible → Surveyor Who Is Signing → TFAM Branch Which Is Handling → Backstaff/Surveyor Responsible
6. **Create Job** button

New schema field: `jobs.item_type` ("Type of Item / Property Involved" — TEXT, default `''`), added via `migrations/007_item_type.sql`, intended to later feed a Policy Type + Department + Peril + Item Type → dynamic Document Requirement/LOR engine (not built in V0.7, deliberately). No other new columns — `policy_period_from`/`_to`, `appointing_office_*`, `contacts`, `deputation_mode`, etc. all already existed from V0.6 and were reused, not duplicated.

**Validation added** (new `isValidEmail()`, `isValidPhone()`, `validatePolicyPeriod()`, `validateContacts()` helpers, shared by New Job submit and job detail Save): Policy Period Expiry can't be earlier than Policy Period From (blocking, both client-side and server-side in `worker.js`'s `createJob`/`updateJob`); contact and Appointing Person email/phone are format-checked only when non-empty — nothing is forced to be filled in, since TFAM often deputes with incomplete information. `<input inputmode="decimal">` (not `type="number"`) was kept for the currency fields so Indian comma-formatted entry (e.g. "45,00,000") keeps working — these stay TEXT columns, not real numerics.

**Job detail panel**: deliberately NOT redesigned into the same Insured/Insurer/Claim split (per explicit instruction) — only the new `item_type` field was added into its existing Claim Details grid so it's persisted/editable there too. A full Job Update/lifecycle redesign is V0.8's job.

## TMS V0.8 — Survey Visit History (done, commit `9f590c0`, migration `008_survey_visits.sql`)

**Important note on scope**: the user's V0.8 instruction arrived as an amendment ("IMPORTANT CHANGE TO TMS V0.8 — MULTIPLE SURVEY VISITS") referencing an "original TMS V0.8 — Job Update + Survey prompt" that was never actually sent to this session — only the survey-visits amendment was received, and it was fully self-contained (data model, UI mockups, API design, validation rules, acceptance criteria all specified), so that's exactly what was built. The broader "Job Update" scope this handoff doc previously guessed at (ILA/LOR dates, FSR prep/submission, billing, etc.) was **not** addressed — those remain open, now folded into whatever V0.9 turns out to need beyond "Complete Claim Milestones" (see below).

**Core change**: survey tracking is no longer a fixed set of fields on `jobs` — a job can now have unlimited survey visits (Initial Survey → Reinspection → Joint Inspection → Dismantling Inspection → Repair Inspection → Damage Verification → Document/Record Verification → Final Inspection → Other/custom), each an independent record.

- New `survey_visits` table: `id`, `job_id` (FK), `visit_date` (required, `YYYY-MM-DD`), `visit_time` (optional, `HH:MM`), `reason` (required — preset dropdown + free-text "Other"), `inspected_by_ids` (JSON array of staff ids, required, ≥1), `remarks`, `created_by`, `created_at`, `updated_at`
- New `jobs.survey_status` (`'not_surveyed' | 'in_progress' | 'completed'`): defaults `not_surveyed`; auto-advances to `in_progress` the first time a visit is added for that job (and again if a visit is added after `completed` — treated as reopening, since new visit activity after "done" means it wasn't actually done); **never** auto-set to `completed` — only the explicit "Mark Survey Completed" button does that (`PATCH /api/jobs/:id` with `survey_status:'completed'`, reusing the existing generic job-update endpoint since it already supports arbitrary `UPDATABLE_FIELDS` + `activity_add`)
- `jobs.survey_date` (legacy single-date field) is untouched — kept for backward compatibility, no longer written by new code
- New endpoints: `GET/POST /api/jobs/:id/survey-visits`, `PATCH /api/jobs/:id/survey-visits/:visitId` (matched via regex in the routing table, placed *before* the generic `/api/jobs/:id` PATCH catch-all so they don't collide with it). Server validates job existence, staff-id existence (`validateIdsExist`, reused from the responsibility-allocation work), required date/reason/≥1 inspector, and date/time format. No DELETE endpoint (not requested — edit-with-audit-trail only, no deletion in V0.8)
- Editing a visit diffs old vs new (`updateSurveyVisit()`) and writes one activity entry per changed field (e.g. `"rajan changed Survey Visit 2 date from 2026-09-14 to 2026-09-15; inspecting staff."`); adding one writes `"{actor} added survey visit — {reason} — {date} {time}."`. Both go through a new `appendJobActivity(db, jobId, entries)` helper, since these routes are separate from `updateJob()`'s own inline activity-append logic
- New admin-only **Inspection Staff Visibility** setting (`visible`/`hidden`), backing a new generic `settings` key-value table + `GET /api/settings` (any signed-in user) + `PATCH /api/settings/:key` (admin-gated). When hidden, `listSurveyVisits()` strips `inspected_by_ids` **server-side** for non-admins (never just hidden client-side) — visit date/time/reason/remarks are always sent regardless. Toggling back to visible doesn't need to "restore" anything since the underlying rows were never touched, only omitted from the response
- `listJobs()` now does one extra query grouping all visits by `job_id` and attaches `survey_visit_count` + `last_survey_visit` `{visit_date, visit_time, reason}` (never gated — reason/date/time are never hidden) to each job in the response, so the Job Detail panel's summary needs no extra round trip
- Job Detail panel: new "Survey" section (status badge ⚪🟡🟢, visit count, last-visit line, "View Survey History" + conditional "Mark Survey Completed" buttons) — kept intentionally small, not redesigned further, per "do not overcrowd the panel." Full history/add/edit lives in its own `surveyHistoryModal` + `visitFormModal` pair, reusing the existing `chipsHtml()`/`toggleChip()` pattern for the multi-select "Persons Who Inspected" control
- All rendering/validation logic was verified via injected-fake-data DOM tests in the live browser (not real API writes) — production `jobs` row count and `survey_visits` row count were confirmed unchanged (2 and 0 respectively) before and after

## TMS V0.9 — Complete Claim Milestones (done, commit `d302e96`, migration `009_claim_milestones.sql`)

Answers "where exactly is this claim in the post-survey process?" — the full lifecycle Survey → ILA → LOR → Reminders → Documents Received → Assessment → Director Verification → Insurer Approval (conditional) → Insured Consent → FSR Preparation is now tracked, without inventing the later Document Requirement/LOR engine, FSR submission/dispatch, or billing (all explicitly deferred to later versions).

**Data model rule applied throughout**: single major milestones (ILA, LOR, Assessment, Director Verification, Insurer Approval, Insured Consent, FSR Preparation) are job-level fields; anything that repeats (Reminders, Document Receipts) is a child table with no fixed limit. 30 new `jobs` columns + 2 new tables (`claim_reminders`, `document_receipt_events`), all in `migrations/009_claim_milestones.sql`. `jobs.estimated_loss`/`gross_loss`/`claim_amount` (already existed since V0.6/V0.7) are reused for Assessment financials — only `assessed_amount` is new, per the "reuse, don't duplicate" instruction.

**Conditional Insurer Approval workflow** — the centerpiece of this version: `insurer_approval_required` is `yes`/`no`/`to_be_decided`, and the two resulting paths (with vs. without an Insurer Approval step before Insured Consent) were both verified in isolation with unit tests before deployment, specifically to confirm the "Not Required" path never gets blocked waiting on an approval that was explicitly waived. `to_be_decided` is treated as neither approved nor waived — it stays an open blocker for FSR readiness, distinctly worded ("Insurer Approval requirement still To Be Decided") from both other states.

**Server-side validation** (`validateMilestones()`, mirrors a client-side pre-check in `saveJob()` so users get instant feedback but the server is the actual authority): ILA/LOR Issue Date required when marked Issued; Director Verification Approved requires a date *and* a Verified-By who is checked against the real `staff.role` value at save time (not just filtered in the UI dropdown); Insurer Approval Approved/Partially Approved requires a date; Insured Consent Accepted requires a date; the three amount fields (`assessed_amount`, `insurer_approved_amount`, `insured_agreed_amount`) must be non-negative numbers when provided, comma-formatted Indian currency accepted. Nothing else is mandatory — TFAM often has incomplete information at any given point, matching the pattern already established in V0.7.

**Audit logging**: `saveJob()`'s `MILESTONE_FIELD_MAP` diffs all ~30 fields against the job's prior values and emits one human-readable activity line per changed field (`"{actor} changed {label} from {old} to {new}."`, with enum values translated to their display labels), rather than 30 near-duplicate `if` blocks. Two transitions get the exact spec-quoted phrasing instead of the generic template: Director Verification → Returned for Revision ("Assessment returned for revision by {name}."), and Insurer Approval Required → No ("Insurer Approval marked Not Required by {name}."). Reminders and Document Receipts log their own add/edit entries server-side (mirroring `updateSurveyVisit()`'s per-field diff pattern from V0.8) via the same `appendJobActivity()` helper, since those routes sit outside `updateJob()`.

**Job Detail panel**: the V0.8 "Survey" section is now "Claim Progress" — a compact grid showing all ten milestones at a glance (Survey/ILA/LOR/Documents/Last Reminder/Assessment/Director Verification/Insurer Approval/Insured Consent/FSR Preparation), plus buttons into the three history modals (Survey Visits, Reminders, Document Receipts — Reminders/Receipts are new, cloned from the V0.8 Survey Visit modal pattern: history list + separate add/edit form, own API endpoints). The editable milestone fields themselves (ILA & LOR, Assessment, Approvals) live in `<details>`-collapsed sections below, kept collapsed by default so the already-long panel doesn't get worse; FSR Preparation shows a live, non-blocking readiness warning (`fsrReadinessWarning()`) computed from the other milestones' current values, never hard-blocking the save.

**Verification**: no browser-testable feature in this round could be exercised via real API writes without creating production test records (explicitly forbidden), so validation logic was tested with plain Node unit tests against extracted copies of `validateMilestones()` and `fsrReadinessWarning()` (10 and 5 cases respectively, including a mocked DB for the Director-role check), and all new UI was verified via live-browser DOM tests with injected fake `jobs`/`TEAM` data (not real API calls) — screenshots confirmed the Claim Progress grid, the collapsible sections, and the Insurer-Approval-Required live field-toggle all render and behave correctly. Row counts (`jobs`=2, `claim_reminders`=0, `document_receipt_events`=0) confirmed unchanged before and after deployment.

## Not yet built / open items

The broader "Job Update" lifecycle scope beyond what V0.9 covers — FSR submission/email/hard-copy dispatch/courier/POD, billing (bill amount/fee receipt/outstanding), closure, tasks, live-working timers, the Document Requirement Master / dynamic LOR engine — was explicitly deferred by the V0.9 spec itself and remains open for later versions.

**NEXT VERSION: TMS V1.0 — FSR / Submission / Dispatch.**

## Known minor items not acted on

- `DEPLOY_1.md` is an exact duplicate of `DEPLOY.md` sitting in the repo root, untracked by git. Never resolved — user hasn't said whether to delete it or keep it.
