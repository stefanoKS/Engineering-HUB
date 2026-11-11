-- Engineering-HUB V2 schema 12: administrator-managed divisions (課)
--
-- A division is the organisational boundary of the department: it decides where a role may act
-- and who may be assigned. It is additive only. Existing rows keep their identifiers, and a
-- project's division stays NULL until an administrator maps it deliberately, so no historical
-- work is guessed into a division by this migration.
--
-- Nothing here seeds example divisions: the approved bootstrap/configuration step creates the
-- three operating divisions for a deployment, and a mapping step assigns existing work.

CREATE TABLE divisions (
  division_id text PRIMARY KEY CHECK (division_id <> ''),
  name text NOT NULL CHECK (name <> ''),
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Retired')),
  sort_order integer NOT NULL DEFAULT 0,
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  CONSTRAINT divisions_retired_marker CHECK (status <> 'Retired' OR retired_at IS NOT NULL)
);

CREATE UNIQUE INDEX divisions_name_unique ON divisions (lower(name));
CREATE INDEX divisions_status_order_idx ON divisions (status, sort_order);

-- One active relationship per member and division. `WORK` is membership (assignment eligible and
-- able to act per role); `READ` is additional read-only visibility. Removal is a soft change.
CREATE TABLE member_divisions (
  relationship_id text PRIMARY KEY CHECK (relationship_id <> ''),
  member_id text NOT NULL REFERENCES members(member_id),
  division_id text NOT NULL REFERENCES divisions(division_id),
  access_kind text NOT NULL CHECK (access_kind IN ('WORK','READ')),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by text NOT NULL DEFAULT '',
  removed_at timestamptz,
  removed_by text NOT NULL DEFAULT '',
  CONSTRAINT member_divisions_removed_marker CHECK (removed_at IS NULL OR removed_by <> '')
);

CREATE UNIQUE INDEX member_divisions_active_unique
  ON member_divisions (member_id, division_id) WHERE removed_at IS NULL;
CREATE INDEX member_divisions_division_idx
  ON member_divisions (division_id) WHERE removed_at IS NULL;

-- GENERAL_MANAGER (次長) is cross-division read-only oversight. It is a stored value, and the
-- domain policy (not the numeric order) decides what it may do.
ALTER TABLE members DROP CONSTRAINT members_role_check;
ALTER TABLE members ADD CONSTRAINT members_role_check
  CHECK (role IN ('ADMIN','MANAGER','GENERAL_MANAGER','MEMBER','VIEWER'));

-- `true` means oversight of every division, including a division created later. It is ignored for
-- every other role, so a stale flag can never widen access.
ALTER TABLE members ADD COLUMN all_divisions_read boolean NOT NULL DEFAULT false;

-- The canonical division of work. Tasks and subprojects derive it through their project, so a
-- child record never stores a second, independently editable division.
ALTER TABLE responsibilities ADD COLUMN division_id text REFERENCES divisions(division_id);
ALTER TABLE projects ADD COLUMN division_id text REFERENCES divisions(division_id);

CREATE INDEX projects_division_idx ON projects (division_id);
CREATE INDEX responsibilities_division_idx ON responsibilities (division_id);

-- A scoped responsibility and its projects can never disagree about the division.
CREATE OR REPLACE FUNCTION eh_check_project_division() RETURNS trigger AS $$
DECLARE
  responsibility_division text;
BEGIN
  IF NEW.responsibility_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT division_id INTO responsibility_division
    FROM responsibilities WHERE responsibility_id = NEW.responsibility_id;
  IF responsibility_division IS NOT NULL AND NEW.division_id IS DISTINCT FROM responsibility_division THEN
    RAISE EXCEPTION 'PROJECT_DIVISION_MISMATCH: project % and responsibility % disagree', NEW.project_id, NEW.responsibility_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER projects_division_matches_responsibility
  BEFORE INSERT OR UPDATE OF division_id, responsibility_id ON projects
  FOR EACH ROW EXECUTE FUNCTION eh_check_project_division();

-- Moving an area to another division must not orphan its projects.
CREATE OR REPLACE FUNCTION eh_check_responsibility_division() RETURNS trigger AS $$
DECLARE
  mismatched integer;
BEGIN
  IF NEW.division_id IS NULL OR NEW.division_id IS NOT DISTINCT FROM OLD.division_id THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO mismatched
    FROM projects
   WHERE responsibility_id = NEW.responsibility_id
     AND (division_id IS NULL OR division_id IS DISTINCT FROM NEW.division_id);
  IF mismatched > 0 THEN
    RAISE EXCEPTION 'RESPONSIBILITY_DIVISION_MISMATCH: % project(s) still belong to another division', mismatched
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER responsibilities_division_matches_projects
  BEFORE UPDATE OF division_id ON responsibilities
  FOR EACH ROW EXECUTE FUNCTION eh_check_responsibility_division();
