const {chromium}=require('playwright');
(async()=>{
const b=await chromium.launch({headless:true});
const p=await b.newPage({viewport:{width:1440,height:900}});
await p.goto('http://localhost:8050');
await p.waitForTimeout(1500);
console.log(await p.title());
console.log((await p.locator('body').innerText()).slice(0,6000));
await p.screenshot({path:'work/ui-audit-login.png',fullPage:true});
console.log(await p.locator('input').evaluateAll(es=>es.map(e=>({type:e.type,autocomplete:e.autocomplete,label:e.labels?.[0]?.textContent,border:getComputedStyle(e).borderColor}))));
await p.setViewportSize({width:390,height:844});
await p.screenshot({path:'work/ui-audit-login-mobile.png',fullPage:true});
console.log(await p.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,height:innerHeight,scrollHeight:document.documentElement.scrollHeight})));
await b.close();
})();
