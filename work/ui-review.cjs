const {chromium}=require('playwright');
const fs=require('node:fs');
(async()=>{
const b=await chromium.launch({headless:true});
const p=await b.newPage({viewport:{width:1440,height:900}});
 p.on('response',async r=>{if(r.url().includes('/api/')){let body;try{const j=await r.json();body={keys:Object.keys(j),error:j.error,message:j.message};}catch{}console.log(JSON.stringify({url:r.url(),status:r.status(),body}));}});
await p.goto('http://10.1.6.182:8050');
await p.getByLabel('社員番号',{exact:true}).fill(process.argv[2]);
await p.getByLabel('パスワード',{exact:true}).fill(process.argv[3]);
await p.getByRole('button',{name:'ログイン',exact:true}).click();
await p.waitForTimeout(2500);
const links=await p.locator('a').evaluateAll(es=>es.map(e=>({text:e.textContent,href:e.getAttribute('href')})));
console.log(JSON.stringify(links));
await p.screenshot({path:'work/review-home.png',fullPage:true});
console.log((await p.locator('body').innerText()).slice(0,12000));
fs.writeFileSync('work/review-nav.json',JSON.stringify(links));
// Keep authentication in memory while accepting read-only inspection commands.
const rl=require('node:readline').createInterface({input:process.stdin});
for await(const line of rl){try{const fn=new Function('p','b','fs','return (async()=>{'+line+'})()');console.log(await fn(p,b,fs));}catch(e){console.log(e.message)}console.log('READY');}
await b.close();
})();
