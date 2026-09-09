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

// Claim milestone fields (V0.9) — updatable via PATCH but deliberately kept
// out of JOB_TEXT_FIELDS/createJob's default-to-'' loop, since each has a
// meaningful non-empty SQL default (e.g. 'to_be_decided', 'not_started');
// a brand-new job should get those defaults, not blank strings.
// V1.1A removed ila_remarks/lor_remarks/assessment_remarks/
// insurer_approved_amount/insurer_approval_remarks/insured_agreed_amount/
// insured_consent_remarks from active collection (simplification release —
// these fields are no longer operationally needed). The underlying jobs
// columns are NOT dropped (existing historical values stay intact), they're
// simply no longer written by new saves.
const MILESTONE_FIELDS = [
  'ila_required', 'ila_issued', 'ila_issue_date',
  'lor_required', 'lor_issued', 'lor_issue_date',
  'reminder_frequency', 'reminder_frequency_custom_days',
  'assessment_status', 'assessment_prepared_date', 'assessed_amount',
  'director_verification_status', 'director_verification_date', 'director_verified_by', 'director_verification_remarks',
  'insurer_approval_required', 'insurer_approval_status', 'insurer_approval_date',
  'insured_consent_status', 'insured_consent_date',
  'fsr_preparation_status', 'fsr_preparation_date', 'fsr_preparation_remarks',
];

// FSR final verification / submission / dispatch / POD fields (V1.0) —
// same reasoning as MILESTONE_FIELDS: meaningful non-'' SQL defaults.
// V1.1A removed fsr_submission_remarks/dispatch_remarks/pod_remarks from
// active collection — same dormant-column treatment as MILESTONE_FIELDS above.
const FINAL_REPORT_FIELDS = [
  'fsr_final_verification_status', 'fsr_final_verification_date',
  'fsr_final_verified_by', 'fsr_final_verification_remarks',
  'fsr_submitted', 'fsr_submission_date', 'fsr_submission_mode',
  'mail_sent_date',
  'hard_copy_required', 'hard_copy_sent', 'hard_copy_sent_date',
  'courier_company', 'awb_tracking_no',
  'pod_status', 'pod_date',
];

// Billing fields (V1.1, revised V1.1A) — live in the `job_billing` sidecar
// table, NOT as jobs columns (jobs was already at the D1 ~100-column-per-
// table limit; see HANDOFF_NOTES.md). V1.1A replaces the simplified
// `bill_amount` with the real TFAM invoice inputs `professional_fees` +
// `expenses` (Base Total/GST/Invoice Value are always derived from these,
// never stored) and drops `billing_remarks` from active collection (both
// old columns stay in job_billing as dormant/legacy fields). Deliberately
// excludes closure_date/closed_by/closure_remarks, which only the
// dedicated POST /api/jobs/:id/close endpoint may ever write (never the
// generic job PATCH). Handled separately from UPDATABLE_FIELDS via
// upsertJobBilling(), not the generic jobs SET loop.
const BILLING_FIELDS = ['bill_required', 'bill_date', 'bill_number', 'professional_fees', 'expenses'];

