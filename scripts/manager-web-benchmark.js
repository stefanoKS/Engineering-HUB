'use strict';
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const {execFileSync}=require('node:child_process');const {performance}=require('node:perf_hooks');const {fixture}=require('./manager-web-preview');
const BASE='5c1143edef3f8ba74ce92219a59ea58723847941';
const PREVIOUS='adde446e856f992d16aca18b116489126b9a57c7';
const OUTPUT=process.env.BENCHMARK_OUTPUT||'V1_6_PERFORMANCE.json';
function measure(app,fn,repeats=12){let reads=0,opens=0;const original=app.context.SpreadsheetApp.openById;app.context.SpreadsheetApp.openById=function(...args){opens++;return original(...args);};const restores=[];for(const sheet of app.book.getSheets()){const get=sheet.getDataRange.bind(sheet);sheet.getDataRange=()=>{reads++;return get();};restores.push(()=>{sheet.getDataRange=get;});}let result;const times=[];try{for(let i=0;i<repeats;i++){const start=performance.now();result=fn();if(result&&result.ok===false)throw new Error(result.error);times.push(performance.now()-start);}}finally{restores.forEach(f=>f());app.context.SpreadsheetApp.openById=original;}const warm=times.slice(1).sort((a,b)=>a-b);return{coldMs:+times[0].toFixed(2),p50Ms:+warm[Math.floor(warm.length*.5)].toFixed(2),p95Ms:+warm[Math.min(warm.length-1,Math.floor(warm.length*.95))].toFixed(2),rangeReadsPerCall:reads/repeats,workbookOpensPerCall:opens/repeats,payloadBytes:Buffer.byteLength(JSON.stringify(result)),samples:repeats};}
async function benchmark(){const root=path.resolve(__dirname,'..');const baselineFiles=execFileSync('git',['ls-tree','-r','--name-only',BASE,'src'],{cwd:root,encoding:'utf8'}).trim().split(/\r?\n/).filter(f=>f.endsWith('.gs'));const originalSource=baselineFiles.map(file=>execFileSync('git',['show',BASE+':'+file],{cwd:root,encoding:'utf8'})).join('\n;\n');const report={baselineCommit:BASE,previousClientCommit:PREVIOUS,environment:'Windows; Node '+process.version+'; Google services mocked; local execution only',liveWorkspace:'NOT_RUN',datasets:[]};for(const projects of [10,100,300]){const legacy=fixture(projects);new vm.Script(originalSource).runInContext(legacy.context);const current=fixture(projects),c=current.context;const entry={projects,tasks:projects*10,subprojects:projects*2,baseline:measure(legacy,()=>legacy.context.Ui.context()),overview:measure(current,()=>c.managerWebRead('overview')),bootstrap:measure(current,()=>c.managerWebRead('bootstrap'),6),taskIndex:measure(current,()=>c.managerWebRead('taskIndex'),6),projectList:measure(current,()=>c.managerWebRead('projects',{})),projectDetail:measure(current,()=>c.managerWebRead('project',{id:'P0'})),taskSearch:measure(current,()=>c.managerWebRead('tasks',{projectId:'P0',query:'設計'})),taskDetail:measure(current,()=>c.managerWebRead('task',{id:'T0'})),taskUpdate:measure(current,()=>{const r=c.managerWebRead('task',{id:'T0'}).data.record;return c.managerWebWrite('taskSave',{taskId:'T0',revision:r._revision,taskName:'Updated '+Date.now()});},6)};entry.taskCreate=measure(current,()=>c.managerWebWrite('taskSave',{taskName:'Benchmark task',projectId:'P0',ownerId:'M-ENG',deadline:'2026-12-18',durationValue:3,durationUnit:'DAY',durationBasis:'WORKING_DAYS'}),6);const requestApp=fixture(projects);for(let i=0;i<6;i++){const task=requestApp.context.Database.find('TASKS','T'+i);requestApp.context.Database.insert('TASK_REQUESTS',{Request_ID:'BENCH-'+i,Request_Type:'DEADLINE_CHANGE',Task_ID:task.Task_ID,Project_ID:task.Project_ID,Requester_Name:'Synthetic',Original_Due_Date:'2026-12-18',Due_Date_At_Submission:'2026-12-18',Requested_Due_Date:'2026-12-22',Reason:'技術的問題',Status:'PENDING',Task_Revision_At_Submission:requestApp.context.SharedDashboardModel.revision(task)});}let requestIndex=0;entry.requestApproval=measure(requestApp,()=>requestApp.context.managerWebWrite('requestDecide',{requestId:'BENCH-'+requestIndex++,action:'APPROVE',confirmed:true,confirmation:'DECIDE REQUEST'}),6);entry.requestApproval.note='Six distinct pending deadline requests; fixture setup excluded. Inbox receipt mirroring is unavailable in this mock; authoritative decision/history measured.';const publication=fixture(projects);const d=require('../tests/dashboard-fixtures');d.attachSnapshot(publication);publication.context.initializeSharedDashboardSnapshot('INITIALIZE SHARED DASHBOARD snapshot-db');d.enablePublication(publication);publication.context.Database.update('PROJECTS','P0',{Dashboard_Visibility:'INTERNAL'});entry.publication=measure(publication,()=>publication.context.managerWebWrite('publication',{confirmed:true}),6);entry.publication.note='One INTERNAL project; remaining projects RESTRICTED. Range counters cover private workbook only.';entry.reportRefresh=measure(current,()=>c.managerWebWrite('reportRefresh',{confirmed:true}),3);report.datasets.push(entry);}// Each client is measured on its own event loop turn: concurrent harnesses would split the
// same Node timers between two pages and inflate both.
for(const entry of report.datasets){entry.ui=await uiBenchmark(entry.projects);entry.previousUi=await previousUiBenchmark(entry.projects,PREVIOUS);}
return report;}

