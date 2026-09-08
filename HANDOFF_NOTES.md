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

## Not yet built / open items

None currently pending — all requested features as of 2026-09-09 are implemented and deployed.

## Known minor items not acted on

- `DEPLOY_1.md` is an exact duplicate of `DEPLOY.md` sitting in the repo root, untracked by git. Never resolved — user hasn't said whether to delete it or keep it.
