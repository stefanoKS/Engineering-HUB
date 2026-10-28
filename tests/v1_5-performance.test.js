'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {fixture}=require('../scripts/manager-web-preview');const {measure}=require('../scripts/manager-web-benchmark');
for(const size of [10,100,300])test('bounded reads and payloads for '+size+' projects / '+size*10+' tasks',()=>{const a=fixture(size),c=a.context;const overview=measure(a,()=>c.managerWebRead('overview'),3);assert.equal(overview.workbookOpensPerCall,1);
 // Seven sheets for the interactive view plus one read each of MILESTONES, ISSUES and
 // AUTOMATION_SETTINGS, which supply the fresh project progress/health the list now derives
 // instead of returning the stored PROJECTS columns that a task save leaves behind.
 assert.equal(overview.rangeReadsPerCall,10);assert.ok(overview.payloadBytes<10000);const tasks=c.managerWebRead('tasks',{offset:size*10-1,limit:100});assert.equal(tasks.data.items.length,1);assert.equal(tasks.data.total,size*10);assert.ok(c.Database.read('TASK_REQUESTS').length>=2);const rev=c.managerWebRead('task',{id:'T0'}).data.record._revision;c.Dashboard.refresh=()=>{throw new Error('Unnecessary report regeneration');};assert.equal(c.managerWebWrite('taskSave',{taskId:'T0',revision:rev,progress:33}).ok,true);});
