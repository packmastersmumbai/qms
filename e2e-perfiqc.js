const PW='C:/Users/Appex/AppData/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright';
const { chromium }=require(PW); const fs=require('fs'); const path=require('path');
const WRAP='https://packmastersmumbai.github.io/qms';
const STATE=path.join(__dirname,'e2e-storageState.json');
async function pollF(page,fn,budget){ const t=Date.now();
  while(Date.now()-t<budget){ for(const f of page.frames()){
      try{ if(await f.evaluate(fn)) return f; }catch(_){} }
    await page.waitForTimeout(200);} return null; }
(async()=>{
  const b=await chromium.launch({headless:true});
  const ctx=await b.newContext({viewport:{width:430,height:900},
    storageState:fs.existsSync(STATE)?STATE:undefined});
  const page=await ctx.newPage();
  const errs=[];
  page.on('pageerror',e=>errs.push('PAGEERR: '+e.message.slice(0,120)));
  page.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text().slice(0,120));});
  await page.goto(WRAP+'?page=landing',{waitUntil:'domcontentloaded',timeout:60000});
  const rpc=await pollF(page,()=>!!(window.google&&google.script&&google.script.run),90000);
  // Time IQC's boot RPC directly over the bridge, twice.
  for(let i=0;i<2;i++){
    const r=await rpc.evaluate(()=>new Promise(res=>{
      const t=Date.now();
      google.script.run.withSuccessHandler(d=>res({ms:Date.now()-t,
        grns:(d&&d.recentGRNs||[]).length, insp:(d&&d.inspectors||[]).length}))
        .withFailureHandler(e=>res({ms:Date.now()-t,err:String(e&&e.message).slice(0,90)}))
        .getIQCFormInit();
    }));
    console.log('getIQCFormInit #'+(i+1)+': '+r.ms+'ms  recentGRNs='+r.grns+' inspectors='+r.insp+(r.err?'  ERR='+r.err:''));
  }
  console.log('--- page errors ('+errs.length+') ---');
  errs.slice(0,6).forEach(e=>console.log('  '+e));
  await b.close();
})();
