/**
 * Local visual harness for the UI refresh.
 *
 * It serves every `/api/*` answer from in-memory fixtures, so no database, no server session and no
 * live record is touched. Only the Vite dev server and a headless browser are involved.
 *
 *   node work/ui-refresh-shots.mjs [--only=my-work]
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const ORIGIN = 'http://localhost:5173';
const OUT = 'work/screenshots';
mkdirSync(OUT, { recursive: true });

const only = process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length);

const ADMIN = {
  memberId: 'MEM-ADMIN',
  name: '佐藤 管理者',
  email: 'admin@example.invalid',
  role: 'ADMIN',
  active: true,
  verified: true,
  selfServiceEnabled: true
};

const schedule = (state, missing = null) => ({ state, missing });
const progress = (percent, leaves, doneLeaves) => ({
  percent,
  leaves,
  doneLeaves,
  weightKnown: percent,
  weightUnknown: 0,
  containers: 1
});

const member = (id, name, role = 'MEMBER') => ({
  memberId: id,
  name,
  active: true,
  employeeId: id.slice(-3),
  role,
  email: `${id.toLowerCase()}@example.invalid`,
  department: '設計・開発課',
  position: '技術員'
});

const MEMBERS = [
  member('MEM-001', '佐藤 管理者', 'ADMIN'),
  member('MEM-002', '鈴木 主任', 'MANAGER'),
  member('MEM-003', '田中 技術者'),
  member('MEM-004', '山本 花子'),
  member('MEM-005', '渡辺 一郎'),
  member('MEM-006', '中村 美咲')
];

const RESPONSIBILITIES = [
  { id: 'RSP-1', name: '車載バッテリー分野', status: 'Active', color: '#AD1535', ownerName: '鈴木 主任' },
  { id: 'RSP-2', name: '熱マネジメント分野', status: 'Active', color: '#245EA8', ownerName: '田中 技術者' },
  { id: 'RSP-3', name: '生産技術分野', status: 'Active', color: '#08765B', ownerName: '山本 花子' }
];

const taskSummary = (index, overrides = {}) => ({
  taskId: `TSK-${String(index).padStart(3, '0')}`,
  taskName: `筐体の強度検討および熱解析条件の確定（第${index}次試作）`,
  projectId: 'PRJ-1',
  projectName: '車載バッテリー筐体の軽量化設計',
  subprojectId: 'SUB-1',
  subprojectName: '構造設計',
  responsibilityId: 'RSP-1',
  parentTaskId: null,
  status: 'In Progress',
  displayStatus: index % 5 === 0 ? 'OVERDUE' : 'IN_PROGRESS',
  scheduleMissing: index % 4 === 0 ? 'START' : undefined,
  priority: index % 3 === 0 ? 'High' : 'Medium',
  ownerName: '田中 技術者',
  assigneeNames: ['山本 花子', '渡辺 一郎'],
  assigneeIds: ['MEM-003', 'MEM-004', 'MEM-005'],
  dueDate: index % 5 === 0 ? '2026-10-20' : `2026-11-${String(10 + (index % 18)).padStart(2, '0')}`,
  plannedStart: '2026-11-01',
  progressPercent: (index * 10) % 100,
  overdue: index % 5 === 0,
  reviewState: index % 6 === 0 ? 'PENDING' : 'NONE',
  container: index % 9 === 0,
  depth: 1,
  revision: 1,
  ...overrides
});

const TASKS = Array.from({ length: 24 }, (_, index) => taskSummary(index + 1));

const myWorkItem = (index, overrides = {}) => ({
  container: false,
  taskId: `TSK-${String(index).padStart(3, '0')}`,
  taskName: [
    '筐体の強度検討および熱解析条件の確定',
    '冷却水路の圧力損失評価と治具設計の見直し',
    '樹脂材料の耐候性試験 立ち会いと結果まとめ',
    '組立ライン向け取付ブラケットの干渉確認',
    '量産試作に向けた検査基準書の更新'
  ][(index - 1) % 5],
  projectId: `PRJ-${(index % 3) + 1}`,
  projectName: [
    '車載バッテリー筐体の軽量化設計',
    '急速充放電モジュールの熱マネジメント',
    '生産設備の自動化ライン更新'
  ][(index % 3)],
  subprojectName: ['構造設計', '熱設計', '設備設計'][(index % 3)],
  status: 'In Progress',
  displayStatus: index === 2 ? 'OVERDUE' : index === 4 ? 'START_NOT_SET' : 'IN_PROGRESS',
  scheduleMissing: index === 4 ? 'START' : undefined,
  priority: index % 2 === 0 ? 'High' : 'Medium',
  dueDate: index === 2 ? '2026-10-24' : `2026-11-${String(7 + index * 2).padStart(2, '0')}`,
  progressPercent: index * 15,
  actualHours: 0,
  reviewState: index === 3 ? 'PENDING' : 'NONE',
  lastRequestStatus: '',
  lastRequestType: '',
  pendingRequest: index === 3,
  creationChannel: 'MANAGER',
  completedAt: null,
  revision: 1,
  ...overrides
});

const MY_WORK = [1, 2, 3, 4, 5, 6, 7].map((index) => myWorkItem(index));

const projectRecord = (id, name, responsibilityName, state) => ({
  projectId: id,
  projectName: name,
  description:
    '車載用バッテリーパックの筐体について、衝突安全性能を維持しながら質量を 12% 低減する。\n熱解析と強度解析を並行して進め、量産試作の日程に間に合わせる。',
  category: '開発',
  responsibilityId: 'RSP-1',
  responsibilityName,
  projectOwnerId: 'MEM-002',
  projectOwnerName: '鈴木 主任',
  status: 'Active',
  schedule: schedule(state, state === 'LATE' ? null : 'FINISH'),
  priority: 'High',
  committedDeadline: state === 'LATE' ? '2026-10-15' : '2026-12-25',
  progressPercent: state === 'LATE' ? 42 : 65,
  health: 'Watch',
  dashboardVisibility: 'INTERNAL',
  nextAction: '熱解析条件の確定'
});

const PROJECTS = [
  projectRecord('PRJ-1', '車載バッテリー筐体の軽量化設計', '車載バッテリー分野', 'LATE'),
  projectRecord('PRJ-2', '急速充放電モジュールの熱マネジメント', '熱マネジメント分野', 'IN_PROGRESS'),
  projectRecord('PRJ-3', '生産設備の自動化ライン更新', '生産技術分野', 'IN_PROGRESS'),
  projectRecord('PRJ-4', '次期プラットフォーム向け樹脂材料の選定', '車載バッテリー分野', 'PLANNED'),
  projectRecord('PRJ-5', '検査基準書の電子化と承認フロー整備', '生産技術分野', 'IN_PROGRESS')
];

const PROJECT_DETAIL = {
  record: projectRecord('PRJ-1', '車載バッテリー筐体の軽量化設計', '車載バッテリー分野', 'LATE'),
  progress: progress(42, 12, 5),
  subprojects: [
    {
      subprojectId: 'SUB-1',
      subprojectName: '構造設計',
      description: '筐体の基本構造と締結方法を決定する。',
      parentSubprojectId: null,
      status: 'Active',
      schedule: schedule('LATE'),
      deadline: '2026-10-15',
      depth: 1,
      progress: progress(50, 6, 3)
    },
    {
      subprojectId: 'SUB-2',
      subprojectName: '熱設計',
      description: '',
      parentSubprojectId: null,
      status: 'Active',
      schedule: schedule('IN_PROGRESS'),
      deadline: '2026-12-10',
      depth: 1,
      progress: progress(30, 4, 1)
    }
  ],
  tasks: TASKS.slice(0, 8)
};

const TASK_DETAIL = {
  record: {
    ...taskSummary(1),
    taskId: 'TSK-001',
    taskName: '筐体の強度検討および熱解析条件の確定',
    description:
      '試作1号機の筐体について、衝突解析の境界条件を確定する。\n熱解析と共通の物性値を用いること。',
    ownerMemberId: 'MEM-003',
    requiredSkillId: null,
    requiredSkillLevel: null,
    assignmentVersion: 2,
    assignmentApprovedAt: '2026-10-30T01:00:00.000Z',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-11-04T00:00:00.000Z',
    lastUpdated: '2026-11-04T00:00:00.000Z'
  },
  context: {
    projectName: '車載バッテリー筐体の軽量化設計',
    subprojects: [{ subprojectId: 'SUB-1', subprojectName: '構造設計' }]
  },
  depth: 1,
  assignees: [
    { memberId: 'MEM-003', name: '田中 技術者', primary: true, assignedAt: '2026-10-01T00:00:00.000Z' },
    { memberId: 'MEM-004', name: '山本 花子', primary: false, assignedAt: '2026-10-05T00:00:00.000Z' }
  ],
  assigneeHistory: [],
  children: [],
  deadlineHistory: [],
  confirmations: []
};

const timelineProjectRow = (project, index) => ({
  projectId: project.projectId,
  projectName: project.projectName,
  responsibilityId: 'RSP-1',
  responsibilityName: project.responsibilityName,
  status: 'Active',
  schedule: schedule('IN_PROGRESS'),
  plannedStart: '2026-11-03',
  forecastEnd: '2026-11-28',
  committedDeadline: '2026-12-25',
  progressPercent: 40 + index * 5,
  openWork: 3,
  completedWork: 2,
  childRange: { start: '2026-11-03', end: '2026-11-28', datedItems: 5, totalItems: 5 },
  undated: false,
  scheduleStart: '2026-11-03',
  scheduleFinish: '2026-11-28',
  dateState: 'RANGE',
  dateSource: 'EXPLICIT',
  revision: 1
});

const timelineTaskRow = (task, index) => ({
  taskId: task.taskId,
  projectId: task.projectId,
  subprojectId: 'SUB-1',
  parentTaskId: null,
  taskName: task.taskName,
  status: task.status,
  displayStatus: task.displayStatus,
  plannedStart: '2026-11-03',
  dueDate: task.dueDate,
  completedAt: null,
  container: false,
  depth: 1,
  progressPercent: task.progressPercent,
  childRange: { start: null, end: null, datedItems: 0, totalItems: 0 },
  undated: false,
  inconsistent: false,
  scheduleStart: index % 3 === 0 ? '2026-11-03' : null,
  scheduleFinish: `2026-11-${String(12 + index).padStart(2, '0')}`,
  dateState: index % 3 === 0 ? 'RANGE' : 'FINISH_ONLY',
  dateSource: 'EXPLICIT',
  revision: 1
});

const TIMELINE_PAGE = {
  items: PROJECTS.map(timelineProjectRow),
  total: PROJECTS.length,
  page: 1,
  pageSize: 25,
  totalPages: 1,
  responsibilities: RESPONSIBILITIES.map((entry) => ({
    responsibilityId: entry.id,
    name: entry.name,
    status: 'Active'
  })),
  fitRange: { start: '2026-11-03', end: '2026-11-28' }
};

const TIMELINE_BRANCH = {
  project: timelineProjectRow(PROJECTS[0], 0),
  subprojects: [],
  tasks: TASKS.slice(0, 8).map(timelineTaskRow),
  truncated: false,
  taskTotal: 8,
  fitRange: { start: '2026-11-03', end: '2026-11-28' }
};

const page = (items, extra = {}) => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 25,
  totalPages: 1,
  ...extra
});

function answer(url) {
  const path = url.pathname;
  if (path === '/api/session') return { ok: true, data: { actor: ADMIN, authMode: 'local', csrfToken: 'csrf', expiresAt: new Date(Date.now() + 36e5).toISOString() } };
  if (path === '/api/public-config') return { ok: true, data: { authMode: 'local', release: 'fixture', developmentFixture: false } };
  if (path.startsWith('/api/manager/bootstrap')) {
    return { ok: true, data: { references: { responsibilities: RESPONSIBILITIES, members: MEMBERS, skills: [], subprojects: [] } } };
  }
  if (path.startsWith('/api/manager/references')) {
    return {
      ok: true,
      data: {
        responsibilities: RESPONSIBILITIES,
        members: MEMBERS,
        skills: [
          { skillId: 'SKL-1', skillName: '構造解析' },
          { skillId: 'SKL-2', skillName: '熱流体解析' }
        ],
        subprojects: [
          { id: 'SUB-1', projectId: 'PRJ-1', name: '構造設計', status: 'Active' },
          { id: 'SUB-2', projectId: 'PRJ-1', name: '熱設計', status: 'Active' }
        ]
      }
    };
  }
  if (path.startsWith('/api/manager/overview')) {
    return {
      ok: true,
      data: {
        scope: { responsibilityId: '', unassigned: false, label: '' },
        counts: { workItems: 24, containers: 3, activeWork: 18, openWork: 16, overdueWork: 3, completedWork: 6, cancelledWork: 1 },
        upcomingWindow: { days: 7, from: '2026-11-05', to: '2026-11-11' },
        overdue: TASKS.filter((task) => task.displayStatus === 'OVERDUE'),
        overdueTotal: 3,
        upcoming: TASKS.slice(1, 6),
        upcomingTotal: 5,
        responsibilities: RESPONSIBILITIES.map((entry, index) => ({
          responsibilityId: entry.id,
          name: entry.name,
          color: entry.color,
          status: 'Active',
          projectCount: 2 + index,
          openWork: 6 + index,
          overdueWork: index,
          completedWork: 3,
          ownerName: entry.ownerName
        })),
        projects: PROJECTS,
        pendingRequests: [
          { requestId: 'REQ-1001', status: 'PENDING', requesterName: '田中 技術者', requestType: 'DEADLINE_CHANGE' },
          { requestId: 'REQ-1002', status: 'PENDING', requesterName: '山本 花子', requestType: 'COMPLETION_REPORT' }
        ],
        generatedAt: '2026-11-05T00:00:00.000Z'
      }
    };
  }
  if (path.startsWith('/api/employee/my-work/project-filter')) {
    return { ok: true, data: { items: PROJECTS.map((p) => ({ projectId: p.projectId, projectName: p.projectName })), total: PROJECTS.length, page: 1, totalPages: 1, selected: null } };
  }
  if (path.startsWith('/api/employee/my-work/projects')) {
    return { ok: true, data: { items: PROJECTS.slice(0, 3).map((p) => ({ projectId: p.projectId, projectName: p.projectName, responsibilityName: p.responsibilityName, subprojects: [] })), taskCreationEnabled: true } };
  }
  if (path.startsWith('/api/employee/requests/mine')) {
    return {
      ok: true,
      data: {
        submissionEnabled: true,
        items: [
          { requestId: 'REQ-2001', taskId: 'TSK-003', taskName: '樹脂材料の耐候性試験 立ち会いと結果まとめ', requestType: 'COMPLETION_REPORT', status: 'PENDING', submittedAt: '2026-11-02T03:00:00.000Z', decisionNote: '', staleReason: '' },
          { requestId: 'REQ-2002', taskId: 'TSK-005', taskName: '量産試作に向けた検査基準書の更新', requestType: 'DEADLINE_CHANGE', status: 'APPROVED', submittedAt: '2026-10-28T03:00:00.000Z', decisionNote: '承認しました', staleReason: '' }
        ]
      }
    };
  }
  if (path.startsWith('/api/employee/my-work')) {
    const section = url.searchParams.get('section') ?? 'active';
    return {
      ok: true,
      data: {
        items: section === 'completed' ? MY_WORK.slice(0, 2) : MY_WORK,
        total: section === 'completed' ? 2 : MY_WORK.length,
        activeTotal: MY_WORK.length,
        completedTotal: 2,
        unfilteredActiveTotal: MY_WORK.length
      }
    };
  }
  if (path.startsWith('/api/employee/tasks/')) return { ok: true, data: { eligible: true, reasons: [], reporterName: '佐藤 管理者', submissionEnabled: true } };
  if (path.startsWith('/api/employee/')) return { ok: true, data: {} };
  if (/^\/api\/manager\/tasks\/[^/]+$/.test(path)) return { ok: true, data: TASK_DETAIL };
  if (path.startsWith('/api/manager/tasks')) {
    const parent = url.searchParams.get('treeParentId');
    return { ok: true, data: page(parent ? TASKS.slice(9, 12) : TASKS.slice(0, 9), { matchedTotal: TASKS.length, total: TASKS.length }) };
  }
  if (/^\/api\/manager\/projects\/[^/]+$/.test(path)) return { ok: true, data: PROJECT_DETAIL };
  if (path.startsWith('/api/manager/projects')) {
    return { ok: true, data: page(PROJECTS.map((p) => ({ projectId: p.projectId, projectName: p.projectName, responsibilityName: p.responsibilityName }))) };
  }
  if (path.startsWith('/api/manager/workload')) {
    return {
      ok: true,
      data: {
        generatedAt: '2026-11-05T00:00:00.000Z',
        start: '2026-11-01',
        end: '2026-11-30',
        granularity: 'WEEK',
        summary: { dueTasks: 18, completedTasks: 6, overdueWithinPeriod: 3, backlogBeforePeriod: 2, uniqueTasks: 21, assignments: 26 },
        buckets: [],
        members: MEMBERS.map((m, index) => ({ memberId: m.memberId, name: m.name, dueTasks: 4 + index, completedTasks: index, overdue: index === 0 ? 2 : 0, undated: 0 })),
        responsibilities: RESPONSIBILITIES,
        projects: PROJECTS.map((p) => ({ projectId: p.projectId, projectName: p.projectName }))
      }
    };
  }
  if (path.startsWith('/api/manager/automation')) return { ok: true, data: { status: {}, settings: {} } };
  if (path.startsWith('/api/work/timeline')) {
    const projectId = url.searchParams.get('projectId');
    return { ok: true, data: projectId ? TIMELINE_BRANCH : TIMELINE_PAGE };
  }
  if (path.startsWith('/api/work/projects')) return { ok: true, data: page(PROJECTS.map((p) => ({ projectId: p.projectId, projectName: p.projectName, responsibilityName: p.responsibilityName })), { responsibilities: RESPONSIBILITIES }) };
  if (path.startsWith('/api/work/tasks')) return { ok: true, data: page(TASKS, { matchedTotal: TASKS.length }) };
  if (path.startsWith('/api/work/overview')) return { ok: true, data: {} };
  return { ok: true, data: {} };
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await context.route(
  (url) => url.pathname.startsWith('/api/'),
  async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answer(url)) });
  }
);
await context.addInitScript(() => window.localStorage.setItem('eh.lang', 'ja'));
const tab = await context.newPage();
tab.on('pageerror', (error) => console.error('PAGEERROR', error.message));
tab.on('console', (message) => {
  if (message.type() === 'error') console.error('CONSOLE', message.text().slice(0, 300));
});

const shots = [];
async function shot(name, path, { width = 1440, height = 900, full = false, action } = {}) {
  if (only && !name.startsWith(only)) return;
  await tab.setViewportSize({ width, height });
  await tab.goto(`${ORIGIN}/#/${path}`, { waitUntil: 'networkidle' });
  if (action) await action(tab);
  await tab.waitForTimeout(400);
  const file = `${OUT}/${name}.png`;
  await tab.screenshot({ path: file, fullPage: full });
  const overflow = await tab.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));
  shots.push({ name, file, width, height, overflow, horizontalOverflow: overflow.scrollWidth > overflow.clientWidth + 1 });
  console.log(name, JSON.stringify(overflow));
}

await shot('overview-1440', 'overview');
await shot('my-work-1440', 'my-work');
await shot('my-work-1366', 'my-work', { width: 1366, height: 768 });
await shot('all-tasks-1440', 'all-work');
await shot('all-tasks-1366', 'all-work', { width: 1366, height: 768 });
await shot('projects-1440', 'projects');
await shot('project-detail-1440', 'project/PRJ-1');
await shot('task-detail-1440', 'task/TSK-001');
await shot('task-editor-1440', 'task/TSK-001', {
  action: async (p) => {
    await p.getByRole('button', { name: '編集' }).click();
    await p.waitForTimeout(500);
  }
});
await shot('timeline-1440', 'timeline');
await shot('mobile-my-work-390', 'my-work', { width: 390, height: 844, full: true });
await shot('mobile-all-tasks-390', 'all-work', { width: 390, height: 844, full: true });
await shot('mobile-overview-390', 'overview', { width: 390, height: 844, full: true });
await shot('mobile-nav-390', 'my-work', {
  width: 390,
  height: 844,
  action: async (p) => {
    await p.getByRole('button', { name: 'メニュー' }).click();
    await p.waitForTimeout(300);
  }
});

// One English pass: the language switch must keep the same route, filters and layout.
const englishContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await englishContext.route(
  (url) => url.pathname.startsWith('/api/'),
  async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answer(url)) });
  }
);
await englishContext.addInitScript(() => window.localStorage.setItem('eh.lang', 'en'));
const englishTab = await englishContext.newPage();
for (const [name, path] of [
  ['overview-1440-en', 'overview'],
  ['my-work-1440-en', 'my-work'],
  ['all-tasks-1440-en', 'all-work']
]) {
  await englishTab.goto(`${ORIGIN}/#/${path}`, { waitUntil: 'networkidle' });
  await englishTab.waitForTimeout(400);
  const overflow = await englishTab.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));
  await englishTab.screenshot({ path: `${OUT}/${name}.png` });
  console.log(name, JSON.stringify(overflow));
}

console.log('SHOTS', JSON.stringify(shots, null, 2));
await browser.close();