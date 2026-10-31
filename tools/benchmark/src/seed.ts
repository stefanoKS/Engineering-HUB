/** Deterministic dataset seeding for the benchmark. Insert order respects every foreign key. */
import type pg from 'pg';

const RESPONSIBILITIES = 8;
const TASKS_PER_PROJECT = 10;

export async function seed(
  pool: pg.Pool,
  size: { projects: number; members: number }
): Promise<{ projects: number; tasks: number; members: number }> {
  await pool.query(
    `INSERT INTO members (member_id, name, email, department, position, role, active, weekly_capacity_hours)
     VALUES ('MEM-0001', 'Benchmark Administrator', 'bench-admin@example.co.jp', '設計・開発課', '管理者', 'ADMIN', true, 40)`
  );
  await pool.query(
    `INSERT INTO members (member_id, name, email, department, position, role, active, weekly_capacity_hours)
     SELECT 'MEM-' || lpad(i::text, 4, '0'), 'Benchmark Member ' || i,
            'bench-member-' || i || '@example.co.jp', '設計・開発課', 'エンジニア', 'MEMBER', true, 40
     FROM generate_series(2, $1) AS i`,
    [size.members]
  );

  await pool.query(
    `INSERT INTO responsibilities (responsibility_id, name, description, owner_member_id, status, sort_order, color_hex)
     SELECT 'R-' || lpad(i::text, 2, '0'), '領域 ' || i, 'Benchmark responsibility', 'MEM-0001', 'Active', i, '#3B82F6'
     FROM generate_series(1, $1) AS i`,
    [RESPONSIBILITIES]
  );

  await pool.query(
    `INSERT INTO projects
       (project_id, project_name, category, responsibility_id, project_owner_id, status, priority,
        committed_deadline, original_deadline, planned_start, dashboard_visibility, dashboard_summary)
     SELECT 'P-' || lpad(i::text, 6, '0'), 'Benchmark Project ' || i, '開発',
            'R-' || lpad(((i % $2) + 1)::text, 2, '0'), 'MEM-0001', 'Active', 'Medium',
            current_date + ((i % 90) + 1), current_date + ((i % 90) + 1), current_date - 20,
            'INTERNAL', 'Benchmark published summary'
     FROM generate_series(1, $1) AS i`,
    [size.projects, RESPONSIBILITIES]
  );

  await pool.query(
    `INSERT INTO tasks
       (task_id, project_id, task_name, description, owner_member_id, status, priority,
        planned_start, due_date, estimated_hours, progress_percent, next_action,
        planned_duration_value, planned_duration_unit, planned_duration_basis, planned_start_source,
        notification_enabled)
     SELECT 'T-' || lpad((((p - 1) * 10) + k)::text, 7, '0'), 'P-' || lpad(p::text, 6, '0'),
            'Benchmark Task ' || p || '-' || k, 'Benchmark task description text',
            'MEM-' || lpad((((p + k) % $2) + 1)::text, 4, '0'),
            CASE WHEN (p + k) % 7 = 0 THEN 'Done'
                 WHEN (p + k) % 5 = 0 THEN 'In Progress'
                 WHEN (p + k) % 11 = 0 THEN 'Blocked'
                 ELSE 'Not Started' END,
            'Medium', current_date - 10, current_date + ((p + k) % 120) - 30,
            8, CASE WHEN (p + k) % 7 = 0 THEN 100 ELSE ((p + k) % 9) * 10 END, 'Next action',
            2, 'DAY', 'WORKING_DAYS', 'DERIVED', false
     FROM generate_series(1, $1) AS p, generate_series(1, ${TASKS_PER_PROJECT}) AS k`,
    [size.projects, size.members]
  );

  await pool.query(
    `INSERT INTO task_assignees (assignment_id, task_id, member_id, assigned_at, assigned_by)
     SELECT 'ASN-' || lpad((((p - 1) * 10) + k)::text, 7, '0'), 'T-' || lpad((((p - 1) * 10) + k)::text, 7, '0'),
            'MEM-' || lpad((((p + k) % $2) + 1)::text, 4, '0'), now() - interval '5 days', 'MEM-0001'
     FROM generate_series(1, $1) AS p, generate_series(1, ${TASKS_PER_PROJECT}) AS k
     WHERE k <= 2`,
    [size.projects, size.members]
  );

  await pool.query(
    `INSERT INTO task_requests
       (request_id, task_id, request_type, requester_name, requested_due_date, reason, status,
        snapshot_version, task_revision_at_submission, due_date_at_submission, submitted_at)
     SELECT 'REQ-' || lpad((((p - 1) * 10) + k)::text, 7, '0'), 'T-' || lpad((((p - 1) * 10) + k)::text, 7, '0'),
            'DEADLINE_CHANGE', 'Benchmark Requester', current_date + 45, 'Benchmark request',
            'PENDING', '1.6', '1', current_date + ((p + k) % 120) - 30, now() - interval '1 day'
     FROM generate_series(1, $1) AS p, generate_series(1, ${TASKS_PER_PROJECT}) AS k
     WHERE (p + k) % 20 = 0`,
    [size.projects]
  );

  return {
    projects: size.projects,
    tasks: size.projects * TASKS_PER_PROJECT,
    members: size.members
  };
}
