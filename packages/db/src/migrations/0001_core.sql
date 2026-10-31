-- Engineering-HUB V2 schema 1 (core tables)
--
-- Google Sheets was the authoritative store in V1. This schema is authoritative for V2
-- interactive operation. Stable identifiers are preserved as text, calendar dates are DATE,
-- instants are TIMESTAMPTZ, and business-date arithmetic stays in the application (Asia/Tokyo).

CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE members (
  member_id text PRIMARY KEY CHECK (member_id <> ''),
  name text NOT NULL CHECK (name <> ''),
  email citext NOT NULL UNIQUE,
  department text NOT NULL DEFAULT '',
  position text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  manager_id text REFERENCES members(member_id),
  weekly_capacity_hours numeric(6,2) CHECK (weekly_capacity_hours IS NULL OR weekly_capacity_hours >= 0),
  role text CHECK (role IN ('ADMIN','MANAGER','MEMBER','VIEWER')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1)
);

CREATE INDEX members_active_role_idx ON members (active, role);

CREATE TABLE responsibilities (
  responsibility_id text PRIMARY KEY CHECK (responsibility_id <> ''),
  name text NOT NULL CHECK (name <> ''),
  description text NOT NULL DEFAULT '',
  owner_member_id text REFERENCES members(member_id),
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Retired')),
  sort_order integer NOT NULL DEFAULT 0,
  color_hex text CHECK (color_hex IS NULL OR color_hex ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1)
);

CREATE INDEX responsibilities_status_order_idx ON responsibilities (status, sort_order);

CREATE TABLE projects (
  project_id text PRIMARY KEY CHECK (project_id <> ''),
  project_name text NOT NULL CHECK (project_name <> ''),
  description text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '',
  responsibility_id text REFERENCES responsibilities(responsibility_id),
  project_owner_id text REFERENCES members(member_id),
  status text NOT NULL DEFAULT 'Planned'
    CHECK (status IN ('Planned','Active','On Hold','Completed','Cancelled','Archived')),
  priority text NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Low','Medium','High','Critical')),
  planned_start date,
  forecast_end date,
  committed_deadline date,
  original_deadline date,
  actual_completion date,
  progress_percent numeric(5,2) CHECK (progress_percent IS NULL OR (progress_percent >= 0 AND progress_percent <= 100)),
  health text NOT NULL DEFAULT '',
  next_milestone text NOT NULL DEFAULT '',
  next_action text NOT NULL DEFAULT '',
  notification_enabled boolean NOT NULL DEFAULT true,
  dashboard_visibility text NOT NULL DEFAULT 'RESTRICTED'
    CHECK (dashboard_visibility IN ('INTERNAL','RESTRICTED')),
  dashboard_summary text NOT NULL DEFAULT '',
  archived_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  CONSTRAINT projects_archived_marker CHECK (status <> 'Archived' OR archived_at IS NOT NULL)
);

CREATE INDEX projects_responsibility_idx ON projects (responsibility_id);
CREATE INDEX projects_status_idx ON projects (status);
CREATE INDEX projects_deadline_idx ON projects (committed_deadline);
CREATE INDEX projects_owner_idx ON projects (project_owner_id);

CREATE TABLE subprojects (
  subproject_id text PRIMARY KEY CHECK (subproject_id <> ''),
  project_id text NOT NULL REFERENCES projects(project_id),
  parent_subproject_id text REFERENCES subprojects(subproject_id),
  subproject_name text NOT NULL CHECK (subproject_name <> ''),
  owner_id text REFERENCES members(member_id),
  status text NOT NULL DEFAULT 'Planned'
    CHECK (status IN ('Planned','Active','On Hold','Completed','Cancelled','Archived')),
  planned_start date,
  planned_end date,
  deadline date,
  progress_percent numeric(5,2) CHECK (progress_percent IS NULL OR (progress_percent >= 0 AND progress_percent <= 100)),
  estimated_hours numeric(10,2) CHECK (estimated_hours IS NULL OR estimated_hours >= 0),
  next_action text NOT NULL DEFAULT '',
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1)
);

CREATE INDEX subprojects_project_idx ON subprojects (project_id);
CREATE INDEX subprojects_parent_idx ON subprojects (parent_subproject_id);

