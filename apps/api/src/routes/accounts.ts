import { z } from 'zod';
import { runIdempotent } from '../services/common';
import type { FastifyInstance } from 'fastify';
import { DomainError, requireRole } from '@eh/domain';
import { newId } from '@eh/db';
import { adminOf, ok, type AppDependencies } from '../http';
import { EmployeeId, Password } from '../auth/local';
import { hashPassword } from '../auth/password';
export function registerAccountRoutes(app: FastifyInstance, deps: AppDependencies) {
 const enabled=()=>{if(deps.config.authMode!=='local')throw new DomainError('NOT_CONFIGURED','Local authentication is disabled');};
 app.get('/api/admin/accounts',async(request,reply)=>{
  enabled();adminOf(request);
  const query=z.object({page:z.coerce.number().int().min(1).max(100000).default(1),query:z.string().max(100).default('')}).parse(request.query);
  const rows=await deps.db.many('SELECT a.employee_id AS "employeeId", m.member_id AS "memberId", m.name, m.role, m.active, m.revision, a.must_change_password AS "mustChangePassword" FROM local_accounts a JOIN members m USING(member_id) WHERE (a.employee_id ILIKE $1 OR m.name ILIKE $1) ORDER BY a.employee_id LIMIT 25 OFFSET $2',['%'+query.query+'%',(query.page-1)*25]);
  return ok(reply,request,{items:rows});
 });
 app.post('/api/admin/accounts',async(request,reply)=>{
  enabled(); const actor=adminOf(request);
  const body=z.object({idempotencyKey:z.string().min(8).max(128),employeeId:EmployeeId,name:z.string().trim().min(1).max(200),password:Password,role:z.enum(['ADMIN','MANAGER','MEMBER','VIEWER']),memberId:z.string().min(1).max(100).optional()}).strict().parse(request.body);
  const passwordHash=await hashPassword(body.password);
  const memberId=body.memberId ?? newId('MEM');
  const result=await runIdempotent({db:deps.db,identity:actor,correlationId:request.state.correlationId},{scope:'local-account:'+actor.memberId,key:body.idempotencyKey,request:{employeeId:body.employeeId,name:body.name,role:body.role,memberId:body.memberId}},async tx=>{
   await tx.advisoryLock('members:role-and-activation');
   const current=await tx.one<{role:string;active:boolean}>('SELECT role,active FROM members WHERE member_id=$1',[actor.memberId]);
   requireRole({...actor,role:current?.role as typeof actor.role,active:!!current?.active},'ADMIN');
   if(body.memberId){
    const member=await tx.one('SELECT member_id FROM members WHERE member_id=$1 FOR UPDATE',[memberId]);
    if(!member)throw new DomainError('NOT_FOUND','Member not found');
   } else await tx.query('INSERT INTO members(member_id,name,role) VALUES($1,$2,$3)',[memberId,body.name,body.role]);
   await tx.query('INSERT INTO local_accounts(member_id,employee_id,password_hash) VALUES($1,$2,$3)',[memberId,body.employeeId,passwordHash]);
   await tx.query("INSERT INTO audit_log(entity_type,entity_id,action,actor_member_id,actor_email,new_value) VALUES('MEMBER',$1,'LOCAL_ACCOUNT_CREATED',$2,$3,$4)",[memberId,actor.memberId,actor.email,JSON.stringify({employeeId:body.employeeId})]);
   return {memberId};
  });
  return ok(reply,request,result.data);
 });
 app.post('/api/admin/accounts/:memberId/reset-password',async(request,reply)=>{
  enabled();const actor=adminOf(request);
  const {memberId}=z.object({memberId:z.string().min(1).max(100)}).parse(request.params);
  if(memberId===actor.memberId)throw new DomainError('VALIDATION_FAILED','Use change password for your own account');
  const body=z.object({password:Password,confirmed:z.literal(true)}).strict().parse(request.body);
  const hash=await hashPassword(body.password);
  await deps.db.transaction(async tx=>{
   await tx.advisoryLock('members:role-and-activation');
   const current=await tx.one<{role:string;active:boolean}>('SELECT role,active FROM members WHERE member_id=$1',[actor.memberId]);
   requireRole({...actor,role:current?.role as typeof actor.role,active:!!current?.active},'ADMIN');
   const changed=await tx.one('UPDATE local_accounts SET password_hash=$2,must_change_password=true,password_version=password_version+1,failed_attempts=0,locked_until=NULL,updated_at=now() WHERE member_id=$1 RETURNING member_id',[memberId,hash]);
   if(!changed)throw new DomainError('NOT_FOUND','Local account not found');
   await tx.query('UPDATE sessions SET revoked_at=now() WHERE member_id=$1 AND revoked_at IS NULL',[memberId]);
   await tx.query("INSERT INTO audit_log(entity_type,entity_id,action,actor_member_id,actor_email) VALUES('MEMBER',$1,'PASSWORD_RESET',$2,$3)",[memberId,actor.memberId,actor.email]);
  });return ok(reply,request,{reset:true});
 });
}
