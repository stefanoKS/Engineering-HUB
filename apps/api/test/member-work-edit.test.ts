/**
 * Role, assignment, completion and account integration tests against real PostgreSQL.
 *
 * These prove the properties that a mock cannot: server-side authorization for every role, the
 * personal work boundary, the unified multi-assignee write, manager direct completion with request
 * reconciliation, the derived overdue state and the create-or-link account command.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { Database, insertProject, insertSubproject } from '@eh/db';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { NullInboxSource } from '../src/inbox';
import { hashPassword } from '../src/auth/password';
import { freshDatabase, seedTestDivisions } from '../../../packages/db/test/support/db';

let app: FastifyInstance;
let db: Database;
let pool: pg.Pool;
let hash: string;

const password = 'Roles-test-password-123';

beforeAll(async () => {
  hash = await hashPassword(password);
});

beforeEach(async () => {
  const context = await freshDatabase();
  db = context.db;
  pool = context.pool;
  await db.query(
    "INSERT INTO members(member_id,name,role) VALUES('MEM-ADMIN','Admin','ADMIN'),('MEM-MANAGER','Manager','MANAGER'),('MEM-A','Member A','MEMBER'),('MEM-B','Member B','MEMBER'),('MEM-VIEW','Viewer','VIEWER'),('MEM-STAFF','Existing Staff','MANAGER')"
  );
  await db.query(
    `INSERT INTO local_accounts(member_id,employee_id,password_hash,must_change_password) VALUES
      ('MEM-ADMIN','0001',$1,false),('MEM-MANAGER','0002',$1,false),('MEM-A','0010',$1,false),
      ('MEM-B','0011',$1,false),('MEM-VIEW','0020',$1,false)`,
    [hash]
  );
  await insertProject(db, { projectName: 'Alpha', status: 'Active', dashboardVisibility: 'INTERNAL' }, 'PRJ-A');
  await seedTestDivisions(db);
  app = await buildApp({
    db,
    inbox: new NullInboxSource(),
    logger: false,
    config: loadConfig({
      NODE_ENV: 'test',
      AUTH_MODE: 'local',
      PUBLIC_ORIGIN: 'http://localhost:8050'
    })
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await pool.end();
});

async function login(employeeId: string): Promise<Record<string, string>> {
  const response = await app.inject({ method: 'POST', url: '/api/session', payload: { employeeId, password } });
  expect(response.statusCode, response.body).toBe(200);
  return {
    cookie: String(response.headers['set-cookie']).split(';')[0]!,
    'x-csrf-token': response.json().data.csrfToken,
    origin: 'http://localhost:8050'
  };
}


describe('member collaboration and manager recovery', () => {
  async function fixture() {
    await db.query("INSERT INTO tasks(task_id,project_id,task_name,owner_member_id,status,due_date) VALUES('T-OTHER','PRJ-A','Other member task','MEM-B','In Progress','2026-12-01')");
    await insertSubproject(db, { projectId: 'PRJ-A', subprojectName: 'Other subproject', ownerId: 'MEM-B' }, 'S-OTHER');
  }
  it('edits and removes another member task and subproject, preserving identity and audit', async () => {
    await fixture(); const headers = await login('0010');
    for (const [kind,id,patch] of [['tasks','T-OTHER',{taskName:'Edited by colleague'}],['subprojects','S-OTHER',{subprojectName:'Edited by colleague'}]] as const) {
      const editor = await app.inject({url: '/api/work/editor/'+kind+'/'+id, headers});
      expect(editor.statusCode, editor.body).toBe(200);
      const revision = editor.json().data.record.revision;
      const saved = await app.inject({method:'PATCH',url:'/api/work/'+kind+'/'+id,headers,payload:{revision,...patch}});
      expect(saved.statusCode,saved.body).toBe(200);
      const stale = await app.inject({method:'PATCH',url:'/api/work/'+kind+'/'+id,headers,payload:{revision,...patch}});
      expect(stale.json().error.code).toBe('EDIT_CONFLICT');
      const checked = await app.inject({url:'/api/work/removal/preflight?entityType='+ (kind === 'tasks' ? 'TASKS':'SUBPROJECTS')+'&entityId='+id,headers});
      expect(checked.statusCode,checked.body).toBe(200);
      const removed = await app.inject({method:'POST',url:'/api/work/'+kind+'/'+id+'/remove',headers,payload:{revision:checked.json().data.revision,confirmed:true}});
      expect(removed.statusCode,removed.body).toBe(200);
      expect(await db.one('SELECT 1 FROM '+kind+' WHERE '+(kind==='tasks'?'task_id':'subproject_id')+'=$1 AND deleted_at IS NOT NULL',[id])).toBeTruthy();
    }
    expect((await db.many("SELECT 1 FROM audit_log WHERE action='RECORD_REMOVED'")).length).toBe(2);
  });
  it('refuses READ-only, foreign and restricted projects and read-only roles', async () => {
    await fixture(); const headers = await login('0010');
    await db.query("UPDATE member_divisions SET access_kind='READ' WHERE member_id='MEM-A'");
    for (const action of ['edit','remove']) {
      const response=await app.inject({method:action==='edit'?'PATCH':'POST',url:'/api/work/tasks/T-OTHER'+(action==='remove'?'/remove':''),headers,payload:action==='edit'?{revision:1,taskName:'Forbidden'}:{revision:1,confirmed:true}});
      expect(response.statusCode,response.body).toBe(403);
    }
    await db.query("UPDATE member_divisions SET removed_at=now(),removed_by='MEM-ADMIN' WHERE member_id='MEM-A'");
    expect((await app.inject({url:'/api/work/editor/tasks/T-OTHER',headers})).statusCode).toBe(404);
    await db.query("UPDATE member_divisions SET access_kind='WORK',removed_at=NULL,removed_by=NULL WHERE member_id='MEM-A'");
    await db.query("UPDATE projects SET dashboard_visibility='RESTRICTED' WHERE project_id='PRJ-A'");
    expect((await app.inject({url:'/api/work/editor/tasks/T-OTHER',headers})).statusCode).toBe(404);
    for (const role of ['VIEWER','GENERAL_MANAGER']) {
      await db.query('UPDATE members SET role=$1 WHERE member_id=$2',[role,'MEM-A']);
      expect((await app.inject({method:'POST',url:'/api/work/tasks/T-OTHER/remove',headers,payload:{revision:1,confirmed:true}})).statusCode).toBe(403);
    }
  });
  it('rechecks a member WORK grant after waiting for the division lock', async () => {
    await fixture(); const headers=await login('0010');
    const blocker=await pool.connect();
    await blocker.query('BEGIN');
    await blocker.query('SELECT pg_advisory_xact_lock(hashtext($1))',['member-divisions']);
    let pending: ReturnType<typeof app.inject> | undefined;
    try {
      pending=app.inject({method:'PATCH',url:'/api/work/tasks/T-OTHER',headers,payload:{revision:1,taskName:'Must not save'}});
      // Start injection before waiting for its blocked transaction.
      const completion=Promise.resolve(pending);
      const deadline=Date.now()+5000;
      while (!(await db.one("SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted LIMIT 1"))) {
        if(Date.now()>deadline) throw new Error('write did not wait for lock');
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      await blocker.query("UPDATE member_divisions SET access_kind='READ' WHERE member_id='MEM-A'");
      await blocker.query('COMMIT');
      const result=await completion;
      expect(result.statusCode,result.body).toBe(403);
      expect((await db.one<{task_name:string}>("SELECT task_name FROM tasks WHERE task_id='T-OTHER'"))?.task_name).toBe('Other member task');
    } finally { await blocker.query('ROLLBACK').catch(()=>undefined); blocker.release(); }
  });
  it('does not grant member approval, completion, restoration or purge powers', async () => {
    await fixture(); const headers = await login('0010');
    for(const [url,payload] of [
      ['/api/work/tasks/T-OTHER',{revision:1,status:'Done'}],
      ['/api/work/tasks/T-OTHER',{revision:1,notificationEnabled:true}]
    ] as const) expect((await app.inject({method:'PATCH',url,headers,payload})).statusCode).toBe(403);
    for(const url of ['/api/admin/tasks/T-OTHER/restore','/api/admin/tasks/T-OTHER/purge','/api/manager/tasks/T-OTHER/reopen','/api/manager/tasks/T-OTHER/approve']) {
      const response=await app.inject({method:'POST',url,headers,payload:{revision:1,confirmed:true,idempotencyKey:'forbidden-test-123'}});
      expect(response.statusCode,response.body).not.toBe(200);
    }
  });
  it('lets managers restore in WORK divisions and scopes deleted list totals before paging', async () => {
    await fixture(); const manager=await login('0002');
    await db.query("UPDATE tasks SET deleted_at=now() WHERE task_id='T-OTHER'");
    await db.query("UPDATE subprojects SET deleted_at=now() WHERE subproject_id='S-OTHER'");
    await insertProject(db,{projectName:'Foreign',status:'Active',dashboardVisibility:'INTERNAL',divisionId:'DIV-ENG'},'PRJ-FOREIGN');
    await db.query("INSERT INTO tasks(task_id,project_id,task_name,deleted_at) VALUES('T-FOREIGN','PRJ-FOREIGN','Hidden',now())");
    const list=await app.inject({url:'/api/admin/deleted-records?pageSize=1',headers:manager});
    expect(list.statusCode,list.body).toBe(200); expect(list.json().data.total).toBe(2);
    expect(list.json().data.items).toHaveLength(1);
    expect((await app.inject({url:'/api/admin/tasks/T-FOREIGN/restore-preflight',headers:manager})).statusCode).toBe(404);
    for(const [kind,id] of [['tasks','T-OTHER'],['subprojects','S-OTHER']]) {
      const checked=await app.inject({url:'/api/admin/'+kind+'/'+id+'/restore-preflight',headers:manager});
      expect(checked.statusCode,checked.body).toBe(200);
      const restored=await app.inject({method:'POST',url:'/api/admin/'+kind+'/'+id+'/restore',headers:manager,payload:{revision:checked.json().data.revision,confirmed:true}});
      expect(restored.statusCode,restored.body).toBe(200);
    }
    await db.query("UPDATE tasks SET deleted_at=now() WHERE task_id='T-OTHER'");
    await db.query("UPDATE member_divisions SET access_kind='READ' WHERE member_id='MEM-MANAGER'");
    expect((await app.inject({url:'/api/admin/deleted-records',headers:manager})).json().data.total).toBe(0);
    expect((await app.inject({method:'POST',url:'/api/admin/tasks/T-OTHER/restore',headers:manager,payload:{revision:2,confirmed:true}})).statusCode).toBe(403);
  });
});
