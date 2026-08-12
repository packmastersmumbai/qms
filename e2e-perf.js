const PW='C:/Users/Appex/AppData/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright';
const { chromium }=require(PW); const fs=require('fs'); const path=require('path');
const WRAP='https://packmastersmumbai.github.io/qms';
const STATE=path.join(__dirname,'e2e-storageState.json');
const wait=(p,ms)=>p.waitForTimeout(ms);
async function poll(page,fn,budget){ const t=Date.now();
  while(Date.now()-t<budget){ for(const f of page.frames()){
      try{ if(await f.evaluate(fn)) return Date.now()-t; }catch(_){} }
    await wait(page,250);} return null; }
(async()=>{
  const b=await chromium.launch({headless:true});
  const ctx=await b.newContext({viewport:{width:430,height:900},
    storageState:fs.existsSync(STATE)?STATE:undefined});
  const page=await ctx.newPage();
  const rpc=[];
  page.on('console',m=>{const t=m.text(); if(/__rpc/.test(t)) rpc.push(t);});
  const T=Date.now();
  await page.goto(WRAP+'?page=landing',{waitUntil:'domcontentloaded',timeout:60000});
  console.log('goto domcontentloaded      : '+(Date.now()-T)+'ms');
  const spa=await poll(page,()=>typeof window.navigateTo==='function',90000);
  console.log('SPA frame ready            : '+(spa!=null?(Date.now()-T)+'ms':'TIMEOUT'));
  const tiles=await poll(page,()=>document.querySelectorAll('.pm-tile').length>0,90000);
  console.log('tiles rendered             : '+(tiles!=null?(Date.now()-T)+'ms':'TIMEOUT'));
  const counts=await poll(page,()=>{const c=[...document.querySelectorAll('.pm-tile-count')];
    return c.length&&c.some(e=>/^\d+$/.test(e.textContent.trim()));},120000);
  console.log('COUNTS populated (usable)  : '+(counts!=null?(Date.now()-T)+'ms':'TIMEOUT'));
  await b.close();
})();
