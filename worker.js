// TFAM Management System — Cloudflare Worker API
// Backs the index.html frontend via the TMS_DB D1 database (see schema.sql).

// assigned = legacy catch-all list, kept for backward compatibility with
// jobs created before the 4-category assignment split. contact_person/
// contact_phone/appointing_office = legacy single-value fields, superseded
// by `contacts` (multi-contact) and the split appointing_office_* fields —
// all kept as columns for backward compatibility but no longer written by
// the frontend.
const JSON_FIELDS = [
  'assigned', 'director_ids', 'surveyor_ids', 'branch_ids', 'backstaff_ids', 'contacts', 'docs', 'activity',
];
const JOB_ARRAY_FIELDS = [
  'assigned', 'director_ids', 'surveyor_ids', 'branch_ids', 'backstaff_ids', 'contacts', 'docs',
];

// Plain free-text job fields — settable both at creation and via PATCH.
const JOB_TEXT_FIELDS = [
  'insurer', 'insurer_branch',
  'appointing_office_address', 'appointing_office_district', 'appointing_office_state',
  'appointing_person', 'appointing_person_email', 'appointing_person_phone',
  'insured', 'address', 'district', 'insured_state', 'insured_pincode',
  'deputation_mode',
  'policy_no', 'policy_name', 'policy_period_from', 'policy_period_to', 'claim_no', 'peril',
  'item_type', 'claim_amount', 'estimated_loss', 'gross_loss', 'department',
  'date_loss', 'date_intimation',
];

const UPDATABLE_FIELDS = [
  'title', ...JOB_TEXT_FIELDS, 'survey_date', 'survey_status',
  'appointment_date', 'appointment_confirmed', 'stage',
  'director_ids', 'surveyor_ids', 'branch_ids', 'backstaff_ids', 'contacts',
  'notes', 'docs',
];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, ...extraHeaders },
  });
}

function error(message, status = 400) {
  return new Response(message, { status, headers: CORS_HEADERS });
}

function rowToJob(row) {
  const job = { ...row };
  for (const f of JSON_FIELDS) {
    try { job[f] = JSON.parse(row[f]); } catch { job[f] = f === 'docs' ? {} : []; }
  }
  job.appointment_confirmed = !!row.appointment_confirmed;
  return job;
}

async function nextJobId(db) {
  const row = await db.prepare('SELECT next_val FROM counter WHERE id = ?')
    .bind('main').first();
  const n = row ? row.next_val : 1;
  await db.prepare('UPDATE counter SET next_val = ? WHERE id = ?')
    .bind(n + 1, 'main').run();
  return `TF-${String(n).padStart(3, '0')}`;
}

// Keeps the auto-numbering counter ahead of any manually-entered TF-### id,
// so future auto-generated ids never collide with one typed in by hand.
async function bumpCounterPast(db, id) {
  const m = /^TF-(\d+)$/i.exec(id);
  if (!m) return;
  const n = parseInt(m[1], 10) + 1;
  await db.prepare('UPDATE counter SET next_val = MAX(next_val, ?) WHERE id = ?')
    .bind(n, 'main').run();
}

function slugify(name) {
  return String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

async function uniqueId(db, table, base) {
  let id = base || 'item';
  let n = 2;
  while (await db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).bind(id).first()) {
    id = `${base}-${n++}`;
  }
  return id;
}

