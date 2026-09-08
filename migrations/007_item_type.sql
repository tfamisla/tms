-- TMS V0.7 — one-time migration: adds "Type of Item / Property Involved"
-- to jobs, a Loss Details field that will later feed the dynamic
-- Document Requirement / LOR engine (not built in V0.7).
-- Apply once: wrangler d1 execute TMS_DB --remote --file=migrations/007_item_type.sql
-- Safe to skip if already applied — a duplicate-column error means it already ran.

ALTER TABLE jobs ADD COLUMN item_type TEXT DEFAULT '';
