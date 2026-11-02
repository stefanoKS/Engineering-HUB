import {beforeAll,beforeEach,afterEach,describe,it,expect} from 'vitest';
import type {FastifyInstance} from 'fastify';
import type pg from 'pg';
import type {Database} from '@eh/db';
import {freshDatabase} from '../../../packages/db/test/support/db';
import {buildApp} from '../src/app';
import {loadConfig} from '../src/config';
import {NullInboxSource} from '../src/inbox';
import {hashPassword} from '../src/auth/password';
let app:FastifyInstance,db:Database,pool:pg.Pool,hash:string;
const password='Local-test-password-123';
beforeAll(async()=>{hash=await hashPassword(password);});
beforeEach(async()=>{const context=await freshDatabase();db=context.db;pool=context.pool;
 await db.query("INSERT INTO members(member_id,name,role) VALUES('ADMIN','Admin','ADMIN'),('MEMBER','Member','MEMBER'),('OTHER','Other','MEMBER')");
 await db.query("INSERT INTO local_accounts(member_id,employee_id,password_hash,must_change_password) VALUES('ADMIN','0001',$1,false),('MEMBER','0002',$1,true),('OTHER','0003',$1,false)",[hash]);
 app=await buildApp({db,inbox:new NullInboxSource(),logger:false,config:loadConfig({NODE_ENV:'test',AUTH_MODE:'local',PUBLIC_ORIGIN:'http://localhost:8050'})});});