/**
 * Local-first navigation measured through the real browser client, not a copy of its logic.
 * The harness serves the same mocked Apps Script endpoints, so RPC counts are the calls the
 * page would make; timings are Node/vm render time, not a browser paint measurement.
 */
async function uiBenchmark(size){
  const {harness}=require('../tests/support/manager-web-harness');
  const tick=()=>new Promise(resolve=>setImmediate(resolve));
  const settle=async()=>{for(let i=0;i<40;i++)await tick();};
  const app=fixture(size);
  const server=(write,operation,payload)=>write?app.context.managerWebWrite(operation,payload):app.context.managerWebRead(operation,payload);
  const started=performance.now();
  const h=harness(server);
  await settle();
  const firstLoadMs=+(performance.now()-started).toFixed(2);
  const buttons=(where)=>h.nodes(where||'nav').filter(n=>n.tagName==='BUTTON');
  const navTo=text=>{const b=buttons().find(n=>n.textContent===text);const t=performance.now();b.dispatchEvent('click',{});return +(performance.now()-t).toFixed(2);};
  // Warm the task view so the compact index is loaded before cached navigation is timed.
  navTo('タスク');await settle();navTo('概要');await settle();
  const indexLoaded=!!h.window.ManagerWebClient.store.tasks.loaded;
  const rpcAfterInitialLoad=h.window.ManagerWebClient.stats.rpc;
  const navSamples=[];for(let i=0;i<12;i++)navSamples.push(navTo(i%2?'タスク':'案件'));
  navTo('タスク');await settle();
  const searchSamples=[];for(let i=0;i<10;i++){const node=h.nodes('content').find(n=>n.name==='search');const t=performance.now();node.value='タスク '+(i*7);node.dispatchEvent('input',{});searchSamples.push(+(performance.now()-t).toFixed(2));}
  navTo('案件');await settle();
  const waitFor=async(predicate)=>{const start=performance.now();while(!predicate()&&performance.now()-start<3000)await tick();return performance.now()-start;};
  const openDetail=async()=>{const b=buttons('content').find(n=>n.textContent==='編集');const t=performance.now();b.dispatchEvent('click',{});await waitFor(()=>h.document.getElementById('content').textContent.indexOf('案件の階層')>=0);return +(performance.now()-t).toFixed(2);};
  const firstDetailOpenMs=await openDetail();
  navTo('案件');await settle();
  const cachedDetailOpenMs=await openDetail();
  // Responsiveness while a background revalidation is still unanswered.
  const manualApp=fixture(size);
  const manual=harness((write,operation,payload)=>write?manualApp.context.managerWebWrite(operation,payload):manualApp.context.managerWebRead(operation,payload),{manual:true});
  await tick();
  await tick();
  manual.waiting.shift().success(manualApp.context.managerWebRead('bootstrap'));
  await settle();
  while(manual.waiting.length)manual.waiting.shift().success(manualApp.context.managerWebRead('taskIndex'));
  await settle();
  const refresh=manual.nodes('content').find(n=>n.tagName==='BUTTON'&&n.textContent==='再読み込み');
  refresh.dispatchEvent('click',{});
  const pendingRequests=manual.waiting.length;
  const inFlightSamples=[];for(let i=0;i<5;i++){const b=manual.nodes('nav').find(n=>n.tagName==='BUTTON'&&n.textContent==='タスク');const t=performance.now();b.dispatchEvent('click',{});inFlightSamples.push(+(performance.now()-t).toFixed(2));}
  return {firstLoadMs,
    cachedNavigationMs:{p50:quantile(navSamples,0.5),p95:quantile(navSamples,0.95),samples:navSamples.length},
    localSearchMs:{p50:quantile(searchSamples,0.5),p95:quantile(searchSamples,0.95),samples:searchSamples.length},
    firstDetailOpenMs, cachedDetailOpenMs, taskIndexLoaded:indexLoaded,
    rpcAfterInitialLoad, pendingDuringInFlightTest:pendingRequests,
    inFlightNavigationMs:{p50:quantile(inFlightSamples,0.5),p95:quantile(inFlightSamples,0.95)}};
}
function quantile(values,fraction){const sorted=values.slice().sort((a,b)=>a-b);return +sorted[Math.min(sorted.length-1,Math.floor(sorted.length*fraction))].toFixed(2);}

