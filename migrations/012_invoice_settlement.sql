-- TMS V1.1A — Billing Simplification & Invoice Correction.
-- Extends the two V1.1 billing tables — does NOT touch `jobs` (which is
-- already at the D1/SQLite ~100-column-per-table limit; see
-- migrations/011_billing_closure.sql and HANDOFF_NOTES.md). No production
-- billing data existed at the time of this migration (job_billing and
-- fee_receipts both had 0 rows), so nothing needed to be preserved or
-- reinterpreted.
--
-- job_billing gains the real TFAM invoice inputs (Professional Fees,
-- Expenses) — Base Total/GST @ 18%/Total Invoice Value are always derived
-- from these, never stored. The old `bill_amount`/`billing_remarks`
-- columns are left in place as dormant/legacy fields, not dropped.
--
-- fee_receipts gains manual TDS Deduction and Write-off Amount — both are
-- always user-entered, TMS never calculates or assumes a TDS percentage or
-- write-off amount. `amount` (Received Amount) and `reference_no`
-- (UTR/Reference) are reused as-is from V1.1, not duplicated.
--
-- Apply once: wrangler d1 execute TMS_DB --remote --file=migrations/012_invoice_settlement.sql
-- Safe to skip if already applied — a duplicate-column error means it already ran.

ALTER TABLE job_billing ADD COLUMN professional_fees TEXT DEFAULT '';
ALTER TABLE job_billing ADD COLUMN expenses          TEXT DEFAULT '';

ALTER TABLE fee_receipts ADD COLUMN tds_deduction   TEXT NOT NULL DEFAULT '0';
ALTER TABLE fee_receipts ADD COLUMN writeoff_amount TEXT NOT NULL DEFAULT '0';