CREATE TABLE skills (
  skill_id text PRIMARY KEY CHECK (skill_id <> ''),
  skill_name text NOT NULL CHECK (skill_name <> ''),
  category text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  required_level integer CHECK (required_level IS NULL OR (required_level >= 0 AND required_level <= 4))
);

CREATE TABLE tasks (
  task_id text PRIMARY KEY CHECK (task_id <> ''),
  project_id text NOT NULL REFERENCES projects(project_id),
  subproject_id text REFERENCES subprojects(subproject_id),
  parent_task_id text REFERENCES tasks(task_id),
  task_name text NOT NULL CHECK (task_name <> ''),
  description text NOT NULL DEFAULT '',
  owner_member_id text REFERENCES members(member_id),
  status text NOT NULL DEFAULT 'Not Started'
    CHECK (status IN ('Not Started','Assigned','In Progress','Blocked','On Hold','Done','Cancelled')),
  priority text NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Low','Medium','High','Critical')),
  planned_start date,
  due_date date,
  estimated_hours numeric(10,2) CHECK (estimated_hours IS NULL OR estimated_hours >= 0),
  actual_hours numeric(10,2) CHECK (actual_hours IS NULL OR actual_hours >= 0),
  progress_percent numeric(5,2) CHECK (progress_percent IS NULL OR (progress_percent >= 0 AND progress_percent <= 100)),
  acceptance_criteria text NOT NULL DEFAULT '',
  next_action text NOT NULL DEFAULT '',
  required_skill_id text REFERENCES skills(skill_id),
  required_skill_level integer CHECK (required_skill_level IS NULL OR (required_skill_level >= 0 AND required_skill_level <= 4)),
  assignment_version integer NOT NULL DEFAULT 1 CHECK (assignment_version >= 1),
  assignment_approved_at timestamptz,
  notification_enabled boolean NOT NULL DEFAULT false,
  notification_baseline text NOT NULL DEFAULT '',
  public_note text NOT NULL DEFAULT '',
  planned_duration_value numeric(8,2) CHECK (planned_duration_value IS NULL OR planned_duration_value > 0),
  planned_duration_unit text CHECK (planned_duration_unit IN ('DAY','WEEK')),
  planned_duration_basis text CHECK (planned_duration_basis IN ('WORKING_DAYS','CALENDAR_DAYS')),
  planned_start_source text CHECK (planned_start_source IN ('DERIVED','LEGACY','MANUAL')),
  completed_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1)
);

CREATE INDEX tasks_project_idx ON tasks (project_id);
CREATE INDEX tasks_subproject_idx ON tasks (subproject_id);
CREATE INDEX tasks_parent_idx ON tasks (parent_task_id);
CREATE INDEX tasks_owner_idx ON tasks (owner_member_id);
CREATE INDEX tasks_status_idx ON tasks (status);
CREATE INDEX tasks_due_idx ON tasks (due_date) WHERE deleted_at IS NULL;
CREATE INDEX tasks_open_due_idx ON tasks (due_date)
  WHERE status IN ('Not Started','Assigned','In Progress','Blocked','On Hold');

-- Organisation (parent_task_id) and sequencing (task_dependencies) are different concepts.
CREATE TABLE task_dependencies (
  task_id text NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
  depends_on_task_id text NOT NULL REFERENCES tasks(task_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, depends_on_task_id),
  CONSTRAINT task_dependencies_no_self CHECK (task_id <> depends_on_task_id)
);

CREATE INDEX task_dependencies_reverse_idx ON task_dependencies (depends_on_task_id);