async function validateIdsExist(db, table, ids, label) {
  if (!Array.isArray(ids) || ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  const { results } = await db.prepare(`SELECT id FROM ${table} WHERE id IN (${placeholders})`).bind(...ids).all();
  const found = new Set(results.map(r => r.id));
  const missing = ids.filter(id => !found.has(id));
  if (missing.length > 0) throw new Error(`Unknown ${label}: ${missing.join(', ')}`);
}

// Validates the 4 responsibility-allocation arrays reference real staff/branch
// rows before they're written, without enforcing role-based rules server-side
// (that's a UI concern — the selectors already filter by role).
async function validateJobAssignments(db, body) {
  if (body.director_ids !== undefined) await validateIdsExist(db, 'staff', body.director_ids, 'staff id (director)');
  if (body.surveyor_ids !== undefined) await validateIdsExist(db, 'staff', body.surveyor_ids, 'staff id (surveyor)');
  if (body.backstaff_ids !== undefined) await validateIdsExist(db, 'staff', body.backstaff_ids, 'staff id (backstaff)');
  if (body.branch_ids !== undefined) await validateIdsExist(db, 'branches', body.branch_ids, 'branch id');
}

// ISO YYYY-MM-DD strings compare correctly lexicographically.
function validatePolicyPeriod(from, to) {
  if (from && to && to < from) {
    throw new Error('Policy Period Expiry cannot be earlier than Policy Period From');
  }
}

async function listJobs(db) {
  const { results } = await db.prepare('SELECT * FROM jobs ORDER BY updated_at DESC').all();
  const { results: visits } = await db.prepare(
    'SELECT job_id, visit_date, visit_time, reason, created_at FROM survey_visits ORDER BY created_at ASC'
  ).all();
  const byJob = {};
  for (const v of visits) (byJob[v.job_id] ||= []).push(v);

  return results.map(row => {
    const job = rowToJob(row);
    const jobVisits = byJob[job.id] || [];
    job.survey_visit_count = jobVisits.length;
    const last = jobVisits[jobVisits.length - 1];
    job.last_survey_visit = last ? { visit_date: last.visit_date, visit_time: last.visit_time, reason: last.reason } : null;
    return job;
  });
}

async function listLog(db) {
  const { results } = await db.prepare('SELECT id, title, activity FROM jobs').all();
  const entries = [];
  for (const row of results) {
    let activity = [];
    try { activity = JSON.parse(row.activity); } catch { activity = []; }
    for (const e of activity) entries.push({ job_id: row.id, text: e.text, ts: e.ts, actor: e.actor });
  }
  entries.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return entries.slice(0, 500);
}

async function createJob(db, body) {
  if (!body || !body.title || !body.title.trim()) throw new Error('title is required');
  validatePolicyPeriod(body.policy_period_from, body.policy_period_to);
  await validateJobAssignments(db, body);

  let id;
  if (body.id && body.id.trim()) {
    id = body.id.trim();
    const existing = await db.prepare('SELECT 1 FROM jobs WHERE id = ?').bind(id).first();
    if (existing) throw new Error(`Job ID "${id}" already exists — pick a different number`);
    await bumpCounterPast(db, id);
  } else {
    id = await nextJobId(db);
  }
  const now = Date.now();
  const actor = body.created_by || 'unknown';
  const activity = [{ text: `Job ${id} created`, ts: now, actor }];

  const job = {
    id,
    title: body.title.trim(),
    survey_date: '',
    appointment_date: '',
    appointment_confirmed: 0,
    stage: 'new_claim',
    assigned: JSON.stringify([]),
    director_ids: JSON.stringify(Array.isArray(body.director_ids) ? body.director_ids : []),
    surveyor_ids: JSON.stringify(Array.isArray(body.surveyor_ids) ? body.surveyor_ids : []),
    branch_ids: JSON.stringify(Array.isArray(body.branch_ids) ? body.branch_ids : []),
    backstaff_ids: JSON.stringify(Array.isArray(body.backstaff_ids) ? body.backstaff_ids : []),
    contacts: JSON.stringify(Array.isArray(body.contacts) ? body.contacts : []),
    notes: '',
    docs: JSON.stringify({}),
    activity: JSON.stringify(activity),
    created_at: now,
    updated_at: now,
  };
  for (const f of JOB_TEXT_FIELDS) job[f] = body[f] || '';

  const columns = Object.keys(job);
  await db.prepare(
    `INSERT INTO jobs (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(',')})`
  ).bind(...columns.map(c => job[c])).run();

  return rowToJob(job);
}

async function updateJob(db, id, body) {
  const existing = await db.prepare('SELECT * FROM jobs WHERE id = ?').bind(id).first();
  if (!existing) throw new Error('job not found');
  const effectiveFrom = body.policy_period_from !== undefined ? body.policy_period_from : existing.policy_period_from;
  const effectiveTo   = body.policy_period_to   !== undefined ? body.policy_period_to   : existing.policy_period_to;
  validatePolicyPeriod(effectiveFrom, effectiveTo);
  await validateJobAssignments(db, body);

  const sets = [];
  const values = [];

  for (const field of UPDATABLE_FIELDS) {
    if (body[field] === undefined) continue;
    let value = body[field];
    if (JOB_ARRAY_FIELDS.includes(field)) value = JSON.stringify(value);
    if (field === 'appointment_confirmed') value = value ? 1 : 0;
    sets.push(`${field} = ?`);
    values.push(value);
  }

  let activity = [];
  try { activity = JSON.parse(existing.activity); } catch { activity = []; }
  if (Array.isArray(body.activity_add)) activity.push(...body.activity_add);
  sets.push('activity = ?');
  values.push(JSON.stringify(activity));

  const now = Date.now();
  sets.push('updated_at = ?');
  values.push(now);

  values.push(id);
  await db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();

  const updated = await db.prepare('SELECT * FROM jobs WHERE id = ?').bind(id).first();
  return rowToJob(updated);
}

// Appends entries to a job's activity log outside the generic updateJob
// path (used by survey-visit handlers, which live on their own routes).
async function appendJobActivity(db, jobId, entries) {
  const job = await db.prepare('SELECT activity FROM jobs WHERE id = ?').bind(jobId).first();
  if (!job) return;
  let activity = [];
  try { activity = JSON.parse(job.activity); } catch { activity = []; }
  activity.push(...entries);
  await db.prepare('UPDATE jobs SET activity = ?, updated_at = ? WHERE id = ?')
    .bind(JSON.stringify(activity), Date.now(), jobId).run();
}

function rowToVisit(row, canSeeInspectors) {
  const visit = { ...row };
  try { visit.inspected_by_ids = JSON.parse(row.inspected_by_ids); } catch { visit.inspected_by_ids = []; }
  if (!canSeeInspectors) visit.inspected_by_ids = [];
  return visit;
}

const VISIT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VISIT_TIME_RE = /^\d{2}:\d{2}$/;

async function listSurveyVisits(db, jobId, canSeeInspectors) {
  const { results } = await db.prepare(
    'SELECT * FROM survey_visits WHERE job_id = ? ORDER BY created_at ASC'
  ).bind(jobId).all();
  return results.map(r => rowToVisit(r, canSeeInspectors));
}

function formatVisitWhen(date, time) {
  return time ? `${date} ${time}` : date;
}

async function createSurveyVisit(db, jobId, body, user) {
  const job = await db.prepare('SELECT id, survey_status FROM jobs WHERE id = ?').bind(jobId).first();
  if (!job) throw new Error('job not found');

  const visitDate = (body.visit_date || '').trim();
  const visitTime = (body.visit_time || '').trim();
  const reason = (body.reason || '').trim();
  const inspectedBy = Array.isArray(body.inspected_by_ids) ? body.inspected_by_ids : [];
  const remarks = (body.remarks || '').trim();

  if (!VISIT_DATE_RE.test(visitDate)) throw new Error('A valid visit date (YYYY-MM-DD) is required');
  if (!reason) throw new Error('Reason for visit is required');
  if (inspectedBy.length === 0) throw new Error('At least one inspecting staff member is required');
  if (visitTime && !VISIT_TIME_RE.test(visitTime)) throw new Error('Visit time must be in HH:MM format');
  await validateIdsExist(db, 'staff', inspectedBy, 'inspecting staff id');

  const now = Date.now();
  const id = `SV-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const visit = {
    id, job_id: jobId, visit_date: visitDate, visit_time: visitTime, reason,
    inspected_by_ids: JSON.stringify(inspectedBy), remarks,
    created_by: user.id, created_at: now, updated_at: now,
  };

  await db.prepare(`
    INSERT INTO survey_visits (id, job_id, visit_date, visit_time, reason, inspected_by_ids, remarks, created_by, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).bind(visit.id, visit.job_id, visit.visit_date, visit.visit_time, visit.reason,
    visit.inspected_by_ids, visit.remarks, visit.created_by, visit.created_at, visit.updated_at).run();

  // Adding a visit means the survey process is (still) underway — never
  // silently assume a single visit finishes the job; only an explicit
  // "Mark Survey Completed" action can set status to 'completed'. A new
  // visit added after completion re-opens it, since further work is
  // clearly happening.
  if (job.survey_status !== 'in_progress') {
    await db.prepare('UPDATE jobs SET survey_status = ? WHERE id = ?').bind('in_progress', jobId).run();
  }

  await appendJobActivity(db, jobId, [{
    text: `${user.id} added survey visit — ${reason} — ${formatVisitWhen(visitDate, visitTime)}.`,
    ts: now, actor: user.id,
  }]);

  return rowToVisit(visit, true);
}

const VISIT_FIELD_LABELS = {
  visit_date: 'date', visit_time: 'time', reason: 'reason',
  inspected_by_ids: 'inspecting staff', remarks: 'remarks',
};

async function updateSurveyVisit(db, jobId, visitId, body, user) {
  const existing = await db.prepare('SELECT * FROM survey_visits WHERE id = ? AND job_id = ?')
    .bind(visitId, jobId).first();
  if (!existing) throw new Error('survey visit not found');

  const next = {
    visit_date: body.visit_date !== undefined ? String(body.visit_date).trim() : existing.visit_date,
    visit_time: body.visit_time !== undefined ? String(body.visit_time).trim() : existing.visit_time,
    reason: body.reason !== undefined ? String(body.reason).trim() : existing.reason,
    inspected_by_ids: body.inspected_by_ids !== undefined
      ? (Array.isArray(body.inspected_by_ids) ? body.inspected_by_ids : [])
      : JSON.parse(existing.inspected_by_ids || '[]'),
    remarks: body.remarks !== undefined ? String(body.remarks).trim() : existing.remarks,
  };

  if (!VISIT_DATE_RE.test(next.visit_date)) throw new Error('A valid visit date (YYYY-MM-DD) is required');
  if (!next.reason) throw new Error('Reason for visit is required');
  if (next.inspected_by_ids.length === 0) throw new Error('At least one inspecting staff member is required');
  if (next.visit_time && !VISIT_TIME_RE.test(next.visit_time)) throw new Error('Visit time must be in HH:MM format');
  await validateIdsExist(db, 'staff', next.inspected_by_ids, 'inspecting staff id');

  const { results: allVisits } = await db.prepare(
    'SELECT id FROM survey_visits WHERE job_id = ? ORDER BY created_at ASC'
  ).bind(jobId).all();
  const visitNumber = allVisits.findIndex(v => v.id === visitId) + 1;

  const changeLines = [];
  const oldInspected = JSON.parse(existing.inspected_by_ids || '[]');
  if (next.visit_date !== existing.visit_date) changeLines.push(`date from ${existing.visit_date} to ${next.visit_date}`);
  if (next.visit_time !== (existing.visit_time || '')) changeLines.push(`time from "${existing.visit_time||'—'}" to "${next.visit_time||'—'}"`);
  if (next.reason !== existing.reason) changeLines.push(`reason from "${existing.reason}" to "${next.reason}"`);
  if (JSON.stringify(oldInspected.slice().sort()) !== JSON.stringify(next.inspected_by_ids.slice().sort())) {
    changeLines.push('inspecting staff');
  }
  if (next.remarks !== (existing.remarks || '')) changeLines.push('remarks');

  const now = Date.now();
  await db.prepare(`
    UPDATE survey_visits SET visit_date=?, visit_time=?, reason=?, inspected_by_ids=?, remarks=?, updated_at=?
    WHERE id = ?
  `).bind(next.visit_date, next.visit_time, next.reason, JSON.stringify(next.inspected_by_ids), next.remarks, now, visitId).run();

  if (changeLines.length > 0) {
    await appendJobActivity(db, jobId, [{
      text: `${user.id} changed Survey Visit ${visitNumber} ${changeLines.join('; ')}.`,
      ts: now, actor: user.id,
    }]);
  }

  const updated = await db.prepare('SELECT * FROM survey_visits WHERE id = ?').bind(visitId).first();
  return rowToVisit(updated, true);
}

async function getSetting(db, key) {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  return row ? row.value : null;
}

async function listSettings(db) {
  const { results } = await db.prepare('SELECT key, value FROM settings').all();
  const out = {};
  for (const r of results) out[r.key] = r.value;
  return out;
}

async function updateSetting(db, key, value) {
  await db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, value).run();
  return { key, value };
}

