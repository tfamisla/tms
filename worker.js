// TFAM Management System — Cloudflare Worker API
// Backs the index.html frontend via the TMS_DB D1 database (see schema.sql).

const JSON_FIELDS = ['assigned', 'docs', 'activity'];

const UPDATABLE_FIELDS = [
  'title', 'insurer', 'insured', 'policy_no', 'claim_no', 'peril',
  'claim_amount', 'date_loss', 'date_intimation', 'survey_date',
  'appointment_date', 'appointment_confirmed', 'stage', 'assigned',
  'notes', 'docs',
];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
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
    insurer: body.insurer || '',
    insured: body.insured || '',
    policy_no: body.policy_no || '',
    claim_no: body.claim_no || '',
    peril: body.peril || '',
    claim_amount: body.claim_amount || '',
    date_loss: body.date_loss || '',
    date_intimation: body.date_intimation || '',
    survey_date: '',
    appointment_date: '',
    appointment_confirmed: 0,
    stage: 'new_claim',
    assigned: JSON.stringify(Array.isArray(body.assigned) ? body.assigned : []),
    notes: '',
    docs: JSON.stringify({}),
    activity: JSON.stringify(activity),
    created_at: now,
    updated_at: now,
  };

  await db.prepare(`
    INSERT INTO jobs (id, title, insurer, insured, policy_no, claim_no, peril,
      claim_amount, date_loss, date_intimation, survey_date, appointment_date,
      appointment_confirmed, stage, assigned, notes, docs, activity, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    job.id, job.title, job.insurer, job.insured, job.policy_no, job.claim_no, job.peril,
    job.claim_amount, job.date_loss, job.date_intimation, job.survey_date, job.appointment_date,
    job.appointment_confirmed, job.stage, job.assigned, job.notes, job.docs, job.activity,
    job.created_at, job.updated_at
  ).run();

  return rowToJob(job);
}

async function updateJob(db, id, body) {
  const existing = await db.prepare('SELECT * FROM jobs WHERE id = ?').bind(id).first();
  if (!existing) throw new Error('job not found');

  const sets = [];
  const values = [];

  for (const field of UPDATABLE_FIELDS) {
    if (body[field] === undefined) continue;
    let value = body[field];
    if (field === 'assigned' || field === 'docs') value = JSON.stringify(value);
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

async function listStaff(db) {
  const { results } = await db.prepare('SELECT * FROM staff ORDER BY created_at ASC').all();
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
    initials: (body.initials || initialsFor(name)).trim().toUpperCase().slice(0, 3),
    color: body.color || STAFF_COLORS[count % STAFF_COLORS.length],
    created_at: now,
  };

  await db.prepare(`
    INSERT INTO staff (id, name, role, initials, color, created_at) VALUES (?,?,?,?,?,?)
  `).bind(staffMember.id, staffMember.name, staffMember.role, staffMember.initials,
    staffMember.color, staffMember.created_at).run();

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
  if (sets.length === 0) return existing;

  values.push(id);
  await db.prepare(`UPDATE staff SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();

  return db.prepare('SELECT * FROM staff WHERE id = ?').bind(id).first();
}

async function deleteStaff(db, id) {
  const existing = await db.prepare('SELECT 1 FROM staff WHERE id = ?').bind(id).first();
  if (!existing) throw new Error('staff member not found');
  await db.prepare('DELETE FROM staff WHERE id = ?').bind(id).run();
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
  const insurer = { id, name, created_at: now };

  await db.prepare('INSERT INTO insurers (id, name, created_at) VALUES (?,?,?)')
    .bind(insurer.id, insurer.name, insurer.created_at).run();

  return insurer;
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
        const body = await request.json();
        return json(await createStaff(db, body), 201);
      }

      if (pathname.startsWith('/api/staff/') && request.method === 'PATCH') {
        const id = decodeURIComponent(pathname.slice('/api/staff/'.length));
        const body = await request.json();
        return json(await updateStaff(db, id, body));
      }

      if (pathname.startsWith('/api/staff/') && request.method === 'DELETE') {
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

      return error('Not found', 404);
    } catch (e) {
      return error(e.message || 'Server error', 500);
    }
  },
};
