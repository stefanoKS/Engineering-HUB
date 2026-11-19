-- 0013_planning_board
--
-- Additive migration for the Planning Board (計画ボード) and for the minimal operational ordering
-- support its export needs.
--
-- Nothing here is destructive: no row is removed, no existing column is rewritten and every
-- existing project, subproject and task keeps its identifier. A planning draft is a private
-- working document of its author; it never participates in task counts, reporting, publication,
-- notification, assignment approval or completion.

CREATE TABLE plan_drafts (
  plan_id text PRIMARY KEY CHECK (plan_id <> ''),
  contract_version text NOT NULL DEFAULT '1.0',
  title text NOT NULL CHECK (title <> ''),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','EXPORTED','ARCHIVED')),
  author_member_id text NOT NULL REFERENCES members(member_id),
  division_id text REFERENCES divisions(division_id),
  responsibility_id text REFERENCES responsibilities(responsibility_id),
  destination_mode text NOT NULL DEFAULT 'NEW_PROJECT'
    CHECK (destination_mode IN ('NEW_PROJECT','EXISTING_PROJECT')),
  destination_project_id text REFERENCES projects(project_id),
  project_owner_id text REFERENCES members(member_id),
  dashboard_visibility text NOT NULL DEFAULT 'RESTRICTED'
    CHECK (dashboard_visibility IN ('INTERNAL','RESTRICTED')),
  schedule_mode text NOT NULL DEFAULT 'MANUAL' CHECK (schedule_mode IN ('MANUAL','DURATION')),
  exported_at timestamptz,
  export_receipt jsonb,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  CONSTRAINT plan_drafts_new_project_division CHECK (
    destination_mode <> 'NEW_PROJECT' OR division_id IS NOT NULL
  ),
  CONSTRAINT plan_drafts_existing_project_reference CHECK (
    destination_mode <> 'EXISTING_PROJECT' OR destination_project_id IS NOT NULL
  )
);

CREATE INDEX plan_drafts_author_idx ON plan_drafts (author_member_id, status, updated_at DESC);

CREATE TABLE plan_items (
  item_id text PRIMARY KEY CHECK (item_id <> ''),
  plan_id text NOT NULL REFERENCES plan_drafts(plan_id),
  -- Deferred so a re-save may upsert children before their parent; the complete set is validated
  -- by the domain layer and again by the export before anything operational is written.
  parent_item_id text REFERENCES plan_items(item_id) DEFERRABLE INITIALLY DEFERRED,
  item_type text NOT NULL CHECK (item_type IN ('SUBPROJECT','TASK')),
  sort_order integer NOT NULL DEFAULT 0,
  name text NOT NULL DEFAULT '',
  start_date date,
  finish_date date,
  duration_value numeric(8,2) CHECK (duration_value IS NULL OR duration_value > 0),
  duration_unit text CHECK (duration_unit IN ('DAY','WEEK')),
  duration_basis text CHECK (duration_basis IN ('WORKING_DAYS','CALENDAR_DAYS')),
  owner_member_id text REFERENCES members(member_id),
  -- Draft-only list of additional assignees. Operational assignees are always written to
  -- task_assignees on export; this array never becomes an authorization or an operational row.
  additional_assignee_ids text[] NOT NULL DEFAULT '{}',
  removed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX plan_items_plan_idx ON plan_items (plan_id, sort_order);
CREATE INDEX plan_items_parent_idx ON plan_items (parent_item_id);

CREATE TABLE plan_exports (
  export_id text PRIMARY KEY CHECK (export_id <> ''),
  plan_id text NOT NULL REFERENCES plan_drafts(plan_id),
  plan_revision integer NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  status text NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED')),
  receipt jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, idempotency_key)
);

CREATE INDEX plan_exports_plan_idx ON plan_exports (plan_id, created_at DESC);

-- Minimal operational ordering: the manual order of an exported plan is preserved per parent.
-- Existing rows keep 0 and the current screens keep their existing ordering; the column is written
-- by the planning export only.
ALTER TABLE subprojects ADD COLUMN sort_order integer NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN sort_order integer NOT NULL DEFAULT 0;

CREATE INDEX subprojects_order_idx ON subprojects (project_id, sort_order);
CREATE INDEX tasks_order_idx ON tasks (project_id, subproject_id, sort_order);
