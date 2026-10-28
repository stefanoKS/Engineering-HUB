'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {base}=require('./fixtures');const {attachSnapshot,dashboardFor}=require('./dashboard-fixtures');
test('snapshot Date objects normalize to contract date strings before hash verification and viewer delivery',()=>{
 const a=base();a.context.Database.update('PROJECTS','P1',{Dashboard_Visibility:'INTERNAL',Last_Updated:'2026-10-27T01:00:00.000Z'});const snapshot=attachSnapshot(a);a.context.initializeSharedDashboardSnapshot('INITIALIZE SHARED DASHBOARD snapshot-db');
 const dates=new Set(['committedDeadline','forecastDeadline','deadline','plannedStart','dueDate','targetDate','actualDate','lastUpdated']);
 for(const sheet of snapshot.getSheets()){
  if(!sheet.getName().startsWith('PUBLISHED_')||sheet.getName()==='PUBLISHED_META')continue;
  const original=sheet.getDataRange.bind(sheet);
  sheet.getDataRange=()=>{const range=original(),get=range.getValues.bind(range);range.getValues=()=>{const rows=get();return rows.map((row,r)=>row.map((v,c)=>r&&dates.has(rows[0][c])&&/^\d{4}-\d{2}-\d{2}$/.test(String(v))?new Date(v+'T00:00:00+09:00'):v));};return range;};
 }
 const result=a.context.publishSharedDashboard();assert.equal(result.published,true);
 const viewer=dashboardFor(snapshot);const portfolio=viewer.context.dashboardPortfolio();assert.equal(portfolio.ok,true,JSON.stringify(portfolio));const text=JSON.stringify(portfolio.data);assert.match(text,/2026-12-31/);assert.doesNotMatch(text,/GMT|T15:00/);
 assert.equal(a.context.SharedDashboardModel.CONTRACT_VERSION,'1.4');
});