const STAFF_COLORS = [
  '#6B7AFF', '#F59E0B', '#10B981', '#8B5CF6', '#EF4444',
  '#0EA5E9', '#F97316', '#06B6D4', '#22C55E', '#EC4899', '#D97706',
];

function initialsFor(name) {
  const parts = String(name).trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
}

// ── AUTH ─────────────────────────────────────────────────────
const SESSION_COOKIE = 'tms_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function b64(bytes) { return btoa(String.fromCharCode(...bytes)); }
function unb64(str) { return Uint8Array.from(atob(str), c => c.charCodeAt(0)); }

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
  return `${b64(salt)}:${b64(new Uint8Array(bits))}`;
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifyPassword(password, stored) {
  if (!stored) return false;
  const [saltB64, hashB64] = stored.split(':');
  if (!saltB64 || !hashB64) return false;
  const salt = unb64(saltB64);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
  return timingSafeEqual(b64(new Uint8Array(bits)), hashB64);
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return b64(bytes).replace(/[+/=]/g, c => ({ '+': '-', '/': '_', '=': '' }[c]));
}

function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function setSessionCookie(token, maxAgeSeconds) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

async function createSession(db, staffId) {
  const token = randomToken();
  const now = Date.now();
  await db.prepare('INSERT INTO sessions (token, staff_id, created_at, expires_at) VALUES (?,?,?,?)')
    .bind(token, staffId, now, now + SESSION_TTL_MS).run();
  return token;
}

