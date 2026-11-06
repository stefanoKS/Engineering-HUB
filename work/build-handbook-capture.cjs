const fs=require('node:fs');
let base=fs.readFileSync('work/ui-refresh-shots.mjs','utf8').split('const browser = await chromium.launch();')[0];
base=base.replace("http://localhost:5173","http://127.0.0.1:5178").replace("const OUT = 'work/screenshots'","const OUT = 'work/handbook-deepseek/images'");
const tail=String.raw`
const browser=await chromium.launch();
const evidence=[];
const requestQueue={...page([{requestId:'REQ-DEMO-001',taskId:'TSK-001',taskName:TASK_DETAIL.record.taskName,projectId:'PRJ-1',projectName:PROJECTS[0].projectName,subprojectName:'構造設計',requestType:'COMPLETION_REPORT',requesterName:'田中 技術者',requesterMemberId:'MEM-003',completionNote:'図面の修正と寸法確認が完了しました。',status:'PENDING',submittedAt:'2026-11-06T01:00:00Z',revision:1}]),imported:{configured:true,imported:0,failed:0,message:''}};
let context, tab;
async function role(name){
 if(context)await context.close();
 ADMIN.role=name;ADMIN.name=name==='MANAGER'?'鈴木 主任':'田中 技術者';ADMIN.memberId=name==='MANAGER'?'MEM-002':'MEM-003';
 context=await browser.newContext({viewport:{width:1440,height:900}});
 await context.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.origin!==ORIGIN){await route.abort();return;}
  if(!u.pathname.startsWith('/api/')){await route.continue();return;}
  if(u.pathname==='/api/manager/requests/sync'){await route.fulfill({status:200,json:{ok:true,data:requestQueue}});return;}
  if(route.request().method()!=='GET'){await route.fulfill({status:405,json:{ok:false,error:{code:'DOCUMENTATION_READ_ONLY',message:'Documentation capture never saves records',retryable:false,correlationId:'documentation'}}});return;}
  let result;
  if(u.pathname==='/api/employee/references') result={ok:true,data:{responsibilities:RESPONSIBILITIES.map(x=>({responsibilityId:x.id,name:x.name,status:'Active'}))}};
  else if(u.pathname==='/api/manager/projects'||u.pathname==='/api/work/projects')result={ok:true,data:page(PROJECTS,{responsibilities:RESPONSIBILITIES.map(x=>({responsibilityId:x.id,name:x.name}))})};
  else if(u.pathname==='/api/manager/requests')result={ok:true,data:requestQueue};
  else result=answer(u);
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
 });
 tab=await context.newPage();
 tab.on('pageerror',e=>console.log('PAGEERROR',e.message));
}
async function shot(id,path,action){
 await tab.goto(ORIGIN+'/#/'+path,{waitUntil:'networkidle'});
 await tab.reload({waitUntil:'networkidle'});
 if(action)await action(tab);
 await tab.waitForTimeout(250);
 await tab.screenshot({path:OUT+'/'+id+'.png'});
 const body=await tab.locator('body').innerText();
 evidence.push({id,role:ADMIN.role,path,source:'Current local frontend with synthetic API fixtures; not live verification',visibleText:body});
 console.log('CAPTURED',id);
}
await role('MANAGER');
await shot('G01-manager-overview','overview');
await shot('G02-manager-projects','projects');
await shot('G03-manager-project-detail','project/PRJ-1');
await shot('G04-manager-task-editor','task/TSK-001',async p=>{await p.getByRole('button',{name:'編集',exact:true}).click()});
await shot('G05-manager-task-detail','task/TSK-001');
await shot('G06-manager-timeline','timeline');
await shot('G07-manager-new-project','projects',async p=>{await p.getByRole('button',{name:'新規プロジェクト',exact:true}).click()});
await shot('G08-manager-requests','requests');
await shot('G09-manager-decision','requests',async p=>{await p.getByRole('button',{name:'承認',exact:true}).first().click()});
await role('MEMBER');
await shot('M01-member-my-work','my-work');
await shot('M02-member-completion','my-work',async p=>{await p.getByRole('button',{name:'完了報告',exact:true}).first().click()});
await shot('M03-member-extension','my-work',async p=>{await p.getByRole('button',{name:'その他',exact:true}).first().click();await p.getByRole('menuitem',{name:'納期変更を申請',exact:true}).click()});
await shot('M04-member-create-task','my-work',async p=>{await p.getByRole('button',{name:'新規タスク',exact:true}).click()});
await shot('M05-member-projects','projects');
await shot('M06-member-create-project','projects',async p=>{await p.getByRole('button',{name:'新規プロジェクト',exact:true}).click()});
await shot('M07-member-history','my-work',async p=>{await p.getByText(/自分の申請.*件/).first().click();await p.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight))});
await tab.setViewportSize({width:390,height:844});
await shot('C01-mobile-menu','my-work',async p=>{await p.getByRole('button',{name:'メニュー',exact:true}).click()});
await import('node:fs').then(m=>m.writeFileSync('work/handbook-deepseek/capture-evidence.json',JSON.stringify(evidence,null,2)));
await browser.close();
`;
fs.mkdirSync('work/handbook-deepseek/images',{recursive:true});
fs.writeFileSync('work/handbook-capture.mjs',base+tail);
