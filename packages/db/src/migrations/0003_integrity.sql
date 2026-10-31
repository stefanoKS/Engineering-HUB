-- Engineering-HUB V2 schema 1 (integrity triggers)
--
-- Cross-record invariants are enforced by the database as well as by the domain layer, so a
-- concurrent writer cannot slip a cycle or an over-deep branch between validation and update.

CREATE OR REPLACE FUNCTION eh_touch_updated_at() RETURNS trigger AS $$
BEGIN
  -- A migration import preserves the source timestamps; every interactive write touches them.
  IF current_setting('eh.preserve_timestamps', true) = 'on' THEN
    RETURN NEW;
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER members_touch BEFORE UPDATE ON members FOR EACH ROW EXECUTE FUNCTION eh_touch_updated_at();
CREATE TRIGGER responsibilities_touch BEFORE UPDATE ON responsibilities FOR EACH ROW EXECUTE FUNCTION eh_touch_updated_at();
CREATE TRIGGER projects_touch BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION eh_touch_updated_at();
CREATE TRIGGER subprojects_touch BEFORE UPDATE ON subprojects FOR EACH ROW EXECUTE FUNCTION eh_touch_updated_at();
CREATE TRIGGER tasks_touch BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION eh_touch_updated_at();
CREATE TRIGGER milestones_touch BEFORE UPDATE ON milestones FOR EACH ROW EXECUTE FUNCTION eh_touch_updated_at();
CREATE TRIGGER task_requests_touch BEFORE UPDATE ON task_requests FOR EACH ROW EXECUTE FUNCTION eh_touch_updated_at();

CREATE OR REPLACE FUNCTION eh_subproject_guard() RETURNS trigger AS $$
DECLARE
  ancestor_depth integer := 0;
  descendant_height integer := 0;
  cursor_id text := NEW.parent_subproject_id;
  parent_project text;
  seen text[] := ARRAY[NEW.subproject_id];
BEGIN
  WHILE cursor_id IS NOT NULL LOOP
    IF cursor_id = ANY(seen) THEN
      RAISE EXCEPTION 'Subproject hierarchy cycle detected at %', cursor_id USING ERRCODE = '23514';
    END IF;
    seen := seen || cursor_id;
    ancestor_depth := ancestor_depth + 1;
    IF ancestor_depth > 3 THEN
      RAISE EXCEPTION 'Subprojects are limited to 4 levels' USING ERRCODE = '23514';
    END IF;
    SELECT s.project_id, s.parent_subproject_id INTO parent_project, cursor_id
      FROM subprojects s WHERE s.subproject_id = cursor_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Parent subproject not found: %', cursor_id USING ERRCODE = '23503';
    END IF;
    IF parent_project <> NEW.project_id THEN
      RAISE EXCEPTION 'Parent and child subprojects must belong to the same project' USING ERRCODE = '23514';
    END IF;
  END LOOP;

  WITH RECURSIVE down(subproject_id, level) AS (
    SELECT s.subproject_id, 1 FROM subprojects s WHERE s.parent_subproject_id = NEW.subproject_id
    UNION ALL
    SELECT s.subproject_id, d.level + 1
      FROM subprojects s JOIN down d ON s.parent_subproject_id = d.subproject_id
     WHERE d.level < 8
  )
  SELECT coalesce(max(level), 0) INTO descendant_height FROM down;

  IF ancestor_depth + 1 + descendant_height > 4 THEN
    RAISE EXCEPTION 'Subprojects are limited to 4 levels' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER subprojects_hierarchy_guard
  BEFORE INSERT OR UPDATE OF parent_subproject_id, project_id ON subprojects
  FOR EACH ROW EXECUTE FUNCTION eh_subproject_guard();

CREATE OR REPLACE FUNCTION eh_task_guard() RETURNS trigger AS $$
DECLARE
  ancestor_depth integer := 0;
  descendant_height integer := 0;
  cursor_id text := NEW.parent_task_id;
  parent_project text;
  parent_subproject text;
  seen text[] := ARRAY[NEW.task_id];
