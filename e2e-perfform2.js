const PW='C:/Users/Appex/AppData/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright';
const { chromium }=require(PW); const fs=require('fs'); const path=require('path');
const WRAP='https://packmastersmumbai.github.io/qms';
const STATE=path.join(__dirname,'e2e-storageState.json');
async function poll(page,fn,budget){ const t=Date.now();
  while(Date.now()-t<budget){ for(const f of page.frames()){
      try{ if(await f.evaluate(fn)) return Date.now()-t; }catch(_){} }
    await page.waitForTimeout(150);} return null; }
(async()=>{
  const b=await chromium.launch({headless:true});
  const ctx=await b.newContext({viewport:{width:430,height:900},
    storageState:fs.existsSync(STATE)?STATE:undefined});
  const page=await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message.slice(0,100)));
  await page.goto(WRAP+'?page=landing',{waitUntil:'domcontentloaded',timeout:60000});
  await poll(page,()=>typeof window.navigateTo==='function',90000);
  // give the landing prefetch time to park GRN init in sessionStorage
  await page.waitForTimeout(12000);
  const primed=await page.evaluate(()=>0); // noop
  let app=null;
  for(const f of page.frames()){ try{ if(await f.evaluate(()=>typeof window.navigateTo==='function')) app=f; }catch(_){} }
  const cacheState=await app.evaluate(()=>{
    try{ const r=sessionStorage.getItem('pmqms_init_v1_GRN');
      return r? 'PRIMED ('+Math.round(r.length/1024)+'KB)' : 'EMPTY'; }catch(e){ return 'ERR'; }
  });
  console.log('GRN init cache before nav : '+cacheState);
  const T=Date.now();
  await app.evaluate(()=>window.navigateTo('GRN'));
  await poll(page,()=>!!document.getElementById('formWrap'),90000);
  const shell=Date.now()-T;
  await poll(page,()=>{const s=document.getElementById('supplier');
    return s&&s.options&&s.options.length>1;},90000);
  const usable=Date.now()-T;
  const n=await (async()=>{ for(const f of page.frames()){
      try{ const v=await f.evaluate(()=>{const s=document.getElementById('supplier');
        return s?s.options.length:0;}); if(v) return v; }catch(_){} } return 0;})();
  console.log('GRN shell                 : '+shell+'ms');
  console.log('GRN USABLE (suppliers in) : '+usable+'ms   options='+n);
  console.log('page errors: '+errs.length+(errs.length?' -> '+errs[0]:''));
  await b.close();
})();