afterEach(async()=>{await app.close();await pool.end();});
async function login(employeeId='0001',value=password){return app.inject({method:'POST',url:'/api/session',payload:{employeeId,password:value}});}
async function auth(employeeId='0001'){const response=await login(employeeId);expect(response.statusCode).toBe(200);return {cookie:String(response.headers['set-cookie']).split(';')[0]!, 'x-csrf-token':response.json().data.csrfToken,origin:'http://localhost:8050'};}
describe('local employee authentication',()=>{
 it('preserves leading zeros and needs no Google configuration or email',async()=>{const response=await login();expect(response.statusCode).toBe(200);expect(response.json().data.actor.email).toBe('');expect(response.json().data.authMode).toBe('local');expect((await login('1')).statusCode).toBe(401);});
 it('rejects passwords, unregistered IDs and forged identity claims',async()=>{expect((await login('0001','wrong')).statusCode).toBe(401);expect((await login('unknown')).statusCode).toBe(401);expect((await app.inject({method:'POST',url:'/api/session',payload:{employeeId:'0001',password,role:'ADMIN'}})).statusCode).toBe(400);expect((await app.inject({method:'POST',url:'/api/session',payload:{devEmail:'admin@example.com'}})).statusCode).toBe(401);});
 it('requires temporary password change on reads and writes, then revokes old sessions',async()=>{const headers=await auth('0002');expect((await app.inject({url:'/api/employee/my-work',headers})).statusCode).toBe(403);
 const changed=await app.inject({method:'POST',url:'/api/account/password',headers,payload:{currentPassword:password,password:'New-local-password-456'}});expect(changed.statusCode).toBe(200);
 expect((await app.inject({url:'/api/session',headers})).statusCode).toBe(401);expect((await login('0002')).statusCode).toBe(401);const next=await login('0002','New-local-password-456');expect(next.json().data.mustChangePassword).toBe(false);});
 it('rejects cross-origin login and password changes without CSRF',async()=>{expect((await app.inject({method:'POST',url:'/api/session',headers:{origin:'http://evil.test'},payload:{employeeId:'0001',password}})).statusCode).toBe(403);const headers=await auth();expect((await app.inject({method:'POST',url:'/api/account/password',headers:{cookie:headers.cookie},payload:{currentPassword:password,password:'New-local-password-456'}})).statusCode).toBe(403);});
 it('restricts account creation to administrators and never returns hashes',async()=>{const member=await auth('0003');expect((await app.inject({url:'/api/admin/accounts',headers:member})).statusCode).toBe(403);const headers=await auth();expect((await app.inject({method:'POST',url:'/api/admin/accounts',headers,payload:{idempotencyKey:'create-local-0010',employeeId:'0010',name:'New Employee',password,role:'MEMBER'}})).statusCode).toBe(200);const list=await app.inject({url:'/api/admin/accounts',headers});expect(list.body).not.toContain('password_hash');expect(list.body).not.toContain(hash);expect((await login('0010')).json().data.mustChangePassword).toBe(true);});
 it('resets credentials, revokes sessions and blocks deactivated accounts',async()=>{const old=await auth('0003'),admin=await auth();const reset=await app.inject({method:'POST',url:'/api/admin/accounts/OTHER/reset-password',headers:admin,payload:{password:'Temporary-reset-123',confirmed:true}});expect(reset.statusCode).toBe(200);expect((await app.inject({url:'/api/session',headers:old})).statusCode).toBe(401);expect((await login('0003')).statusCode).toBe(401);expect((await login('0003','Temporary-reset-123')).statusCode).toBe(200);await db.query("UPDATE members SET active=false WHERE member_id='OTHER'");expect((await login('0003','Temporary-reset-123')).statusCode).toBe(401);});
 it('persists lockout after five failed passwords',async()=>{for(let i=0;i<5;i++)expect((await login('0001','incorrect')).statusCode).toBe(401);expect((await login()).statusCode).toBe(401);expect((await db.one<{failed_attempts:number}>("SELECT failed_attempts FROM local_accounts WHERE employee_id='0001'"))?.failed_attempts).toBe(5);});
 it('allows only assigned leaf progress, refuses private task access and stale edits',async()=>{await db.query("INSERT INTO projects(project_id,project_name,status) VALUES('P','Project','Active')");await db.query("INSERT INTO tasks(task_id,project_id,task_name,owner_member_id,status) VALUES('T','P','Own','OTHER','In Progress'),('SECRET','P','Private','MEMBER','In Progress')");const headers=await auth('0003');const list=await app.inject({url:'/api/employee/my-work',headers});expect(list.body).toContain('Own');expect(list.body).not.toContain('Private');const payload={revision:1,progressPercent:25,actualHours:2};expect((await app.inject({method:'PATCH',url:'/api/employee/my-work/T',headers,payload})).statusCode).toBe(200);expect((await app.inject({method:'PATCH',url:'/api/employee/my-work/T',headers,payload})).statusCode).toBe(409);expect((await app.inject({method:'PATCH',url:'/api/employee/my-work/SECRET',headers,payload})).statusCode).toBe(403);expect((await app.inject({method:'PATCH',url:'/api/employee/my-work/T',headers,payload:{...payload,dueDate:'2027-01-01'}})).statusCode).toBe(400);});
 it('does not reuse a local session after changing to Google authentication',async()=>{
  const headers=await auth();await app.close();
  app=await buildApp({db,inbox:new NullInboxSource(),logger:false,config:loadConfig({NODE_ENV:'test',AUTH_MODE:'google',MANAGER_WEB_ALLOWED_DOMAINS:'example.co.jp',PUBLIC_ORIGIN:'http://localhost:8050'})});
  expect((await app.inject({url:'/api/session',headers})).statusCode).toBe(401);
 });
 it('requires explicit opt-in for production HTTP and secure cookies on HTTPS',()=>{expect(()=>loadConfig({NODE_ENV:'production',AUTH_MODE:'local',DATABASE_URL:'postgres://localhost/test',PUBLIC_ORIGIN:'http://10.1.6.253:8050'})).toThrow(/HTTPS/);expect(loadConfig({NODE_ENV:'production',AUTH_MODE:'local',DATABASE_URL:'postgres://localhost/test',PUBLIC_ORIGIN:'https://hub.test'}).secureCookies).toBe(true);});
});
