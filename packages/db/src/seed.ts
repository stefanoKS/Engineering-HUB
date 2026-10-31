/**
 * Demo dataset for development and benchmarking.
 *
 * It seeds a small, realistic department: responsibilities, members, nested work and settled
 * settings. It refuses a non-empty database unless `force` is given, so a demo seed can never
 * overwrite migrated production data by accident.
 */
import { createPool, Database, toDatabaseConfig } from './pool';
import { runMigrations } from './migrate';
import { insertMember } from './repo/directory';
import { insertResponsibility } from './repo/directory';
import { insertProject, insertSubproject } from './repo/work';
import { insertTask } from './repo/tasks';
import { KNOWN_SETTINGS } from './repo/system';
import { addDays, businessDate } from '@eh/domain';

export async function seedDemo(db: Database, options: { force?: boolean; tasks?: number } = {}): Promise<{ seeded: boolean; counts: Record<string, number> }> {
  const existing = await db.one<{ count: string }>('SELECT count(*)::text AS count FROM members');
  if (Number(existing?.count ?? 0) > 0 && !options.force) {
    return { seeded: false, counts: {} };
  }
  const today = businessDate();
  const counts: Record<string, number> = {};

  for (const [key, definition] of Object.entries(KNOWN_SETTINGS)) {
    await db.query(
      `INSERT INTO app_settings (setting_id, value, description) VALUES ($1,$2,$3)
       ON CONFLICT (setting_id) DO NOTHING`,
      [key, definition.defaultValue, definition.description]
    );
  }

  await db.query(
    `INSERT INTO holidays (holiday_id, date, name) VALUES
       ('HOL-2026-01-01','2026-01-01','元日'),
       ('HOL-2026-01-12','2026-01-12','成人の日'),
       ('HOL-2026-02-11','2026-02-11','建国記念の日'),
       ('HOL-2026-05-03','2026-05-03','憲法記念日')
     ON CONFLICT (date) DO NOTHING`
  );

  const admin = await insertMember(db, {
    name: '佐藤 管理者',
    email: 'admin@example.co.jp',
    department: '設計・開発課',
    position: '課長',
    role: 'ADMIN',
    weeklyCapacityHours: 40
  }, 'MEM-ADMIN');
  const manager = await insertMember(db, {
    name: '鈴木 主任',
    email: 'manager@example.co.jp',
    department: '設計・開発課',
    position: '主任',
    role: 'MANAGER',
    weeklyCapacityHours: 40
  }, 'MEM-MANAGER');
  const memberA = await insertMember(db, {
    name: '田中 技術者',
    email: 'member.a@example.co.jp',
    department: '設計・開発課',
    position: '設計担当',
    role: 'MEMBER',
    weeklyCapacityHours: 40
  }, 'MEM-MEMBER-A');
  const memberB = await insertMember(db, {
    name: '高橋 技術者',
    email: 'member.b@example.co.jp',
    department: '設計・開発課',
    position: '開発担当',
    role: 'MEMBER',
    weeklyCapacityHours: 40
  }, 'MEM-MEMBER-B');
  const viewer = await insertMember(db, {
    name: '伊藤 閲覧者',
    email: 'viewer@example.co.jp',
    department: '管理部',
    position: '閲覧',
    role: 'VIEWER',
    weeklyCapacityHours: null
  }, 'MEM-VIEWER');
  counts.members = 5;

  const design = await insertResponsibility(db, {
    name: '機械設計',
    description: '機構設計と図面',
    ownerMemberId: manager.memberId,
    sortOrder: 1,
    colorHex: '#2563EB'
  }, 'RSP-DESIGN');
  const software = await insertResponsibility(db, {
    name: 'ソフトウェア開発',
    description: '制御ソフトウェア',
    ownerMemberId: admin.memberId,
    sortOrder: 2,
    colorHex: '#0D9488'
  }, 'RSP-SOFT');
  counts.responsibilities = 2;

  const pump = await insertProject(db, {
    projectName: '新型ポンプ開発',
    description: '次期主力ポンプの設計・試作',
    category: 'Product',
    responsibilityId: design.responsibilityId,
    projectOwnerId: manager.memberId,
    status: 'Active',
    priority: 'High',
    plannedStart: addDays(today, -45),
    committedDeadline: addDays(today, 45),
    originalDeadline: addDays(today, 45),
    nextMilestone: '試作評価',
    nextAction: '試作図面の承認',
    dashboardVisibility: 'INTERNAL',
    dashboardSummary: '試作評価に向けた設計を進行中'
  }, 'PRJ-PUMP');
  const controller = await insertProject(db, {
    projectName: '制御ユニット刷新',
    description: '制御基板とファームウェアの刷新',
    category: 'Product',
    responsibilityId: software.responsibilityId,
    projectOwnerId: admin.memberId,
    status: 'Active',
    priority: 'Medium',
    plannedStart: addDays(today, -20),
    committedDeadline: addDays(today, 75),
    nextAction: '要件定義の合意',
    dashboardVisibility: 'RESTRICTED'
  }, 'PRJ-CTRL');
  counts.projects = 2;

  const pumpBody = await insertSubproject(db, {
    projectId: pump.projectId,
    subprojectName: '本体設計',
    ownerId: memberA.memberId,
    status: 'Active',
    deadline: addDays(today, 20)
  }, 'SUB-BODY');
  const pumpEvaluation = await insertSubproject(db, {
    projectId: pump.projectId,
    parentSubprojectId: pumpBody.subprojectId,
    subprojectName: '試作評価',
    ownerId: memberB.memberId,
    status: 'Planned',
    deadline: addDays(today, 40)
  }, 'SUB-EVAL');
  counts.subprojects = 2;

  const rootTask = await insertTask(db, {
    projectId: pump.projectId,
    subprojectId: pumpBody.subprojectId,
    taskName: 'ポンプ本体の詳細設計',
    ownerMemberId: memberA.memberId,
    status: 'In Progress',
    priority: 'High',
    dueDate: addDays(today, 14),
    estimatedHours: 60,
    actualHours: 22,
    progressPercent: 40,
    plannedDurationValue: 10,
    plannedDurationUnit: 'DAY',
    plannedDurationBasis: 'WORKING_DAYS'
  }, 'TSK-PUMP-ROOT');
  await insertTask(db, {
    projectId: pump.projectId,
    subprojectId: pumpBody.subprojectId,
    parentTaskId: rootTask.taskId,
    taskName: 'ケーシング図面',
    ownerMemberId: memberA.memberId,
    status: 'In Progress',
    priority: 'High',
    dueDate: addDays(today, 7),
    estimatedHours: 20,
    actualHours: 8,
    progressPercent: 40
  }, 'TSK-PUMP-CASING');
  await insertTask(db, {
    projectId: pump.projectId,
    subprojectId: pumpBody.subprojectId,
    parentTaskId: rootTask.taskId,
    taskName: '軸受部の強度計算',
    ownerMemberId: memberB.memberId,
    status: 'Not Started',
    priority: 'Medium',
    dueDate: addDays(today, 12),
    estimatedHours: null,
    progressPercent: 0
  }, 'TSK-PUMP-BEARING');
  await db.query(
    "INSERT INTO task_assignees (assignment_id, task_id, member_id, assigned_by) VALUES ('TAS-1','TSK-PUMP-CASING','MEM-MEMBER-B','MEM-MANAGER') ON CONFLICT DO NOTHING"
  );
  await insertTask(db, {
    projectId: pump.projectId,
    subprojectId: pumpEvaluation.subprojectId,
    taskName: '試作機の性能試験',
    ownerMemberId: memberB.memberId,
    status: 'Not Started',
    priority: 'Medium',
    dueDate: addDays(today, 35),
    estimatedHours: 40,
    progressPercent: 0,
    notificationEnabled: true
  }, 'TSK-PUMP-TEST');
  await insertTask(db, {
    projectId: controller.projectId,
    taskName: '制御要件の整理',
    ownerMemberId: manager.memberId,
    status: 'Blocked',
    priority: 'High',
    dueDate: addDays(today, -3),
    estimatedHours: 16,
    actualHours: 6,
    progressPercent: 25
  }, 'TSK-CTRL-REQ');
  await insertTask(db, {
    projectId: controller.projectId,
    taskName: 'ファームウェア更新計画',
    ownerMemberId: null,
    status: 'Not Started',
    priority: 'Low',
    dueDate: addDays(today, 50),
    progressPercent: 0
  }, 'TSK-CTRL-FW');

  const extra = options.tasks ?? 0;
  for (let index = 0; index < extra; index += 1) {
    const target = index % 2 === 0 ? pump.projectId : controller.projectId;
    await insertTask(db, {
      projectId: target,
      subprojectId: target === pump.projectId ? (index % 4 === 0 ? pumpBody.subprojectId : pumpEvaluation.subprojectId) : null,
      taskName: `量産準備タスク ${String(index + 1).padStart(4, '0')}`,
      ownerMemberId: index % 3 === 0 ? memberA.memberId : memberB.memberId,
      status: index % 5 === 0 ? 'Done' : index % 7 === 0 ? 'Blocked' : 'In Progress',
      priority: index % 4 === 0 ? 'Critical' : 'Medium',
      dueDate: addDays(today, (index % 90) - 20),
      estimatedHours: index % 6 === 0 ? null : 4 + (index % 20),
      actualHours: index % 4,
      progressPercent: index % 101,
      plannedDurationValue: index % 6 === 0 ? null : 3,
      plannedDurationUnit: 'DAY',
      plannedDurationBasis: 'WORKING_DAYS'
    });
  }
  counts.tasks = 6 + extra;

  await db.query(
    `INSERT INTO task_requests
       (request_id, request_type, task_id, project_id, requester_name, requested_due_date, reason,
        status, task_revision_at_submission, due_date_at_submission, snapshot_version, inbox_request_id, imported_at)
     VALUES ('REQ-DEMO-1','DEADLINE_CHANGE','TSK-CTRL-REQ','PRJ-CTRL','高橋 技術者',$1,'部品調達の遅延',
             'PENDING','1',$2,'rev:1','INBOX-DEMO-1', now())`,
    [addDays(today, 10), addDays(today, -3)]
  );
  counts.requests = 1;

  void viewer;
  await db.query(
    `INSERT INTO audit_log (entity_type, entity_id, action, actor_email, actor_member_id)
     VALUES ('DEMO','SEED','DEMO_SEEDED',$1,$2)`,
    [admin.email, admin.memberId]
  );
  return { seeded: true, counts };
}

async function main(): Promise<void> {
  const pool = createPool(toDatabaseConfig(process.env));
  const db = new Database(pool);
  try {
    await runMigrations(pool);
    const result = await seedDemo(db, { tasks: Number(process.env.SEED_TASKS ?? 0) });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await db.close();
  }
}

const invokedDirectly = process.argv[1] ? process.argv[1].endsWith('seed.ts') : false;
if (invokedDirectly) {
  main().catch((error: unknown) => {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exitCode = 1;
  });
}
