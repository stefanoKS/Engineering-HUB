import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { DomainError, requireRole, taskInActiveWork } from '@eh/domain';
import { getTask, getProject, listSubprojects, updateTask } from '@eh/db';
import { actorOf, ok, type AppDependencies } from '../http';
export function registerMyWork(app:FastifyInstance,deps:AppDependencies){
 app.get('/api/employee/my-work',async(request,reply)=>{
  const actor=requireRole(actorOf(request),'MEMBER');
  const {page}=z.object({page:z.coerce.number().int().min(1).max(100000).default(1)}).parse(request.query);
  const items=await deps.db.many('SELECT t.task_id AS "taskId",t.task_name AS "taskName",t.status,t.due_date AS "dueDate",t.progress_percent AS "progressPercent",t.actual_hours AS "actualHours",t.revision,p.project_name AS "projectName" FROM tasks t JOIN projects p USING(project_id) WHERE t.deleted_at IS NULL AND (t.owner_member_id=$1 OR EXISTS(SELECT 1 FROM task_assignees a WHERE a.task_id=t.task_id AND a.member_id=$1 AND a.removed_at IS NULL)) ORDER BY t.due_date NULLS LAST,t.task_id LIMIT 25 OFFSET $2',[actor.memberId,(page-1)*25]);
  return ok(reply,request,{items});
 });
 app.patch('/api/employee/my-work/:id',async(request,reply)=>{
  const actor=requireRole(actorOf(request),'MEMBER');
  const {id}=z.object({id:z.string().min(1).max(100)}).parse(request.params);
  const body=z.object({revision:z.number().int().positive(),progressPercent:z.number().min(0).max(99),actualHours:z.number().min(0).max(99999)}).strict().parse(request.body);
  await deps.db.transaction(async tx=>{
   await tx.query('SELECT task_id FROM tasks WHERE task_id=$1 FOR UPDATE',[id]);
   const owned=await tx.one('SELECT task_id FROM tasks WHERE task_id=$1 AND deleted_at IS NULL AND (owner_member_id=$2 OR EXISTS(SELECT 1 FROM task_assignees WHERE task_id=$1 AND member_id=$2 AND removed_at IS NULL))',[id,actor.memberId]);
   if(!owned)throw new DomainError('AUTHORIZATION_DENIED','Only your assigned work can be updated');
   const task=await getTask(tx,id);if(!task)throw new DomainError('NOT_FOUND','Task not found');
   const project=await getProject(tx,task.projectId);const subs=await listSubprojects(tx);
   const container=await tx.one('SELECT task_id FROM tasks WHERE parent_task_id=$1 AND deleted_at IS NULL LIMIT 1',[id]);
   if(container||!taskInActiveWork(task,new Map([[task.projectId,project??undefined]]),new Map(subs.map(s=>[s.subprojectId,s]))))throw new DomainError('INVALID_TRANSITION','Only active leaf work can be updated');
   const updated=await updateTask(tx,id,{progressPercent:body.progressPercent,actualHours:body.actualHours},body.revision);
   if(!updated)throw new DomainError('EDIT_CONFLICT','Reload the task before updating it');
   await tx.query("INSERT INTO audit_log(entity_type,entity_id,action,actor_member_id,actor_email,new_value) VALUES('TASK',$1,'EMPLOYEE_PROGRESS_UPDATED',$2,$3,$4)",[id,actor.memberId,actor.email,JSON.stringify(body)]);
  });return ok(reply,request,{saved:true});
 });
}
