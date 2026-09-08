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
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
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

  const id = await nextJobId(db);
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

      return error('Not found', 404);
    } catch (e) {
      return error(e.message || 'Server error', 500);
    }
  },
};
