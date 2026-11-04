-- Permanent deletion tombstones for responsibility areas (schema 11).
--
-- Additive only: the reviewed ADMIN deletion path records the same durable tombstone for a
-- removed responsibility that it already records for a project, subproject or task. Only the
-- allowlist of record types on `record_deletions` grows; no column is added, no row is rewritten
-- and every stored responsibility, project and audit record reads back exactly as before.
--
-- The old constraint is replaced (never widened in place) because PostgreSQL cannot alter a CHECK
-- expression. Dropping the constraint removes no data; the replacement validates every existing
-- row and admits one additional value.

ALTER TABLE record_deletions DROP CONSTRAINT IF EXISTS record_deletions_entity_type_check;

ALTER TABLE record_deletions
  ADD CONSTRAINT record_deletions_entity_type_check
  CHECK (entity_type IN ('PROJECTS','SUBPROJECTS','TASKS','RESPONSIBILITIES'));