/**
 * The previous release client (V1.5 review-correction) for a like-for-like comparison: it has no
 * snapshot, so every navigation waits for the server and a save clears the whole cache.
 */
async function previousUiBenchmark(size,previous){
  const {harness}=require('../tests/support/manager-web-harness');
  const root=path.resolve(__dirname,'..');
  const clientSource=execFileSync('git',['show',previous+':src/ManagerWebClient.html'],{cwd:root,encoding:'utf8'});
  const settle=async()=>{for(let i=0;i<40;i++)await new Promise(resolve=>setImmediate(resolve));};
  const app=fixture(size);
  const started=performance.now();
  const h=harness((write,operation,payload)=>write?app.context.managerWebWrite(operation,payload):app.context.managerWebRead(operation,payload),{clientSource});
  await settle();
  const firstLoadMs=+(performance.now()-started).toFixed(2);
  const rpcAfterInitialLoad=h.calls.filter(c=>!c.write).length;
  const heading=()=>{const node=h.nodes('content').find(n=>n.tagName==='H1');return node?node.textContent:'';};
  const navTo=async(text,title)=>{const b=h.nodes('nav').find(n=>n.tagName==='BUTTON'&&n.textContent===text);const t=performance.now();b.dispatchEvent('click',{});const start=performance.now();while(heading()!==title&&performance.now()-start<3000)await new Promise(r=>setImmediate(r));return +(performance.now()-t).toFixed(2);};
  const projectsMs=await navTo('案件','案件');
  const tasksMs=await navTo('タスク','タスク');
  const rpcForThreeViews=h.calls.filter(c=>!c.write).length;
  return {client:'previous',firstLoadMs,firstLoadRpc:rpcAfterInitialLoad,rpcForOverviewProjectsTasks:rpcForThreeViews,projectsNavigationMs:projectsMs,tasksNavigationMs:tasksMs};
}

if(require.main===module){benchmark().then(report=>{const output=path.resolve(__dirname,'../docs/checkgates/'+OUTPUT);fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));});}
module.exports={benchmark,measure,uiBenchmark,previousUiBenchmark,quantile};