-- Additional relationships. The primary owner stays in tasks.owner_member_id /
-- responsibilities.owner_member_id and is never copied here or stored as a list.
CREATE TABLE task_assignees (
  assignment_id text PRIMARY KEY CHECK (assignment_id <> ''),
  task_id text NOT NULL REFERENCES tasks(task_id),
  member_id text NOT NULL REFERENCES members(member_id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by text NOT NULL DEFAULT '',
  removed_at timestamptz,
  removed_by text NOT NULL DEFAULT ''
);

CREATE UNIQUE INDEX task_assignees_active_unique ON task_assignees (task_id, member_id) WHERE removed_at IS NULL;
CREATE INDEX task_assignees_member_idx ON task_assignees (member_id) WHERE removed_at IS NULL;

CREATE TABLE responsibility_members (
  assignment_id text PRIMARY KEY CHECK (assignment_id <> ''),
  responsibility_id text NOT NULL REFERENCES responsibilities(responsibility_id),
  member_id text NOT NULL REFERENCES members(member_id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by text NOT NULL DEFAULT '',
  removed_at timestamptz,
  removed_by text NOT NULL DEFAULT ''
);

CREATE UNIQUE INDEX responsibility_members_active_unique
  ON responsibility_members (responsibility_id, member_id) WHERE removed_at IS NULL;
CREATE INDEX responsibility_members_member_idx
  ON responsibility_members (member_id) WHERE removed_at IS NULL;

CREATE TABLE milestones (
  milestone_id text PRIMARY KEY CHECK (milestone_id <> ''),
  project_id text NOT NULL REFERENCES projects(project_id),
  subproject_id text REFERENCES subprojects(subproject_id),
  milestone_name text NOT NULL CHECK (milestone_name <> ''),
  owner_id text REFERENCES members(member_id),
  target_date date,
  actual_date date,
  gate_type text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT '',
  acceptance_criteria text NOT NULL DEFAULT '',
  verification_result text NOT NULL DEFAULT '',
  calendar_event_id text NOT NULL DEFAULT '',
  calendar_sync_hash text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1)
);

CREATE INDEX milestones_project_idx ON milestones (project_id, target_date);

CREATE TABLE member_skills (
  member_skill_id text PRIMARY KEY CHECK (member_skill_id <> ''),
  member_id text NOT NULL REFERENCES members(member_id),
  skill_id text NOT NULL REFERENCES skills(skill_id),
  current_level integer NOT NULL CHECK (current_level >= 0 AND current_level <= 4),
  assessment_date date,
  assessed_by text REFERENCES members(member_id),
  evidence text NOT NULL DEFAULT '',
  training_action text NOT NULL DEFAULT '',
  next_review_date date,
  UNIQUE (member_id, skill_id)
);

CREATE TABLE issues (
  issue_id text PRIMARY KEY CHECK (issue_id <> ''),
  project_id text NOT NULL REFERENCES projects(project_id),
  subproject_id text REFERENCES subprojects(subproject_id),
  task_id text REFERENCES tasks(task_id),
  description text NOT NULL CHECK (description <> ''),
  severity text NOT NULL DEFAULT 'Medium' CHECK (severity IN ('Low','Medium','High','Critical')),
  status text NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','In Progress','Closed')),
  owner_id text REFERENCES members(member_id),
  raised_date date,
  target_close_date date,
  corrective_action text NOT NULL DEFAULT '',
  last_updated timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1)
);

CREATE INDEX issues_project_idx ON issues (project_id, status);

CREATE TABLE holidays (
  holiday_id text PRIMARY KEY CHECK (holiday_id <> ''),
  date date NOT NULL UNIQUE,
  name text NOT NULL DEFAULT ''
);

CREATE TABLE phase_templates (
  phase_id text PRIMARY KEY CHECK (phase_id <> ''),
  phase_name text NOT NULL CHECK (phase_name <> ''),
  duration_days numeric(8,2),
  buffer_days numeric(8,2),
  dependency_ids text[] NOT NULL DEFAULT '{}'
);

CREATE TABLE project_phases (
  project_phase_id text PRIMARY KEY CHECK (project_phase_id <> ''),
  project_id text NOT NULL REFERENCES projects(project_id),
  phase_id text,
  phase_name text NOT NULL CHECK (phase_name <> ''),
  phase_order integer NOT NULL DEFAULT 0,
  duration_days numeric(8,2),
  buffer_days numeric(8,2),
  dependency_ids text[] NOT NULL DEFAULT '{}',
  planned_start date,
  planned_end date,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PLANNED')),
  committed_deadline date,
  plan_version integer NOT NULL DEFAULT 1 CHECK (plan_version >= 1),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX project_phases_active_unique ON project_phases (project_id, phase_id) WHERE active;

CREATE TABLE schedule_confirmations (
  schedule_confirmation_id text PRIMARY KEY CHECK (schedule_confirmation_id <> ''),
  task_id text NOT NULL REFERENCES tasks(task_id),
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  planned_start date,
  due_date date,
  estimated_hours numeric(10,2),
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  confirmed_by text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT ''
);

CREATE INDEX schedule_confirmations_task_idx ON schedule_confirmations (task_id);
