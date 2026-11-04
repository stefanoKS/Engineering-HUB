-- Subproject description.
--
-- Additive only: every existing subproject keeps its identifier, parent link, owner, deadline
-- and every other stored value, and a missing description is the empty string rather than NULL,
-- so a reader never has to distinguish "no description" from "not migrated". No historical
-- migration file is edited and no column is rewritten.

ALTER TABLE subprojects ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
