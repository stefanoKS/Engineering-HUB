'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {base, bulk} = require('./fixtures');
const fs = require('node:fs');
const path = require('node:path');
const make = (actor = 'admin@example.test') => base({actor,properties:{MANAGER_WEB_ALLOWED_DOMAINS:'example.test'}});
for (const role of ['admin','manager']) test('web permits verified '+role, () => {
 const a=make(role+'@example.test'); assert.equal(a.context.managerWebRead('overview').ok,true); assert.doesNotThrow(()=>a.context.doGet());
});
for (const actor of ['engineer@example.test','viewer@example.test','missing@example.test','admin@outside.test','']) test('web refuses '+(actor||'blank identity'), () => {
 const a=make(actor); for(const op of ['overview','tasks','members','status']) assert.equal(a.context.managerWebRead(op,{}).ok,false);
 assert.equal(a.context.managerWebWrite('projectCreate',{name:'forged',actor:'admin@example.test',role:'ADMIN'}).ok,false);
 assert.throws(()=>a.context.doGet());
});
test('deactivated manager and unconfigured domain fail closed',()=>{
 const a=make();a.context.Database.update('MEMBERS','M-ADMIN',{Active:false});assert.equal(a.context.managerWebRead('overview').ok,false);
 const b=base();assert.equal(b.context.managerWebRead('overview').ok,false);
});
test('compact bootstrap reads each source table at most once and never returns private task details',()=>{
 const a=make(),r=a.context.managerWebRead('overview');assert.equal(r.ok,true,r.error);assert.ok(r.metrics.tableReads<=6);
 assert.ok(!r.data.tasks);assert.ok(!r.data.members);assert.ok(!r.data.skills);assert.ok(!r.data.projects.items[0].description);
 assert.equal(r.data.actor.role,'ADMIN');assert.equal(a.context.Schema.version,6);assert.equal(a.context.SharedDashboardModel.CONTRACT_VERSION,'1.4');
});
test('large task pagination, search, project and responsibility filters remain reachable',()=>{
 const a=make();a.context.Database.insert('RESPONSIBILITIES',{Responsibility_ID:'R1',Name:'Design',Status:'Active'});a.context.Database.update('PROJECTS','P1',{Responsibility_ID:'R1'});
 bulk(a,'TASKS',Array.from({length:1001},(_,i)=>({Task_ID:'T'+i,Task_Name:'Synthetic '+i,Project_ID:i%2?'P2':'P1',Owner_Member_ID:'M-ENG',Status:'Assigned',Due_Date:'2026-12-01',Progress_Percent:0})));
 const result=a.context.managerWebRead('tasks',{responsibilityId:'R1',offset:500,limit:50});assert.equal(result.ok,true,result.error);assert.equal(result.data.total,501);assert.equal(result.data.items[0].id,'T998');
 const search=a.context.managerWebRead('tasks',{query:'Synthetic 1000',projectId:'P1'});assert.equal(search.data.items.length,1);assert.equal(search.data.items[0].id,'T1000');
});
test('task save reuses scheduling, preserves fields, does not regenerate reports, and rejects stale edits',()=>{
 const a=make();const c=a.context;const record=c.managerWebRead('task',{id:'T1'}).data.record;
 c.Dashboard.refresh=()=>{throw new Error('Unwanted full refresh');};
 let r=c.managerWebWrite('taskSave',{taskId:'T1',revision:record._revision,taskName:'Updated'});assert.equal(r.ok,true,r.error);
 assert.equal(c.Database.find('TASKS','T1').Actual_Hours,8);
 r=c.managerWebWrite('taskSave',{taskId:'T1',revision:record._revision,taskName:'Stale'});assert.equal(r.ok,false);assert.match(r.error,/EDIT_CONFLICT/);
 r=c.managerWebWrite('taskSave',{projectId:'P1',taskName:'New',ownerId:'M-ENG',deadline:'2026-12-18',durationValue:3,durationUnit:'DAY',durationBasis:'WORKING_DAYS'});assert.equal(r.ok,true,r.error);assert.equal(r.data.task.Planned_Start,'2026-12-16');assert.equal(a.sentEmails.length,0);assert.equal(a.triggers.length,0);
});
test('locked precondition catches a write between loading and lock acquisition',()=>{
 const a=make(),c=a.context;const record=c.managerWebRead('project',{id:'P1'}).data.record;
 const original=c.Database.withLock;let inject=true;c.Database.withLock=function(fn){if(inject){inject=false;c.Database.update('PROJECTS','P1',{Project_Name:'Concurrent'});}return original(fn);};
 const r=c.managerWebWrite('projectSave',{projectId:'P1',revision:record._revision,name:'Overwrite'});assert.equal(r.ok,false);assert.match(r.error,/EDIT_CONFLICT/);assert.equal(c.Database.find('PROJECTS','P1').Project_Name,'Concurrent');
});
test('project transfer validation and invalid reparent leave all fields unchanged',()=>{
 const a=make(),c=a.context;let row=c.managerWebRead('project',{id:'P1'}).data.record;
 let r=c.managerWebWrite('projectSave',{projectId:'P1',revision:row._revision,name:'Should not save',responsibilityId:'missing'});assert.equal(r.ok,false);assert.equal(c.Database.find('PROJECTS','P1').Project_Name,'検査装置');
 row=c.ManagerWeb.editable('SUBPROJECTS',c.Database.find('SUBPROJECTS','S1'));
 r=c.managerWebWrite('subprojectSave',{subprojectId:'S1',revision:row._revision,name:'Should not save',parentId:'S1',confirmReparent:true});assert.equal(r.ok,false);assert.equal(c.Database.find('SUBPROJECTS','S1').Subproject_Name,'試作');
});
test('role spoofing, unknown RPC actions and manager privilege edits are refused',()=>{
 const a=make('manager@example.test'),c=a.context;
 assert.equal(c.managerWebWrite('taskSave',{role:'ADMIN'}).ok,false);assert.equal(c.managerWebWrite('Database.update',{}).ok,false);
 const member=c.managerWebRead('members').data.items.find(m=>m.Member_ID==='M-ENG');
 assert.equal(c.managerWebWrite('memberSave',{memberId:'M-ENG',revision:member._revision,role:'ADMIN',name:'E',email:'engineer@example.test'}).ok,false);
 assert.equal(c.Database.find('MEMBERS','M-ENG').Role,'MEMBER');
});
test('read contexts refuse writes, clear on exceptions, and do not cache across callers',()=>{
 const a=make(),c=a.context;assert.throws(()=>c.Database.withReadContext(()=>c.Database.update('PROJECTS','P1',{Category:'bad'})),/forbidden/);
 c.Database.update('PROJECTS','P1',{Category:'safe'});assert.equal(c.managerWebRead('project',{id:'P1'}).data.record.Category,'safe');
 a.setActor('viewer@example.test');assert.equal(c.managerWebRead('project',{id:'P1'}).ok,false);
});
test('non-working task deadline requires acknowledgement',()=>{
 const c=make().context;const p={projectId:'P1',taskName:'Weekend',ownerId:'M-ENG',deadline:'2026-12-19',durationValue:1};assert.equal(c.managerWebWrite('taskSave',p).ok,false);p.acknowledgeNonWorking=true;assert.equal(c.managerWebWrite('taskSave',p).ok,true);
});
test('manager manifest is user-executed and employee deployment unchanged',()=>{
 const root=path.resolve(__dirname,'..');const manager=JSON.parse(fs.readFileSync(path.join(root,'src/appsscript.json')));const employee=JSON.parse(fs.readFileSync(path.join(root,'dashboard-app/appsscript.json')));assert.deepEqual(manager.webapp,{access:'DOMAIN',executeAs:'USER_ACCESSING'});assert.equal(employee.webapp.executeAs,'USER_DEPLOYING');
});

