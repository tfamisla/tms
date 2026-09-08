// TFAM Management System — Cloudflare Worker API
// Backs the index.html frontend via the TMS_DB D1 database (see schema.sql).

// assigned = legacy catch-all list, kept for backward compatibility with
// jobs created before the 4-category assignment split.
const JSON_FIELDS = [
  'assigned', 'director_ids', 'surveyor_ids', 'branch_ids', 'backstaff_ids', 'docs', 'activity',
];
const JOB_ARRAY_FIELDS = ['assigned', 'director_ids', 'surveyor_ids', 'branch_ids', 'backstaff_ids', 'docs'];

// Plain free-text job fields — settable both at creation and via PATCH.
const JOB_TEXT_FIELDS = [
  'insurer', 'insured', 'policy_no', 'policy_name', 'policy_period_from', 'policy_period_to', 'claim_no', 'peril',
  'claim_amount', 'estimated_loss', 'gross_loss', 'department', 'appointing_office',
  'appointing_person', 'contact_person', 'contact_phone', 'address', 'district',
  'date_loss', 'date_intimation',
];

const UPDATABLE_FIELDS = [
  'title', ...JOB_TEXT_FIELDS, 'survey_date',
  'appointment_date', 'appointment_confirmed', 'stage',
  'director_ids', 'surveyor_ids', 'branch_ids', 'backstaff_ids',
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

async function listJobs(db) {
  const { results } = await db.prepare('SELECT * FROM jobs ORDER BY updated_at DESC').all();
  return results.map(rowToJob);
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

      if (pathname.startsWith('/api/jobs/') && request.method === 'PATCH') {
        const id = decodeURIComponent(pathname.slice('/api/jobs/'.length));
        const body = await request.json();
        return json(await updateJob(db, id, body));
      }

      if (pathname === '/api/log' && request.method === 'GET') {
        return json(await listLog(db));
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
