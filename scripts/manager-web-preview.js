'use strict';
// Local synthetic preview only. No Google credentials, live IDs or Workspace API calls.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {base, bulk} = require('../tests/fixtures');
function fixture(size=10) {
 const app=base({properties:{MANAGER_WEB_ALLOWED_DOMAINS:'example.test'}});
 if(size===0){['PROJECTS','SUBPROJECTS','TASKS'].forEach(name=>{const sheet=app.book.getSheetByName(name);sheet.getRange(2,1,sheet.getLastRow()-1,sheet.getLastColumn()).clearContent();});return app;}
 bulk(app,'RESPONSIBILITIES',[{Responsibility_ID:'R1',Name:'製品設計',Status:'Active',Sort_Order:1},{Responsibility_ID:'R2',Name:'工程設計',Status:'Retired',Sort_Order:2}]);
 bulk(app,'PROJECTS',Array.from({length:size},(_,i)=>({Project_ID:'P'+i,Project_Name:'検査装置の設計・製作 '+i,Project_Owner_ID:'M-MGR',Responsibility_ID:i%2?'R2':'R1',Status:i%10===9?'Archived':'Active',Committed_Deadline:'2026-12-18',Original_Deadline:'2026-12-18',Priority:'Medium',Dashboard_Visibility:'RESTRICTED',Progress_Percent:35,Health:i%3?'GREEN':'YELLOW',Last_Updated:'2026-10-01T00:00:00.000Z'})));
 bulk(app,'SUBPROJECTS',Array.from({length:size*2},(_,i)=>({Subproject_ID:'S'+i,Project_ID:'P'+Math.floor(i/2),Parent_Subproject_ID:i%2?'S'+(i-1):'',Subproject_Name:i%2?'詳細設計':'設計',Status:i%20===19?'Archived':'Active',Last_Updated:'2026-10-01T00:00:00.000Z'})));
 bulk(app,'TASKS',Array.from({length:size*10},(_,i)=>({Task_ID:'T'+i,Project_ID:'P'+Math.floor(i/10),Subproject_ID:'S'+(Math.floor(i/10)*2+i%2),Task_Name:'詳細設計タスク '+i,Owner_Member_ID:'M-ENG',Status:i%5?'In Progress':'Assigned',Priority:'Medium',Due_Date:'2026-12-18',Planned_Start:'2026-12-16',Planned_Duration_Value:3,Planned_Duration_Unit:'DAY',Planned_Duration_Basis:'WORKING_DAYS',Progress_Percent:25,Actual_Hours:8,Estimated_Hours:40,Last_Updated:'2026-10-01T00:00:00.000Z'})));
 bulk(app,'TASK_REQUESTS',Array.from({length:size?Math.max(2,Math.floor(size/5)):0},(_,i)=>({Request_ID:'REQ-'+i,Request_Type:i%2?'COMPLETION_REPORT':'DEADLINE_CHANGE',Task_ID:'T'+i,Project_ID:'P'+Math.floor(i/10),Requester_Name:'設計 担当者',Submitted_At:'2026-10-01T00:00:00.000Z',Original_Due_Date:'2026-12-18',Due_Date_At_Submission:'2026-12-18',Requested_Due_Date:i%2?'':'2026-12-22',Reason:'技術的問題',Explanation:'光学系の再評価が必要です。',Completion_Note:i%2?'検査が完了しました。':'',Status:'PENDING',Task_Revision_At_Submission:app.context.SharedDashboardModel.revision(app.context.Database.find('TASKS','T'+i))})));
 return app;
}
function html() {
 const root=path.resolve(__dirname,'../src');
 const read=name=>fs.readFileSync(path.join(root,name+'.html'),'utf8').replace(/<\?!=\s*include\('([^']+)'\);?\s*\?>/g,(_,part)=>read(part));
 const bridge=`<script>window.google={script:{get run(){var good,bad;return {withSuccessHandler:function(fn){good=fn;return this},withFailureHandler:function(fn){bad=fn;return this},managerWebRead:function(op,p){this.call('read',op,p)},managerWebWrite:function(op,p){this.call('write',op,p)},call:function(type,op,p){fetch('/rpc'+window.location.search,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:type,operation:op,payload:p})}).then(function(r){return r.json()}).then(good).catch(bad)}}}}};</script>`;
 return read('ManagerWebIndex').replace('<body>','<body>'+bridge+'<p style="margin:8px 24px">開発用プレビュー • 合成データ / Synthetic data only</p>');
}
function serve(port=4175){const apps={normal:fixture(),empty:fixture(0),large:fixture(300)},failures={};const server=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://127.0.0.1');const scenario=url.searchParams.get('scenario')||'normal';const app=apps[scenario]||apps.normal;res.setHeader('Cache-Control','no-store');if(req.method==='GET'&&url.pathname==='/'){failures[scenario]=0;res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html());return;}if(req.method==='POST'&&url.pathname==='/rpc'){let body='';for await(const chunk of req){body+=chunk;if(body.length>100000){res.writeHead(413);res.end();return;}}try{const p=JSON.parse(body);if(scenario==='slow')await new Promise(resolve=>setTimeout(resolve,2000));if(scenario==='error'&&!failures[scenario]++){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:false,error:'Synthetic connection error / 開発用の通信エラー'}));return;}const r=p.type==='write'?app.context.managerWebWrite(p.operation,p.payload):app.context.managerWebRead(p.operation,p.payload);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(r));}catch{res.writeHead(400);res.end('{}');}return;}res.writeHead(404);res.end();});server.listen(port,'127.0.0.1',()=>console.log('Synthetic manager preview: http://127.0.0.1:'+port));return server;}
if(require.main===module)serve();
module.exports={fixture,html,serve};