test('status and records never return deployment identifiers or unknown columns',()=>{const a=make();const r=a.context.managerWebRead('status');assert.equal(r.ok,true,r.error);assert.doesNotMatch(JSON.stringify(r.data),/test-db|spreadsheetId|BACKUP_FOLDER_ID/);});
test('member partial edits keep untouched directory values',()=>{const c=make().context;const m=c.managerWebRead('members').data.items.find(x=>x.Member_ID==='M-ENG');const r=c.managerWebWrite('memberSave',{memberId:'M-ENG',revision:m._revision,department:'New department'});assert.equal(r.ok,true,r.error);assert.equal(c.Database.find('MEMBERS','M-ENG').Name,m.Name);assert.equal(c.Database.find('MEMBERS','M-ENG').Email,m.Email);});

test('request decisions hold one script lock through validation, task effect and history',()=>{
 const a=require('../scripts/manager-web-preview').fixture(),c=a.context;let held=false,acquired=0;const lock={waitLock(){assert.equal(held,false);held=true;acquired++;},releaseLock(){held=false;}};c.LockService.getScriptLock=()=>lock;const update=c.Database.update;c.Database.update=function(...args){assert.equal(held,true);return update(...args);};const result=c.managerWebWrite('requestDecide',{requestId:'REQ-0',action:'APPROVE',confirmation:'DECIDE REQUEST',confirmed:true});assert.equal(result.ok,true,result.error);assert.equal(result.data.status,'APPROVED');assert.equal(acquired,1);assert.equal(held,false);assert.equal(c.Database.find('TASKS','T0').Due_Date,'2026-12-22');assert.equal(c.Database.read('TASK_DEADLINE_HISTORY').length,1);assert.equal(c.managerWebWrite('requestDecide',{requestId:'REQ-0',action:'APPROVE',confirmation:'DECIDE REQUEST',confirmed:true}).ok,false);assert.equal(c.Database.read('TASK_DEADLINE_HISTORY').length,1);
});
test('automation writes require admin and current settings revision; no automatic activation',()=>{
 const a=make(),c=a.context;const initial=c.managerWebRead('automation').data;const result=c.managerWebWrite('automationSave',{changes:{PROJECT_STALE_DAYS:29},revision:initial.revision,confirmed:true});assert.equal(result.ok,true,result.error);assert.equal(c.managerWebWrite('automationSave',{changes:{PROJECT_STALE_DAYS:30},revision:initial.revision,confirmed:true}).ok,false);a.setActor('manager@example.test');assert.equal(c.managerWebWrite('automationSave',{changes:{PROJECT_STALE_DAYS:31},revision:c.managerWebRead('automation').data.revision,confirmed:true}).ok,false);assert.equal(c.managerWebWrite('emergencyStop',{confirmed:true}).ok,true);assert.equal(c.AutomationSettings.get().EMAIL_MODE,'OFF');
});
