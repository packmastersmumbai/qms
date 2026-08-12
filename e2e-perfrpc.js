const PW='C:/Users/Appex/AppData/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright';
const { chromium }=require(PW); const fs=require('fs'); const path=require('path');
const WRAP='https://packmastersmumbai.github.io/qms';
const STATE=path.join(__dirname,'e2e-storageState.json');
async function poll(page,fn,budget){ const t=Date.now();
  while(Date.now()-t<budget){ for(const f of page.frames()){
      try{ if(await f.evaluate(fn)) return f; }catch(_){} }
    await page.waitForTimeout(200);} return null; }
(async()=>{
  const b=await chromium.launch({headless:true});
  const ctx=await b.newContext({viewport:{width:430,height:900},
    storageState:fs.existsSync(STATE)?STATE:undefined});
  const page=await ctx.newPage();
  await page.goto(WRAP+'?page=landing',{waitUntil:'domcontentloaded',timeout:60000});
  const rpc=await poll(page,()=>!!(window.google&&google.script&&google.script.run),90000);
  if(!rpc){ console.log('no rpc frame'); await b.close(); return; }
  // Time the SAME server fn over the real bridge, 3x, to separate server work
  // from transport. Server said getGRNFormInit ~1.8s.
  for(const fn of ['getGRNFormInit','getGRNFormInit','getGRNFormInit']){
    const ms=await rpc.evaluate(name=>new Promise(res=>{
      const t=Date.now();
      google.script.run.withSuccessHandler(()=>res(Date.now()-t))
        .withFailureHandler(()=>res(-1))[name]();
    }),fn);
    console.log(fn+' over bridge: '+ms+'ms');
  }
  await b.close();
})();