async function getSessionUser(db, request) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const session = await db.prepare('SELECT * FROM sessions WHERE token = ?').bind(token).first();
  if (!session || session.expires_at < Date.now()) return null;
  return db.prepare('SELECT id, name, role, access_role, initials, color FROM staff WHERE id = ?')
    .bind(session.staff_id).first();
}

function isAdmin(user) {
  return !!user && (user.id === 'rajan' || user.access_role === 'admin');
}

async function listRoster(db) {
  const { results } = await db.prepare('SELECT id, name FROM staff ORDER BY created_at ASC').all();
  return results;
}

async function login(db, body) {
  if (!body || !body.id || !body.password) throw new Error('id and password are required');
  const user = await db.prepare('SELECT * FROM staff WHERE id = ?').bind(body.id).first();
  if (!user) throw new Error('Unknown user');

  if (!user.password_hash) {
    // No one has a password yet on a fresh install. Only the permanent
    // super admin (rajanaren) may self-activate; everyone else must be
    // given a password by an admin via the Staff screen.
    if (user.id !== 'rajan') {
      throw new Error('Account not yet activated — ask your admin to set your password');
    }
    if (body.password.length < 6) throw new Error('Password must be at least 6 characters');
    user.password_hash = await hashPassword(body.password);
    await db.prepare('UPDATE staff SET password_hash = ?, access_role = ? WHERE id = ?')
      .bind(user.password_hash, 'admin', user.id).run();
  } else {
    const ok = await verifyPassword(body.password, user.password_hash);
    if (!ok) throw new Error('Incorrect password');
  }

  const token = await createSession(db, user.id);
  const { password_hash, ...safe } = user;
  return { user: safe, cookie: setSessionCookie(token, SESSION_TTL_MS / 1000) };
}