BEGIN
  WHILE cursor_id IS NOT NULL LOOP
    IF cursor_id = ANY(seen) THEN
      RAISE EXCEPTION 'Task hierarchy cycle detected at %', cursor_id USING ERRCODE = '23514';
    END IF;
    seen := seen || cursor_id;
    ancestor_depth := ancestor_depth + 1;
    IF ancestor_depth > 2 THEN
      RAISE EXCEPTION 'Tasks are limited to 3 levels' USING ERRCODE = '23514';
    END IF;
    SELECT t.project_id, t.subproject_id, t.parent_task_id
      INTO parent_project, parent_subproject, cursor_id
      FROM tasks t WHERE t.task_id = cursor_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Parent task not found: %', cursor_id USING ERRCODE = '23503';
    END IF;
    IF parent_project <> NEW.project_id THEN
      RAISE EXCEPTION 'Parent and child tasks must belong to the same project' USING ERRCODE = '23514';
    END IF;
    IF coalesce(parent_subproject, '') <> coalesce(NEW.subproject_id, '') THEN
      RAISE EXCEPTION 'Parent and child tasks must belong to the same subproject' USING ERRCODE = '23514';
    END IF;
  END LOOP;

  WITH RECURSIVE down(task_id, level) AS (
    SELECT t.task_id, 1 FROM tasks t WHERE t.parent_task_id = NEW.task_id
    UNION ALL
    SELECT t.task_id, d.level + 1
      FROM tasks t JOIN down d ON t.parent_task_id = d.task_id
     WHERE d.level < 6
  )
  SELECT coalesce(max(level), 0) INTO descendant_height FROM down;

  IF ancestor_depth + 1 + descendant_height > 3 THEN
    RAISE EXCEPTION 'Tasks are limited to 3 levels' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tasks_hierarchy_guard
  BEFORE INSERT OR UPDATE OF parent_task_id, project_id, subproject_id ON tasks
  FOR EACH ROW EXECUTE FUNCTION eh_task_guard();

CREATE OR REPLACE FUNCTION eh_container_not_done() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'Done' AND (OLD.status IS DISTINCT FROM 'Done') THEN
    IF EXISTS (SELECT 1 FROM tasks t WHERE t.parent_task_id = NEW.task_id) THEN
      RAISE EXCEPTION 'A container task cannot be completed directly' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.status = 'Done' THEN
    NEW.completed_at = COALESCE(NEW.completed_at, now());
  ELSE
    NEW.completed_at = NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tasks_container_guard
  BEFORE UPDATE OF status ON tasks
  FOR EACH ROW EXECUTE FUNCTION eh_container_not_done();

CREATE OR REPLACE FUNCTION eh_dependency_guard() RETURNS trigger AS $$
DECLARE
  cycle boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  WITH RECURSIVE chain(task_id, level) AS (
    SELECT NEW.depends_on_task_id, 1
    UNION ALL
    SELECT d.depends_on_task_id, c.level + 1
      FROM task_dependencies d JOIN chain c ON d.task_id = c.task_id
     WHERE c.level < 200
  )
  SELECT EXISTS (SELECT 1 FROM chain WHERE task_id = NEW.task_id) INTO cycle;
  IF cycle THEN
    RAISE EXCEPTION 'Task dependency cycle detected' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER task_dependencies_acyclic
  AFTER INSERT OR UPDATE ON task_dependencies
  FOR EACH ROW EXECUTE FUNCTION eh_dependency_guard();

CREATE OR REPLACE FUNCTION eh_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION eh_append_only();

CREATE TRIGGER deadline_history_append_only
  BEFORE UPDATE OR DELETE ON task_deadline_history
  FOR EACH ROW EXECUTE FUNCTION eh_append_only();

CREATE TRIGGER record_deletions_append_only
  BEFORE DELETE ON record_deletions
  FOR EACH ROW EXECUTE FUNCTION eh_append_only();
