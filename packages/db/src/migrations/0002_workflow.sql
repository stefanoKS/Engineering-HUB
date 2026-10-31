-- Engineering-HUB V2 schema 1 (workflow, evidence, transport tables)

CREATE TABLE task_requests (
  request_id text PRIMARY KEY CHECK (request_id <> ''),
  request_type text NOT NULL CHECK (request_type IN ('DEADLINE_CHANGE','COMPLETION_REPORT')),
  task_id text NOT NULL REFERENCES tasks(task_id),
  project_id text REFERENCES projects(project_id),
  requester_name text NOT NULL DEFAULT '',
  submitted_at timestamptz NOT NULL DEFAULT now(),
  original_due_date date,
  requested_due_date date,
  reason text NOT NULL DEFAULT '',
  explanation text NOT NULL DEFAULT '',
  completion_note text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','PROCESSING','APPROVED','REJECTED','RETURNED','WITHDRAWN','STALE')),
  reviewer text NOT NULL DEFAULT '',
  decided_at timestamptz,
  decision_note text NOT NULL DEFAULT '',
  task_revision_at_submission text NOT NULL DEFAULT '',
  due_date_at_submission date,
  reported_completion_at timestamptz,
  accepted_completion_at timestamptz,
  inbox_request_id text UNIQUE,
  imported_at timestamptz,
  snapshot_version text NOT NULL DEFAULT '',
  stale_reason text NOT NULL DEFAULT '',
  failure_reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1)
);

CREATE INDEX task_requests_status_idx ON task_requests (status, submitted_at DESC);
CREATE INDEX task_requests_task_idx ON task_requests (task_id, submitted_at DESC);

CREATE TABLE task_deadline_history (
  history_id text PRIMARY KEY CHECK (history_id <> ''),
  task_id text NOT NULL REFERENCES tasks(task_id),
  request_id text REFERENCES task_requests(request_id),
  previous_due_date date,
  new_due_date date,
  previous_planned_start date,
  new_planned_start date,
  reason text NOT NULL DEFAULT '',
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT ''
);

CREATE INDEX task_deadline_history_task_idx ON task_deadline_history (task_id, changed_at DESC);

CREATE TABLE notification_ledger (
  notification_id text PRIMARY KEY CHECK (notification_id <> ''),
  notification_key text NOT NULL UNIQUE,
  task_id text REFERENCES tasks(task_id),
  recipient text NOT NULL,
  notification_type text NOT NULL,
  assignment_version integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  result text NOT NULL DEFAULT 'PENDING'
    CHECK (result IN ('PENDING','SENT','PREVIEW','DELIVERY_UNCERTAIN','FAILED','SKIPPED')),
  error_details text NOT NULL DEFAULT '',
  attempts integer NOT NULL DEFAULT 0,
  reconciled_at timestamptz,
  reconciled_by text NOT NULL DEFAULT ''
);

CREATE INDEX notification_ledger_result_idx ON notification_ledger (result, created_at);
CREATE INDEX notification_ledger_task_idx ON notification_ledger (task_id);

CREATE TABLE audit_log (
  audit_id bigserial PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  action text NOT NULL,
  previous_value jsonb,
  new_value jsonb,
  actor_email text NOT NULL DEFAULT '',
  actor_member_id text NOT NULL DEFAULT '',
  result text NOT NULL DEFAULT 'OK' CHECK (result IN ('OK','REFUSED','FAILED')),
  correlation_id text NOT NULL DEFAULT '',
  request_id text NOT NULL DEFAULT ''
);

CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id, occurred_at DESC);
CREATE INDEX audit_log_occurred_idx ON audit_log (occurred_at DESC);
CREATE INDEX audit_log_action_idx ON audit_log (action, occurred_at DESC);

CREATE TABLE record_deletions (
  tombstone_id text PRIMARY KEY CHECK (tombstone_id <> ''),
  entity_type text NOT NULL CHECK (entity_type IN ('PROJECTS','SUBPROJECTS','TASKS')),
  entity_id text NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  deleted_by text NOT NULL,
  reason text NOT NULL CHECK (reason <> ''),
  last_revision integer NOT NULL,
  snapshot jsonb NOT NULL,
  reconciled_at timestamptz,
  reconciled_by text NOT NULL DEFAULT '',
  UNIQUE (entity_type, entity_id)
);

CREATE TABLE app_settings (
  setting_id text PRIMARY KEY CHECK (setting_id <> ''),
  value text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1)
);

CREATE TABLE backup_log (
  backup_id text PRIMARY KEY CHECK (backup_id <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  schema_version integer NOT NULL,
  backup_reference text NOT NULL DEFAULT '',
  result text NOT NULL DEFAULT 'PENDING',
  error_details text NOT NULL DEFAULT '',
  checksum text NOT NULL DEFAULT '',
  size_bytes bigint,
  manifest jsonb
);

CREATE INDEX backup_log_created_idx ON backup_log (created_at DESC);

CREATE TABLE outbox_jobs (
  job_id bigserial PRIMARY KEY,
  kind text NOT NULL,
  payload jsonb NOT NULL,
  dedupe_key text UNIQUE,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','LEASED','DONE','FAILED','CANCELLED')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 6,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text NOT NULL DEFAULT '',
  lease_expires_at timestamptz,
  last_error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  correlation_id text NOT NULL DEFAULT ''
);

CREATE INDEX outbox_ready_idx ON outbox_jobs (status, available_at) WHERE status = 'PENDING';
CREATE INDEX outbox_lease_idx ON outbox_jobs (status, lease_expires_at) WHERE status = 'LEASED';

CREATE TABLE idempotency_keys (
  scope text NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL,
  status text NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS','COMPLETED')),
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  PRIMARY KEY (scope, key)
);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  member_id text NOT NULL REFERENCES members(member_id) ON DELETE CASCADE,
  csrf_token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  user_agent_hash text NOT NULL DEFAULT ''
);

CREATE INDEX sessions_member_idx ON sessions (member_id);

CREATE TABLE published_snapshots (
  slot char(1) PRIMARY KEY CHECK (slot IN ('A','B')),
  contract_version text NOT NULL,
  publisher_version text NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  hash text NOT NULL,
  row_counts jsonb NOT NULL,
  rows jsonb NOT NULL
);

CREATE TABLE published_meta (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  active_slot text CHECK (active_slot IN ('A','B','NONE')),
  contract_version text NOT NULL DEFAULT '',
  publisher_version text NOT NULL DEFAULT '',
  hash text NOT NULL DEFAULT '',
  row_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_at timestamptz,
  last_result text NOT NULL DEFAULT '',
  last_error text NOT NULL DEFAULT ''
);

INSERT INTO published_meta (id, active_slot) VALUES (1, 'NONE') ON CONFLICT DO NOTHING;

CREATE TABLE import_runs (
  run_id text PRIMARY KEY,
  source_label text NOT NULL,
  source_checksum text NOT NULL DEFAULT '',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING','COMPLETED','FAILED','DRY_RUN')),
  row_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text NOT NULL DEFAULT ''
);