const UPDATABLE_FIELDS = [
  'title', ...JOB_TEXT_FIELDS, 'survey_date', 'survey_status',
  'appointment_date', 'appointment_confirmed', 'stage',
  'director_ids', 'surveyor_ids', 'branch_ids', 'backstaff_ids', 'contacts',
  ...MILESTONE_FIELDS, ...FINAL_REPORT_FIELDS,
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

function isNonNegativeNumber(v) {
  if (!v) return true; // blank is allowed — TFAM often has incomplete info
  const n = Number(String(v).replace(/,/g, ''));
  return !isNaN(n) && n >= 0;
}

// ── CURRENCY (V1.1) ───────────────────────────────────────────────
// All billing math happens in integer paise to avoid floating-point drift;
// rupee strings (possibly comma-formatted) are only ever the input/output
// format at the edges.
function toPaise(v) {
  if (!v) return 0;
  const n = parseFloat(String(v).replace(/,/g, ''));
  if (isNaN(n)) return 0;
  return Math.round(n * 100);
}
function isPositiveNumber(v) {
  if (v === undefined || v === null || v === '') return false;
  const n = Number(String(v).replace(/,/g, ''));
  return !isNaN(n) && n > 0;
}
function formatINR(paise) {
  return '₹' + (Math.round(paise) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

// TFAM invoice structure (V1.1A) — Base Total / GST / Total Invoice Value
// are always derived from Professional Fees + Expenses, never stored or
// user-editable. GST is fixed at 18% — no rate selector, no manual GST entry.
function computeInvoiceTotals(job) {
  const professionalFeesPaise = toPaise(job.professional_fees);
  const expensesPaise = toPaise(job.expenses);
  const baseTotalPaise = professionalFeesPaise + expensesPaise;
  const gstPaise = Math.round(baseTotalPaise * 0.18);
  const invoiceTotalPaise = baseTotalPaise + gstPaise;
  return { professionalFeesPaise, expensesPaise, baseTotalPaise, gstPaise, invoiceTotalPaise };
}

// Settlement (V1.1A) = Received + TDS Deducted + Write-off — TDS and
// Write-off are always manual entry, TMS never calculates or assumes a TDS
// percentage or write-off amount. Payment Status / Closure Eligibility are
// calculated here — never stored — from the job's current invoice fields
// plus the authoritative sums of its fee_receipts. `sums` must come from a
// fresh SUM query, not client state.
function computeBilling(job, sums) {
  const { receivedPaise, tdsPaise, writeoffPaise } = sums;
  const billRequired = job.bill_required || 'to_be_decided';
  const invoice = computeInvoiceTotals(job);
  const accountedPaise = receivedPaise + tdsPaise + writeoffPaise;
  let paymentStatus = 'to_be_decided';
  let outstandingPaise = 0;
  let excessPaise = 0;
  let financiallyEligible = false;
  const invoiceComplete = !!job.bill_date && invoice.baseTotalPaise > 0;

  if (billRequired === 'no') {
    paymentStatus = 'not_required';
    financiallyEligible = true;
  } else if (billRequired === 'to_be_decided') {
    paymentStatus = 'to_be_decided';
  } else if (!invoiceComplete) {
    paymentStatus = 'bill_pending';
  } else if (accountedPaise === 0) {
    paymentStatus = 'unpaid';
    outstandingPaise = invoice.invoiceTotalPaise;
  } else if (accountedPaise < invoice.invoiceTotalPaise) {
    paymentStatus = 'part_payment';
    outstandingPaise = invoice.invoiceTotalPaise - accountedPaise;
  } else if (accountedPaise === invoice.invoiceTotalPaise) {
    paymentStatus = 'fully_paid';
    financiallyEligible = true;
  } else {
    paymentStatus = 'excess_received';
    excessPaise = accountedPaise - invoice.invoiceTotalPaise;
    financiallyEligible = true;
  }

  const closureEligible = financiallyEligible && job.fsr_submitted === 'yes';
  return {
    billRequired, ...invoice,
    receivedPaise, tdsPaise, writeoffPaise, accountedPaise,
    outstandingPaise, excessPaise, paymentStatus, closureEligible,
  };
}

async function sumFeeReceiptTotals(db, jobId) {
  const { results } = await db.prepare(
    'SELECT amount, tds_deduction, writeoff_amount FROM fee_receipts WHERE job_id = ?'
  ).bind(jobId).all();
  return results.reduce((acc, r) => {
    acc.receivedPaise += toPaise(r.amount);
    acc.tdsPaise += toPaise(r.tds_deduction);
    acc.writeoffPaise += toPaise(r.writeoff_amount);
    return acc;
  }, { receivedPaise: 0, tdsPaise: 0, writeoffPaise: 0 });
}

// Billing fields live in the `job_billing` sidecar table (1:1 with jobs),
// not as jobs columns — see BILLING_FIELDS comment. This merges a fresh
// job_billing row (if any) onto a plain jobs row, defaulting every billing
// field for jobs that don't have a job_billing row yet (i.e. every job
// created/edited before its first billing write).
const JOB_BILLING_DEFAULTS = {
  bill_required: 'to_be_decided', bill_date: '', bill_number: '', bill_amount: '',
  professional_fees: '', expenses: '', billing_remarks: '',
  closure_date: '', closed_by: '', closure_remarks: '',
};
function mergeJobBilling(job, billingRow) {
  return { ...job, ...JOB_BILLING_DEFAULTS, ...(billingRow || {}) };
}
async function getJobWithBilling(db, jobId) {
  const job = await db.prepare('SELECT * FROM jobs WHERE id = ?').bind(jobId).first();
  if (!job) return null;
  const billingRow = await db.prepare('SELECT * FROM job_billing WHERE job_id = ?').bind(jobId).first();
  return mergeJobBilling(job, billingRow);
}
async function upsertJobBilling(db, jobId, fields) {
  const cols = Object.keys(fields);
  if (cols.length === 0) return;
  const now = Date.now();
  await db.prepare(
    `INSERT INTO job_billing (job_id, ${cols.join(', ')}, updated_at)
     VALUES (?, ${cols.map(() => '?').join(', ')}, ?)
     ON CONFLICT(job_id) DO UPDATE SET
       ${cols.map(c => `${c} = excluded.${c}`).join(', ')}, updated_at = excluded.updated_at`
  ).bind(jobId, ...cols.map(c => fields[c]), now).run();
}

// Cross-field milestone rules (V0.9). `body` may be a partial PATCH, so each
// check falls back to the existing row's value for fields not being changed.
async function requireDirectorStaff(db, staffId, label) {
  const staffRow = await db.prepare('SELECT role FROM staff WHERE id = ?').bind(staffId).first();
  if (!staffRow) throw new Error(`${label} staff not found`);
  if (!/director/i.test(staffRow.role || '')) throw new Error(`${label} must be a Director-role staff member`);
}

async function validateMilestones(db, existing, body) {
  const eff = field => (body[field] !== undefined ? body[field] : existing[field]);

  if (eff('ila_issued') === 'yes' && !eff('ila_issue_date')) {
    throw new Error('ILA Issue Date is required when ILA Issued is Yes');
  }
  if (eff('lor_issued') === 'yes' && !eff('lor_issue_date')) {
    throw new Error('LOR Issue Date is required when LOR Issued is Yes');
  }

  const dvStatus = eff('director_verification_status');
  if (dvStatus === 'approved') {
    if (!eff('director_verification_date')) throw new Error('Director Verification Date is required when status is Approved');
    if (!eff('director_verified_by')) throw new Error('Verified By is required when status is Approved');
  }
  const dvBy = eff('director_verified_by');
  if (dvBy) await requireDirectorStaff(db, dvBy, 'Verified By');

  const iaStatus = eff('insurer_approval_status');
  if ((iaStatus === 'approved' || iaStatus === 'partially_approved') && !eff('insurer_approval_date')) {
    throw new Error('Insurer Approval Date is required when status is Approved or Partially Approved');
  }

  if (eff('insured_consent_status') === 'accepted' && !eff('insured_consent_date')) {
    throw new Error('Insured Consent Date is required when status is Accepted');
  }

  if (!isNonNegativeNumber(eff('assessed_amount'))) throw new Error('Assessed Loss Amount must be a non-negative number');
}

// FSR Final Verification / Submission / Dispatch / POD (V1.0). Deliberately
// asymmetric: hard_copy_required has NO bearing on what's required here —
// courier/AWB are never mandatory, and hard_copy_sent_date is only ever
// required when hard copy is both required AND marked sent. This must stay
// a genuine bypass, not just a hidden field, when Hard Copy Required = No.
async function validateFinalReport(db, existing, body) {
  const eff = field => (body[field] !== undefined ? body[field] : existing[field]);

  const fvStatus = eff('fsr_final_verification_status');
  if (fvStatus === 'approved') {
    if (!eff('fsr_final_verification_date')) throw new Error('FSR Final Verification Date is required when status is Approved');
    if (!eff('fsr_final_verified_by')) throw new Error('Verified By is required when FSR Final Verification is Approved');
  }
  const fvBy = eff('fsr_final_verified_by');
  if (fvBy) await requireDirectorStaff(db, fvBy, 'FSR Final Verification Verified By');

  if (eff('fsr_submitted') === 'yes' && !eff('fsr_submission_date')) {
    throw new Error('FSR Submission Date is required when FSR Submitted is Yes');
  }

  if (eff('hard_copy_required') === 'yes' && eff('hard_copy_sent') === 'yes' && !eff('hard_copy_sent_date')) {
    throw new Error('Hard Copy Sent Date is required when Hard Copy Required and Sent are both Yes');
  }

  if (eff('pod_status') === 'delivered' && !eff('pod_date')) {
    throw new Error('POD Date is required when POD Status is Delivered');
  }
}

// Bill Required = Yes only demands Date + a positive Professional Fees once
// the invoice is actually being entered (any of Date/Professional
// Fees/Expenses non-blank in the effective state) — "Yes, not generated
// yet" (all blank) stays valid. Expenses may be zero.
function validateBilling(existing, body) {
  const eff = field => (body[field] !== undefined ? body[field] : existing[field]);
  const required = eff('bill_required');
  const date = eff('bill_date');
  const fees = eff('professional_fees');
  const expenses = eff('expenses');
  const enteringInvoice = !!(date || fees || expenses);

  if (required === 'yes' && enteringInvoice) {
    if (!date) throw new Error('Bill Date is required once the invoice is generated');
    if (!isPositiveNumber(fees)) throw new Error('Professional Fees must be a positive number once the invoice is generated');
    if (expenses && !isNonNegativeNumber(expenses)) throw new Error('Expenses must be a non-negative number');
  } else {
    if (fees && !isNonNegativeNumber(fees)) throw new Error('Professional Fees must be a non-negative number');
    if (expenses && !isNonNegativeNumber(expenses)) throw new Error('Expenses must be a non-negative number');
  }
}

const PAYMENT_STATUS_LABELS = {
  to_be_decided: 'Billing Requirement To Be Decided', not_required: 'Bill Not Required',
  bill_pending: 'Bill Pending', unpaid: 'Unpaid', part_payment: 'Part Payment',
  fully_paid: 'Fully Settled', excess_received: 'Excess Accounted',
};

// Logs only the transitions that actually change the *computed* payment
// status or closure eligibility — never fires on a no-op recalculation.
async function logBillingTransition(db, jobId, before, after, actor) {
  const entries = [];
  if (before.paymentStatus !== after.paymentStatus) {
    entries.push({ text: `Payment status became ${PAYMENT_STATUS_LABELS[after.paymentStatus] || after.paymentStatus}.`, ts: Date.now(), actor });
  }
  if (before.closureEligible !== after.closureEligible) {
    entries.push({
      text: after.closureEligible ? 'Claim became eligible for closure.' : 'Claim is no longer eligible for closure.',
      ts: Date.now(), actor,
    });
  }
  if (entries.length > 0) await appendJobActivity(db, jobId, entries);
}

async function listJobs(db) {
  const { results } = await db.prepare('SELECT * FROM jobs ORDER BY updated_at DESC').all();
  const { results: visits } = await db.prepare(
    'SELECT job_id, visit_date, visit_time, reason, created_at FROM survey_visits ORDER BY created_at ASC'
  ).all();
  const { results: reminders } = await db.prepare(
    'SELECT job_id, reminder_date, created_at FROM claim_reminders ORDER BY created_at ASC'
  ).all();
  const { results: receipts } = await db.prepare(
    'SELECT job_id FROM document_receipt_events'
  ).all();
  const { results: queries } = await db.prepare(
    'SELECT job_id, status FROM claim_queries'
  ).all();
  const { results: feeReceipts } = await db.prepare(
    'SELECT job_id, amount, tds_deduction, writeoff_amount FROM fee_receipts'
  ).all();
  const { results: billingRows } = await db.prepare('SELECT * FROM job_billing').all();

  const sumsByJob = {};
  for (const r of feeReceipts) {
    const s = (sumsByJob[r.job_id] ||= { receivedPaise: 0, tdsPaise: 0, writeoffPaise: 0 });
    s.receivedPaise += toPaise(r.amount);
    s.tdsPaise += toPaise(r.tds_deduction);
    s.writeoffPaise += toPaise(r.writeoff_amount);
  }
  const billingByJob = {};
  for (const b of billingRows) billingByJob[b.job_id] = b;

  const byJob = {};
  for (const v of visits) (byJob[v.job_id] ||= []).push(v);
  const remByJob = {};
  for (const r of reminders) (remByJob[r.job_id] ||= []).push(r);
  const recCountByJob = {};
  for (const r of receipts) recCountByJob[r.job_id] = (recCountByJob[r.job_id] || 0) + 1;
  const openQueryCountByJob = {};
  for (const q of queries) if (q.status === 'open') openQueryCountByJob[q.job_id] = (openQueryCountByJob[q.job_id] || 0) + 1;

  return results.map(row => {
    const job = mergeJobBilling(rowToJob(row), billingByJob[row.id]);
    const jobVisits = byJob[job.id] || [];
    job.survey_visit_count = jobVisits.length;
    const last = jobVisits[jobVisits.length - 1];
    job.last_survey_visit = last ? { visit_date: last.visit_date, visit_time: last.visit_time, reason: last.reason } : null;

    const jobReminders = remByJob[job.id] || [];
    job.reminder_count = jobReminders.length;
    const lastRem = jobReminders[jobReminders.length - 1];
    job.last_reminder_date = lastRem ? lastRem.reminder_date : null;

    job.document_receipt_count = recCountByJob[job.id] || 0;
    job.open_query_count = openQueryCountByJob[job.id] || 0;

    const sums = sumsByJob[job.id] || { receivedPaise: 0, tdsPaise: 0, writeoffPaise: 0 };
    const billing = computeBilling(job, sums);
    job.billing = {
      professional_fees_paise: billing.professionalFeesPaise,
      expenses_paise: billing.expensesPaise,
      base_total_paise: billing.baseTotalPaise,
      gst_paise: billing.gstPaise,
      invoice_total_paise: billing.invoiceTotalPaise,
      received_paise: billing.receivedPaise,
      tds_paise: billing.tdsPaise,
      writeoff_paise: billing.writeoffPaise,
      accounted_paise: billing.accountedPaise,
      outstanding_paise: billing.outstandingPaise,
      excess_paise: billing.excessPaise,
      payment_status: billing.paymentStatus,
      closure_eligible: billing.closureEligible,
    };
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

async function updateJob(db, id, body, user) {
  const existingRow = await db.prepare('SELECT * FROM jobs WHERE id = ?').bind(id).first();
  if (!existingRow) throw new Error('job not found');
  const existingBillingRow = await db.prepare('SELECT * FROM job_billing WHERE job_id = ?').bind(id).first();
  const existing = mergeJobBilling(existingRow, existingBillingRow);
  const effectiveFrom = body.policy_period_from !== undefined ? body.policy_period_from : existing.policy_period_from;
  const effectiveTo   = body.policy_period_to   !== undefined ? body.policy_period_to   : existing.policy_period_to;
  validatePolicyPeriod(effectiveFrom, effectiveTo);
  await validateJobAssignments(db, body);
  await validateMilestones(db, existing, body);
  await validateFinalReport(db, existing, body);
  validateBilling(existing, body);

  // Billing fields affect the *calculated* payment status/closure eligibility
  // — capture the before-state so we can log only a real transition, not
  // every recalculation.
  const billingChanged = BILLING_FIELDS.some(f => body[f] !== undefined && body[f] !== existing[f]);
  let sumsForLog = null;
  let beforeBilling = null;
  if (billingChanged) {
    sumsForLog = await sumFeeReceiptTotals(db, id);
    beforeBilling = computeBilling(existing, sumsForLog);
  }

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
  try { activity = JSON.parse(existingRow.activity); } catch { activity = []; }
  if (Array.isArray(body.activity_add)) activity.push(...body.activity_add);
  sets.push('activity = ?');
  values.push(JSON.stringify(activity));

  const now = Date.now();
  sets.push('updated_at = ?');
  values.push(now);

  values.push(id);
  await db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();

  const billingFieldsToWrite = {};
  for (const f of BILLING_FIELDS) if (body[f] !== undefined) billingFieldsToWrite[f] = body[f];
  if (Object.keys(billingFieldsToWrite).length > 0) {
    await upsertJobBilling(db, id, billingFieldsToWrite);
  }

  const updated = await getJobWithBilling(db, id);

  if (billingChanged && user) {
    const afterBilling = computeBilling(updated, sumsForLog);
    await logBillingTransition(db, id, beforeBilling, afterBilling, user.id);
  }

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

const EVENT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── CLAIM REMINDERS (V0.9) ──────────────────────────────────────
async function listReminders(db, jobId) {
  const { results } = await db.prepare(
    'SELECT * FROM claim_reminders WHERE job_id = ? ORDER BY created_at ASC'
  ).bind(jobId).all();
  return results;
}

async function createReminder(db, jobId, body, user) {
  const job = await db.prepare('SELECT id FROM jobs WHERE id = ?').bind(jobId).first();
  if (!job) throw new Error('job not found');

  const reminderDate = (body.reminder_date || '').trim();
  const reminderType = (body.reminder_type || '').trim();
  const mode = (body.mode || '').trim();
  const remarks = (body.remarks || '').trim();

  if (!EVENT_DATE_RE.test(reminderDate)) throw new Error('A valid reminder date (YYYY-MM-DD) is required');
  if (!reminderType) throw new Error('Reminder type/reason is required');

  const now = Date.now();
  const id = `RM-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  await db.prepare(`
    INSERT INTO claim_reminders (id, job_id, reminder_date, reminder_type, mode, remarks, created_by, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).bind(id, jobId, reminderDate, reminderType, mode, remarks, user.id, now, now).run();

  await appendJobActivity(db, jobId, [{
    text: `${user.id} added reminder — ${reminderType}${mode ? ' — ' + mode : ''} — ${reminderDate}.`,
    ts: now, actor: user.id,
  }]);

  return { id, job_id: jobId, reminder_date: reminderDate, reminder_type: reminderType, mode, remarks,
    created_by: user.id, created_at: now, updated_at: now };
}

async function updateReminder(db, jobId, reminderId, body, user) {
  const existing = await db.prepare('SELECT * FROM claim_reminders WHERE id = ? AND job_id = ?')
    .bind(reminderId, jobId).first();
  if (!existing) throw new Error('reminder not found');

  const next = {
    reminder_date: body.reminder_date !== undefined ? String(body.reminder_date).trim() : existing.reminder_date,
    reminder_type: body.reminder_type !== undefined ? String(body.reminder_type).trim() : existing.reminder_type,
    mode: body.mode !== undefined ? String(body.mode).trim() : existing.mode,
    remarks: body.remarks !== undefined ? String(body.remarks).trim() : existing.remarks,
  };
  if (!EVENT_DATE_RE.test(next.reminder_date)) throw new Error('A valid reminder date (YYYY-MM-DD) is required');
  if (!next.reminder_type) throw new Error('Reminder type/reason is required');

  const changeLines = [];
  if (next.reminder_date !== existing.reminder_date) changeLines.push(`date from ${existing.reminder_date} to ${next.reminder_date}`);
  if (next.reminder_type !== existing.reminder_type) changeLines.push(`type from "${existing.reminder_type}" to "${next.reminder_type}"`);
  if (next.mode !== (existing.mode || '')) changeLines.push(`mode from "${existing.mode || '—'}" to "${next.mode || '—'}"`);
  if (next.remarks !== (existing.remarks || '')) changeLines.push('remarks');

  const now = Date.now();
  await db.prepare('UPDATE claim_reminders SET reminder_date=?, reminder_type=?, mode=?, remarks=?, updated_at=? WHERE id = ?')
    .bind(next.reminder_date, next.reminder_type, next.mode, next.remarks, now, reminderId).run();

  if (changeLines.length > 0) {
    await appendJobActivity(db, jobId, [{ text: `${user.id} updated reminder ${changeLines.join('; ')}.`, ts: now, actor: user.id }]);
  }

  return db.prepare('SELECT * FROM claim_reminders WHERE id = ?').bind(reminderId).first();
}

// ── DOCUMENT RECEIPT EVENTS (V0.9) ──────────────────────────────
function rowToReceipt(row) {
  const r = { ...row };
  try { r.documents_received = JSON.parse(row.documents_received); } catch { r.documents_received = []; }
  return r;
}

async function listDocumentReceipts(db, jobId) {
  const { results } = await db.prepare(
    'SELECT * FROM document_receipt_events WHERE job_id = ? ORDER BY created_at ASC'
  ).bind(jobId).all();
  return results.map(rowToReceipt);
}

async function createDocumentReceipt(db, jobId, body, user) {
  const job = await db.prepare('SELECT id FROM jobs WHERE id = ?').bind(jobId).first();
  if (!job) throw new Error('job not found');

  const receiptDate = (body.receipt_date || '').trim();
  const receiptMode = (body.receipt_mode || '').trim();
  const docs = Array.isArray(body.documents_received)
    ? body.documents_received.map(d => String(d).trim()).filter(Boolean) : [];
  const remarks = (body.remarks || '').trim();

  if (!EVENT_DATE_RE.test(receiptDate)) throw new Error('A valid receipt date (YYYY-MM-DD) is required');
  if (docs.length === 0) throw new Error('At least one received document is required');

  const now = Date.now();
  const id = `DR-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  await db.prepare(`
    INSERT INTO document_receipt_events (id, job_id, receipt_date, receipt_mode, documents_received, remarks, created_by, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).bind(id, jobId, receiptDate, receiptMode, JSON.stringify(docs), remarks, user.id, now, now).run();

  await appendJobActivity(db, jobId, [{
    text: `${user.id} added document receipt — ${docs.length} document(s) received${receiptMode ? ' by ' + receiptMode : ''} — ${receiptDate}.`,
    ts: now, actor: user.id,
  }]);

  return { id, job_id: jobId, receipt_date: receiptDate, receipt_mode: receiptMode, documents_received: docs, remarks,
    created_by: user.id, created_at: now, updated_at: now };
}

async function updateDocumentReceipt(db, jobId, receiptId, body, user) {
  const existing = await db.prepare('SELECT * FROM document_receipt_events WHERE id = ? AND job_id = ?')
    .bind(receiptId, jobId).first();
  if (!existing) throw new Error('document receipt not found');
  const existingDocs = JSON.parse(existing.documents_received || '[]');

  const next = {
    receipt_date: body.receipt_date !== undefined ? String(body.receipt_date).trim() : existing.receipt_date,
    receipt_mode: body.receipt_mode !== undefined ? String(body.receipt_mode).trim() : existing.receipt_mode,
    documents_received: body.documents_received !== undefined
      ? (Array.isArray(body.documents_received) ? body.documents_received.map(d => String(d).trim()).filter(Boolean) : [])
      : existingDocs,
    remarks: body.remarks !== undefined ? String(body.remarks).trim() : existing.remarks,
  };
  if (!EVENT_DATE_RE.test(next.receipt_date)) throw new Error('A valid receipt date (YYYY-MM-DD) is required');
  if (next.documents_received.length === 0) throw new Error('At least one received document is required');

  const changeLines = [];
  if (next.receipt_date !== existing.receipt_date) changeLines.push(`date from ${existing.receipt_date} to ${next.receipt_date}`);
  if (next.receipt_mode !== (existing.receipt_mode || '')) changeLines.push(`mode from "${existing.receipt_mode || '—'}" to "${next.receipt_mode || '—'}"`);
  if (JSON.stringify(existingDocs) !== JSON.stringify(next.documents_received)) changeLines.push('documents received');
  if (next.remarks !== (existing.remarks || '')) changeLines.push('remarks');

  const now = Date.now();
  await db.prepare('UPDATE document_receipt_events SET receipt_date=?, receipt_mode=?, documents_received=?, remarks=?, updated_at=? WHERE id = ?')
    .bind(next.receipt_date, next.receipt_mode, JSON.stringify(next.documents_received), next.remarks, now, receiptId).run();

  if (changeLines.length > 0) {
    await appendJobActivity(db, jobId, [{ text: `${user.id} updated document receipt ${changeLines.join('; ')}.`, ts: now, actor: user.id }]);
  }

  return rowToReceipt(await db.prepare('SELECT * FROM document_receipt_events WHERE id = ?').bind(receiptId).first());
}

// ── CLAIM QUERIES (V1.0) ─────────────────────────────────────────
async function listQueries(db, jobId) {
  const { results } = await db.prepare(
    'SELECT * FROM claim_queries WHERE job_id = ? ORDER BY created_at ASC'
  ).bind(jobId).all();
  return results;
}

async function createQuery(db, jobId, body, user) {
  const job = await db.prepare('SELECT id FROM jobs WHERE id = ?').bind(jobId).first();
  if (!job) throw new Error('job not found');

  const queryDate = (body.query_date || '').trim();
  const queryFrom = (body.query_from || '').trim();
  const queryType = (body.query_type || '').trim();
  const queryDetails = (body.query_details || '').trim();
  const status = ['open', 'replied', 'closed'].includes(body.status) ? body.status : 'open';

  if (!EVENT_DATE_RE.test(queryDate)) throw new Error('A valid query date (YYYY-MM-DD) is required');
  if (!queryType) throw new Error('Query type is required');
  if (!queryDetails) throw new Error('Query details are required');

  const now = Date.now();
  const id = `QR-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  await db.prepare(`
    INSERT INTO claim_queries (id, job_id, query_date, query_from, query_type, query_details, status, created_by, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).bind(id, jobId, queryDate, queryFrom, queryType, queryDetails, status, user.id, now, now).run();

  await appendJobActivity(db, jobId, [{
    text: `${user.id} added query — ${queryType}${queryFrom ? ' (' + queryFrom + ')' : ''} — ${queryDate}.`,
    ts: now, actor: user.id,
  }]);

  return { id, job_id: jobId, query_date: queryDate, query_from: queryFrom, query_type: queryType,
    query_details: queryDetails, status, response_date: '', response_details: '',
    created_by: user.id, created_at: now, updated_at: now };
}

async function updateQuery(db, jobId, queryId, body, user) {
  const existing = await db.prepare('SELECT * FROM claim_queries WHERE id = ? AND job_id = ?')
    .bind(queryId, jobId).first();
  if (!existing) throw new Error('query not found');

  const next = {
    query_date: body.query_date !== undefined ? String(body.query_date).trim() : existing.query_date,
    query_from: body.query_from !== undefined ? String(body.query_from).trim() : existing.query_from,
    query_type: body.query_type !== undefined ? String(body.query_type).trim() : existing.query_type,
    query_details: body.query_details !== undefined ? String(body.query_details).trim() : existing.query_details,
    status: body.status !== undefined
      ? (['open', 'replied', 'closed'].includes(body.status) ? body.status : existing.status)
      : existing.status,
    response_date: body.response_date !== undefined ? String(body.response_date).trim() : (existing.response_date || ''),
    response_details: body.response_details !== undefined ? String(body.response_details).trim() : (existing.response_details || ''),
  };
  if (!EVENT_DATE_RE.test(next.query_date)) throw new Error('A valid query date (YYYY-MM-DD) is required');
  if (!next.query_type) throw new Error('Query type is required');
  if (!next.query_details) throw new Error('Query details are required');

  const changeLines = [];
  if (next.status !== existing.status) changeLines.push(`status from ${existing.status} to ${next.status}`);
  if (next.response_date !== (existing.response_date || '') || next.response_details !== (existing.response_details || '')) {
    changeLines.push('response recorded');
  }
  if (next.query_date !== existing.query_date) changeLines.push(`date from ${existing.query_date} to ${next.query_date}`);
  if (next.query_type !== existing.query_type) changeLines.push(`type from "${existing.query_type}" to "${next.query_type}"`);
  if (next.query_details !== existing.query_details) changeLines.push('details');

  const now = Date.now();
  await db.prepare(`
    UPDATE claim_queries SET query_date=?, query_from=?, query_type=?, query_details=?, status=?, response_date=?, response_details=?, updated_at=?
    WHERE id = ?
  `).bind(next.query_date, next.query_from, next.query_type, next.query_details, next.status,
    next.response_date, next.response_details, now, queryId).run();

  if (changeLines.length > 0) {
    await appendJobActivity(db, jobId, [{ text: `${user.id} updated query ${changeLines.join('; ')}.`, ts: now, actor: user.id }]);
  }

  return db.prepare('SELECT * FROM claim_queries WHERE id = ?').bind(queryId).first();
}

// ── FEE RECEIPTS (V1.1) ──────────────────────────────────────────
async function listFeeReceipts(db, jobId) {
  const { results } = await db.prepare(
    'SELECT * FROM fee_receipts WHERE job_id = ? ORDER BY created_at ASC'
  ).bind(jobId).all();
  return results;
}

async function createFeeReceipt(db, jobId, body, user) {
  const job = await getJobWithBilling(db, jobId);
  if (!job) throw new Error('job not found');

  const receiptDate = (body.receipt_date || '').trim();
  const amount = (body.amount !== undefined && body.amount !== null ? String(body.amount) : '0').trim() || '0';
  const tds = (body.tds_deduction !== undefined && body.tds_deduction !== null ? String(body.tds_deduction) : '0').trim() || '0';
  const writeoff = (body.writeoff_amount !== undefined && body.writeoff_amount !== null ? String(body.writeoff_amount) : '0').trim() || '0';
  const receiptMode = (body.receipt_mode || '').trim();
  const referenceNo = (body.reference_no || '').trim();
  const remarks = (body.remarks || '').trim();

  if (!EVENT_DATE_RE.test(receiptDate)) throw new Error('A valid receipt date (YYYY-MM-DD) is required');
  if (!isNonNegativeNumber(amount)) throw new Error('Received Amount must be a non-negative number');
  if (!isNonNegativeNumber(tds)) throw new Error('TDS Deduction must be a non-negative number');
  if (!isNonNegativeNumber(writeoff)) throw new Error('Write-off Amount must be a non-negative number');
  if (toPaise(amount) <= 0 && toPaise(tds) <= 0 && toPaise(writeoff) <= 0) {
    throw new Error('At least one of Received Amount, TDS Deduction, or Write-off Amount must be greater than zero');
  }

  const before = computeBilling(job, await sumFeeReceiptTotals(db, jobId));

  const now = Date.now();
  const id = `FR-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  await db.prepare(`
    INSERT INTO fee_receipts (id, job_id, receipt_date, amount, tds_deduction, writeoff_amount, receipt_mode, reference_no, remarks, created_by, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(id, jobId, receiptDate, amount, tds, writeoff, receiptMode, referenceNo, remarks, user.id, now, now).run();

  const after = computeBilling(job, await sumFeeReceiptTotals(db, jobId));

  const parts = [`Received ${formatINR(toPaise(amount))}`];
  if (toPaise(tds) > 0) parts.push(`TDS ${formatINR(toPaise(tds))}`);
  if (toPaise(writeoff) > 0) parts.push(`Write-off ${formatINR(toPaise(writeoff))}`);
  await appendJobActivity(db, jobId, [{
    text: `Fee receipt added — ${parts.join(', ')}${receiptMode ? ' — ' + receiptMode : ''} — ${receiptDate}.`,
    ts: now, actor: user.id,
  }]);
  await logBillingTransition(db, jobId, before, after, user.id);

  return { id, job_id: jobId, receipt_date: receiptDate, amount, tds_deduction: tds, writeoff_amount: writeoff,
    receipt_mode: receiptMode, reference_no: referenceNo, remarks, created_by: user.id, created_at: now, updated_at: now };
}

async function updateFeeReceipt(db, jobId, receiptId, body, user) {
  const job = await getJobWithBilling(db, jobId);
  if (!job) throw new Error('job not found');
  const existing = await db.prepare('SELECT * FROM fee_receipts WHERE id = ? AND job_id = ?')
    .bind(receiptId, jobId).first();
  if (!existing) throw new Error('fee receipt not found');

  const next = {
    receipt_date: body.receipt_date !== undefined ? String(body.receipt_date).trim() : existing.receipt_date,
    amount: body.amount !== undefined ? (String(body.amount).trim() || '0') : (existing.amount || '0'),
    tds_deduction: body.tds_deduction !== undefined ? (String(body.tds_deduction).trim() || '0') : (existing.tds_deduction || '0'),
    writeoff_amount: body.writeoff_amount !== undefined ? (String(body.writeoff_amount).trim() || '0') : (existing.writeoff_amount || '0'),
    receipt_mode: body.receipt_mode !== undefined ? String(body.receipt_mode).trim() : existing.receipt_mode,
    reference_no: body.reference_no !== undefined ? String(body.reference_no).trim() : existing.reference_no,
    remarks: body.remarks !== undefined ? String(body.remarks).trim() : existing.remarks,
  };
  if (!EVENT_DATE_RE.test(next.receipt_date)) throw new Error('A valid receipt date (YYYY-MM-DD) is required');
  if (!isNonNegativeNumber(next.amount)) throw new Error('Received Amount must be a non-negative number');
  if (!isNonNegativeNumber(next.tds_deduction)) throw new Error('TDS Deduction must be a non-negative number');
  if (!isNonNegativeNumber(next.writeoff_amount)) throw new Error('Write-off Amount must be a non-negative number');
  if (toPaise(next.amount) <= 0 && toPaise(next.tds_deduction) <= 0 && toPaise(next.writeoff_amount) <= 0) {
    throw new Error('At least one of Received Amount, TDS Deduction, or Write-off Amount must be greater than zero');
  }

  const before = computeBilling(job, await sumFeeReceiptTotals(db, jobId));

  const financialChanges = [];
  if (next.amount !== (existing.amount || '0')) financialChanges.push(`Received amount changed from ${formatINR(toPaise(existing.amount))} to ${formatINR(toPaise(next.amount))}.`);
  if (next.tds_deduction !== (existing.tds_deduction || '0')) financialChanges.push(`TDS changed from ${formatINR(toPaise(existing.tds_deduction))} to ${formatINR(toPaise(next.tds_deduction))}.`);
  if (next.writeoff_amount !== (existing.writeoff_amount || '0')) financialChanges.push(`Write-off changed from ${formatINR(toPaise(existing.writeoff_amount))} to ${formatINR(toPaise(next.writeoff_amount))}.`);

  const otherChanges = [];
  if (next.receipt_date !== existing.receipt_date) otherChanges.push(`date from ${existing.receipt_date} to ${next.receipt_date}`);
  if (next.receipt_mode !== (existing.receipt_mode || '')) otherChanges.push(`mode from "${existing.receipt_mode || '—'}" to "${next.receipt_mode || '—'}"`);
  if (next.reference_no !== (existing.reference_no || '')) otherChanges.push('reference number');
  if (next.remarks !== (existing.remarks || '')) otherChanges.push('remarks');

  const now = Date.now();
  await db.prepare(`
    UPDATE fee_receipts SET receipt_date=?, amount=?, tds_deduction=?, writeoff_amount=?, receipt_mode=?, reference_no=?, remarks=?, updated_at=?
    WHERE id = ?
  `).bind(next.receipt_date, next.amount, next.tds_deduction, next.writeoff_amount, next.receipt_mode, next.reference_no, next.remarks, now, receiptId).run();

  const entries = financialChanges.map(text => ({ text: `Fee receipt corrected — ${text}`, ts: now, actor: user.id }));
  if (otherChanges.length > 0) entries.push({ text: `${user.id} updated fee receipt ${otherChanges.join('; ')}.`, ts: now, actor: user.id });
  if (entries.length > 0) await appendJobActivity(db, jobId, entries);

  const after = computeBilling(job, await sumFeeReceiptTotals(db, jobId));
  await logBillingTransition(db, jobId, before, after, user.id);

  return db.prepare('SELECT * FROM fee_receipts WHERE id = ?').bind(receiptId).first();
}

// ── CLOSE JOB (V1.1) ─────────────────────────────────────────────
// Deliberately its own action, not a generic stage PATCH: eligibility and
// authorization are recomputed here from authoritative DB state, never
// trusting a client-supplied "eligible" flag.
function isDirectorRole(user) {
  return !!user && /director/i.test(user.role || '');
}

async function closeJob(db, jobId, body, user) {
  if (!isAdmin(user) && !isDirectorRole(user)) {
    throw new Error('Only an Admin or Director may close a claim');
  }

  const job = await getJobWithBilling(db, jobId);
  if (!job) throw new Error('job not found');
  if (job.stage === 'closed') throw new Error('This claim is already closed');

  const sums = await sumFeeReceiptTotals(db, jobId);
  const billing = computeBilling(job, sums);
  if (!billing.closureEligible) {
    throw new Error('This claim is not currently eligible for closure');
  }

  const closureDate = (body.closure_date || '').trim();
  if (!EVENT_DATE_RE.test(closureDate)) throw new Error('A valid closure date (YYYY-MM-DD) is required');
  const closureRemarks = (body.closure_remarks || '').trim();

  const now = Date.now();
  await db.prepare(`UPDATE jobs SET stage = 'closed', updated_at = ? WHERE id = ?`).bind(now, jobId).run();
  await upsertJobBilling(db, jobId, { closure_date: closureDate, closed_by: user.id, closure_remarks: closureRemarks });

  await appendJobActivity(db, jobId, [{
    text: `${user.id} closed the claim on ${closureDate}.`, ts: now, actor: user.id,
  }]);

  const updated = await getJobWithBilling(db, jobId);
  return rowToJob(updated);
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

        const reminderCollectionMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/reminders\/?$/);
        if (reminderCollectionMatch) {
          const jobId = decodeURIComponent(reminderCollectionMatch[1]);
          if (request.method === 'GET') return json(await listReminders(db, jobId));
          if (request.method === 'POST') {
            const body = await request.json();
            return json(await createReminder(db, jobId, body, user), 201);
          }
        }

        const reminderItemMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/reminders\/([^/]+)$/);
        if (reminderItemMatch && request.method === 'PATCH') {
          const jobId = decodeURIComponent(reminderItemMatch[1]);
          const reminderId = decodeURIComponent(reminderItemMatch[2]);
          const body = await request.json();
          return json(await updateReminder(db, jobId, reminderId, body, user));
        }

        const receiptCollectionMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/document-receipts\/?$/);
        if (receiptCollectionMatch) {
          const jobId = decodeURIComponent(receiptCollectionMatch[1]);
          if (request.method === 'GET') return json(await listDocumentReceipts(db, jobId));
          if (request.method === 'POST') {
            const body = await request.json();
            return json(await createDocumentReceipt(db, jobId, body, user), 201);
          }
        }

        const receiptItemMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/document-receipts\/([^/]+)$/);
        if (receiptItemMatch && request.method === 'PATCH') {
          const jobId = decodeURIComponent(receiptItemMatch[1]);
          const receiptId = decodeURIComponent(receiptItemMatch[2]);
          const body = await request.json();
          return json(await updateDocumentReceipt(db, jobId, receiptId, body, user));
        }

        const queryCollectionMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/queries\/?$/);
        if (queryCollectionMatch) {
          const jobId = decodeURIComponent(queryCollectionMatch[1]);
          if (request.method === 'GET') return json(await listQueries(db, jobId));
          if (request.method === 'POST') {
            const body = await request.json();
            return json(await createQuery(db, jobId, body, user), 201);
          }
        }

        const queryItemMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/queries\/([^/]+)$/);
        if (queryItemMatch && request.method === 'PATCH') {
          const jobId = decodeURIComponent(queryItemMatch[1]);
          const queryId = decodeURIComponent(queryItemMatch[2]);
          const body = await request.json();
          return json(await updateQuery(db, jobId, queryId, body, user));
        }

        const feeReceiptCollectionMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/fee-receipts\/?$/);
        if (feeReceiptCollectionMatch) {
          const jobId = decodeURIComponent(feeReceiptCollectionMatch[1]);
          if (request.method === 'GET') return json(await listFeeReceipts(db, jobId));
          if (request.method === 'POST') {
            const body = await request.json();
            return json(await createFeeReceipt(db, jobId, body, user), 201);
          }
        }

        const feeReceiptItemMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/fee-receipts\/([^/]+)$/);
        if (feeReceiptItemMatch && request.method === 'PATCH') {
          const jobId = decodeURIComponent(feeReceiptItemMatch[1]);
          const receiptId = decodeURIComponent(feeReceiptItemMatch[2]);
          const body = await request.json();
          return json(await updateFeeReceipt(db, jobId, receiptId, body, user));
        }

        const closeMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/close\/?$/);
        if (closeMatch && request.method === 'POST') {
          const jobId = decodeURIComponent(closeMatch[1]);
          const body = await request.json();
          return json(await closeJob(db, jobId, body, user));
        }
      }

      if (pathname.startsWith('/api/jobs/') && request.method === 'PATCH') {
        const id = decodeURIComponent(pathname.slice('/api/jobs/'.length));
        const body = await request.json();
        return json(await updateJob(db, id, body, user));
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
