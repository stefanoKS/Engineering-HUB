-- Date-based workload report indexes (schema 10).
--
-- Additive only: the report filters tasks by completion instant and joins the effective
-- assignment set, so both reads get a partial index that matches their predicate. No column is
-- added, no row is rewritten and the record the manager sees is unchanged.
--
-- task_assignees already carries task_assignees_active_unique (task_id, member_id) with the same
-- partial predicate, so its task_id prefix serves the assignment join and no second index is
-- introduced.

CREATE INDEX IF NOT EXISTS tasks_completed_at_idx
  ON tasks (completed_at) WHERE deleted_at IS NULL AND completed_at IS NOT NULL;