async function changePassword(db, user, body) {
  if (!body || !body.newPassword || body.newPassword.length < 6) {
    throw new Error('New password must be at least 6 characters');
  }
  const row = await db.prepare('SELECT * FROM staff WHERE id = ?').bind(user.id).first();
  if (row.password_hash) {
    if (!body.oldPassword || !(await verifyPassword(body.oldPassword, row.password_hash))) {
      throw new Error('Current password is incorrect');
    }
  }
  const hash = await hashPassword(body.newPassword);
  await db.prepare('UPDATE staff SET password_hash = ? WHERE id = ?').bind(hash, user.id).run();
}

// ── STAFF ────────────────────────────────────────────────────
async function listStaff(db) {
  const { results } = await db.prepare(
    'SELECT id, name, role, access_role, initials, color, created_at FROM staff ORDER BY created_at ASC'
  ).all();
  return results;
}

async function createStaff(db, body) {
  if (!body || !body.name || !body.name.trim()) throw new Error('name is required');

  const name = body.name.trim();
  const id = await uniqueId(db, 'staff', slugify(name));
  const now = Date.now();
  const { count } = await db.prepare('SELECT COUNT(*) as count FROM staff').first();
  const staffMember = {
    id,
    name,
    role: (body.role || '').trim(),
    access_role: body.access_role === 'admin' ? 'admin' : 'staff',
    initials: (body.initials || initialsFor(name)).trim().toUpperCase().slice(0, 3),
    color: body.color || STAFF_COLORS[count % STAFF_COLORS.length],
    created_at: now,
  };
  const password_hash = body.password ? await hashPassword(body.password) : null;

  await db.prepare(`
    INSERT INTO staff (id, name, role, access_role, initials, color, created_at, password_hash)
    VALUES (?,?,?,?,?,?,?,?)
  `).bind(staffMember.id, staffMember.name, staffMember.role, staffMember.access_role,
    staffMember.initials, staffMember.color, staffMember.created_at, password_hash).run();

  return staffMember;
}

