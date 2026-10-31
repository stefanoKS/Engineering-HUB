-- Helper functions for bounded hierarchy walks used by list projections.

CREATE OR REPLACE FUNCTION eh_task_depth(start_id text) RETURNS integer AS $$
DECLARE
  depth integer := 1;
  cursor_id text;
BEGIN
  SELECT parent_task_id INTO cursor_id FROM tasks WHERE task_id = start_id;
  WHILE cursor_id IS NOT NULL LOOP
    depth := depth + 1;
    IF depth > 10 THEN
      RETURN depth;
    END IF;
    SELECT parent_task_id INTO cursor_id FROM tasks WHERE task_id = cursor_id;
  END LOOP;
  RETURN depth;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION eh_subproject_depth(start_id text) RETURNS integer AS $$
DECLARE
  depth integer := 1;
  cursor_id text;
BEGIN
  SELECT parent_subproject_id INTO cursor_id FROM subprojects WHERE subproject_id = start_id;
  WHILE cursor_id IS NOT NULL LOOP
    depth := depth + 1;
    IF depth > 10 THEN
      RETURN depth;
    END IF;
    SELECT parent_subproject_id INTO cursor_id FROM subprojects WHERE subproject_id = cursor_id;
  END LOOP;
  RETURN depth;
END;
$$ LANGUAGE plpgsql STABLE;