const STAFF_UPDATABLE_FIELDS = ['name', 'role', 'initials', 'color'];

async function updateStaff(db, id, body) {
  const existing = await db.prepare('SELECT * FROM staff WHERE id = ?').bind(id).first();
  if (!existing) throw new Error('staff member not found');

  const sets = [];
  const values = [];
  for (const field of STAFF_UPDATABLE_FIELDS) {
    if (body[field] === undefined) continue;
    let value = String(body[field]).trim();
    if (field === 'name' && !value) throw new Error('name is required');
    if (field === 'initials') value = value.toUpperCase().slice(0, 3);
    sets.push(`${field} = ?`);
    values.push(value);
  }

  if (body.access_role !== undefined) {
    // rajanaren is the permanent super admin and can never be demoted.
    const access_role = id === 'rajan' ? 'admin' : (body.access_role === 'admin' ? 'admin' : 'staff');
    sets.push('access_role = ?');
    values.push(access_role);
  }

  if (body.password) {
    if (body.password.length < 6) throw new Error('Password must be at least 6 characters');
    sets.push('password_hash = ?');
    values.push(await hashPassword(body.password));
  }

  if (sets.length === 0) return existing;

  values.push(id);
  await db.prepare(`UPDATE staff SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();

  const { password_hash, ...safe } = await db.prepare('SELECT * FROM staff WHERE id = ?').bind(id).first();
  return safe;
}

async function deleteStaff(db, id) {
  if (id === 'rajan') throw new Error('The super admin account cannot be deleted');
  const existing = await db.prepare('SELECT 1 FROM staff WHERE id = ?').bind(id).first();
  if (!existing) throw new Error('staff member not found');
  await db.prepare('DELETE FROM staff WHERE id = ?').bind(id).run();
  await db.prepare('DELETE FROM sessions WHERE staff_id = ?').bind(id).run();
}

// ── INSURERS ─────────────────────────────────────────────────
function acronymFor(name) {
  const words = String(name).trim().split(/\s+/);
  let ac = words.map(w => w[0] || '').join('').toUpperCase();
  if (ac.length < 2) ac = String(name).toUpperCase().replace(/[^A-Z]/g, '');
  return ac.slice(0, 5);
}

async function listInsurers(db) {
  const { results } = await db.prepare('SELECT * FROM insurers ORDER BY name ASC').all();
  return results;
}

async function createInsurer(db, body) {
  if (!body || !body.name || !body.name.trim()) throw new Error('name is required');

  const name = body.name.trim();
  const existing = await db.prepare('SELECT * FROM insurers WHERE name = ? COLLATE NOCASE').bind(name).first();
  if (existing) return existing;

  const id = await uniqueId(db, 'insurers', slugify(name));
  const now = Date.now();
  const acronym = (body.acronym || acronymFor(name)).trim().toUpperCase().slice(0, 5);
  const insurer = { id, name, acronym, created_at: now };

  await db.prepare('INSERT INTO insurers (id, name, acronym, created_at) VALUES (?,?,?,?)')
    .bind(insurer.id, insurer.name, insurer.acronym, insurer.created_at).run();

  return insurer;
}

const INSURER_UPDATABLE_FIELDS = ['name', 'acronym'];

async function updateInsurer(db, id, body) {
  const existing = await db.prepare('SELECT * FROM insurers WHERE id = ?').bind(id).first();
  if (!existing) throw new Error('insurer not found');

  const sets = [];
  const values = [];
  for (const field of INSURER_UPDATABLE_FIELDS) {
    if (body[field] === undefined) continue;
    let value = String(body[field]).trim();
    if (field === 'name' && !value) throw new Error('name is required');
    if (field === 'acronym') value = value.toUpperCase().slice(0, 5);
    sets.push(`${field} = ?`);
    values.push(value);
  }
  if (sets.length === 0) return existing;

  values.push(id);
  await db.prepare(`UPDATE insurers SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();

  return db.prepare('SELECT * FROM insurers WHERE id = ?').bind(id).first();
}

async function deleteInsurer(db, id) {
  const existing = await db.prepare('SELECT 1 FROM insurers WHERE id = ?').bind(id).first();
  if (!existing) throw new Error('insurer not found');
  await db.prepare('DELETE FROM insurers WHERE id = ?').bind(id).run();
}

// ── TFAM BRANCHES ────────────────────────────────────────────
async function listBranches(db) {
  const { results } = await db.prepare('SELECT * FROM branches ORDER BY name ASC').all();
  return results;
}

async function createBranch(db, body) {
  if (!body || !body.name || !body.name.trim()) throw new Error('name is required');

  const name = body.name.trim();
  const existing = await db.prepare('SELECT 1 FROM branches WHERE name = ? COLLATE NOCASE').bind(name).first();
  if (existing) throw new Error(`A branch named "${name}" already exists`);

  const id = await uniqueId(db, 'branches', slugify(name));
  const now = Date.now();
  const { count } = await db.prepare('SELECT COUNT(*) as count FROM branches').first();
  const branch = { id, name, color: body.color || STAFF_COLORS[count % STAFF_COLORS.length], created_at: now };

  await db.prepare('INSERT INTO branches (id, name, color, created_at) VALUES (?,?,?,?)')
    .bind(branch.id, branch.name, branch.color, branch.created_at).run();

  return branch;
}

const BRANCH_UPDATABLE_FIELDS = ['name', 'color'];

async function updateBranch(db, id, body) {
  const existing = await db.prepare('SELECT * FROM branches WHERE id = ?').bind(id).first();
  if (!existing) throw new Error('branch not found');

  const sets = [];
  const values = [];
  for (const field of BRANCH_UPDATABLE_FIELDS) {
    if (body[field] === undefined) continue;
    const value = String(body[field]).trim();
    if (field === 'name') {
      if (!value) throw new Error('name is required');
      const dup = await db.prepare('SELECT 1 FROM branches WHERE name = ? COLLATE NOCASE AND id != ?')
        .bind(value, id).first();
      if (dup) throw new Error(`A branch named "${value}" already exists`);
    }
    sets.push(`${field} = ?`);
    values.push(value);
  }
  if (sets.length === 0) return existing;

  values.push(id);
  await db.prepare(`UPDATE branches SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();

  return db.prepare('SELECT * FROM branches WHERE id = ?').bind(id).first();
}

async function deleteBranch(db, id) {
  const existing = await db.prepare('SELECT 1 FROM branches WHERE id = ?').bind(id).first();
  if (!existing) throw new Error('branch not found');
  await db.prepare('DELETE FROM branches WHERE id = ?').bind(id).run();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const db = env.TMS_DB;

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    try {
      // ── Public auth routes (no session required) ──
      if (pathname === '/api/auth/roster' && request.method === 'GET') {
        return json(await listRoster(db));
      }

      if (pathname === '/api/auth/login' && request.method === 'POST') {
        const body = await request.json();
        const { user, cookie } = await login(db, body);
        return json(user, 200, { 'Set-Cookie': cookie });
      }

      // ── Everything below requires a logged-in session ──
      const user = await getSessionUser(db, request);
      if (!user) return error('Not authenticated', 401);

      if (pathname === '/api/auth/me' && request.method === 'GET') {
        return json(user);
      }

      if (pathname === '/api/auth/logout' && request.method === 'POST') {
        const token = getCookie(request, SESSION_COOKIE);
        if (token) await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
        return json({ ok: true }, 200, { 'Set-Cookie': setSessionCookie('', 0) });
      }

      if (pathname === '/api/auth/change-password' && request.method === 'POST') {
        const body = await request.json();
        await changePassword(db, user, body);
        return json({ ok: true });
      }

      if (pathname === '/api/jobs' && request.method === 'GET') {
        return json(await listJobs(db));
      }

      if (pathname === '/api/jobs' && request.method === 'POST') {
        const body = await request.json();
        return json(await createJob(db, body), 201);
      }

      {
        const visitCollectionMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/survey-visits\/?$/);
        if (visitCollectionMatch) {
          const jobId = decodeURIComponent(visitCollectionMatch[1]);
          const visibility = await getSetting(db, 'inspection_staff_visibility');
          const canSeeInspectors = isAdmin(user) || visibility !== 'hidden';

          if (request.method === 'GET') {
            return json(await listSurveyVisits(db, jobId, canSeeInspectors));
          }
          if (request.method === 'POST') {
            const body = await request.json();
            return json(await createSurveyVisit(db, jobId, body, user), 201);
          }
        }

        const visitItemMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/survey-visits\/([^/]+)$/);
        if (visitItemMatch && request.method === 'PATCH') {
          const jobId = decodeURIComponent(visitItemMatch[1]);
          const visitId = decodeURIComponent(visitItemMatch[2]);
          const body = await request.json();
          return json(await updateSurveyVisit(db, jobId, visitId, body, user));
        }
      }

      if (pathname.startsWith('/api/jobs/') && request.method === 'PATCH') {
        const id = decodeURIComponent(pathname.slice('/api/jobs/'.length));
        const body = await request.json();
        return json(await updateJob(db, id, body));
      }

      if (pathname === '/api/log' && request.method === 'GET') {
        return json(await listLog(db));
      }

      if (pathname === '/api/settings' && request.method === 'GET') {
        return json(await listSettings(db));
      }

      if (pathname.startsWith('/api/settings/') && request.method === 'PATCH') {
        if (!isAdmin(user)) return error('Admin access required', 403);
        const key = decodeURIComponent(pathname.slice('/api/settings/'.length));
        const body = await request.json();
        return json(await updateSetting(db, key, String(body.value)));
      }

      if (pathname === '/api/staff' && request.method === 'GET') {
        return json(await listStaff(db));
      }

      if (pathname === '/api/staff' && request.method === 'POST') {
        if (!isAdmin(user)) return error('Admin access required', 403);
        const body = await request.json();
        return json(await createStaff(db, body), 201);
      }

      if (pathname.startsWith('/api/staff/') && request.method === 'PATCH') {
        if (!isAdmin(user)) return error('Admin access required', 403);
        const id = decodeURIComponent(pathname.slice('/api/staff/'.length));
        const body = await request.json();
        return json(await updateStaff(db, id, body));
      }

      if (pathname.startsWith('/api/staff/') && request.method === 'DELETE') {
        if (!isAdmin(user)) return error('Admin access required', 403);
        const id = decodeURIComponent(pathname.slice('/api/staff/'.length));
        await deleteStaff(db, id);
        return json({ ok: true });
      }

      if (pathname === '/api/insurers' && request.method === 'GET') {
        return json(await listInsurers(db));
      }

      if (pathname === '/api/insurers' && request.method === 'POST') {
        const body = await request.json();
        return json(await createInsurer(db, body), 201);
      }

      if (pathname.startsWith('/api/insurers/') && request.method === 'PATCH') {
        const id = decodeURIComponent(pathname.slice('/api/insurers/'.length));
        const body = await request.json();
        return json(await updateInsurer(db, id, body));
      }

      if (pathname.startsWith('/api/insurers/') && request.method === 'DELETE') {
        const id = decodeURIComponent(pathname.slice('/api/insurers/'.length));
        await deleteInsurer(db, id);
        return json({ ok: true });
      }

      if (pathname === '/api/branches' && request.method === 'GET') {
        return json(await listBranches(db));
      }

      if (pathname === '/api/branches' && request.method === 'POST') {
        if (!isAdmin(user)) return error('Admin access required', 403);
        const body = await request.json();
        return json(await createBranch(db, body), 201);
      }

      if (pathname.startsWith('/api/branches/') && request.method === 'PATCH') {
        if (!isAdmin(user)) return error('Admin access required', 403);
        const id = decodeURIComponent(pathname.slice('/api/branches/'.length));
        const body = await request.json();
        return json(await updateBranch(db, id, body));
      }

      if (pathname.startsWith('/api/branches/') && request.method === 'DELETE') {
        if (!isAdmin(user)) return error('Admin access required', 403);
        const id = decodeURIComponent(pathname.slice('/api/branches/'.length));
        await deleteBranch(db, id);
        return json({ ok: true });
      }

      return error('Not found', 404);
    } catch (e) {
      return error(e.message || 'Server error', 500);
    }
  },
};
