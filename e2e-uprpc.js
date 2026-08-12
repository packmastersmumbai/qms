const PW='C:/Users/Appex/AppData/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright';
const { chromium }=require(PW); const fs=require('fs'); const path=require('path');
const STATE=path.join(__dirname,'e2e-storageState.json');
const WRAP='https://packmastersmumbai.github.io/qms';
const PNG='iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAJUlEQVR42mNk+M9QzzCKR8EoHgWjeBSM4lEwikfBKB4Fo3jYYQBHmwX9AAAAAElFTkSuQmCC';
(async()=>{
  const b=await chromium.launch({headless:true});
  const ctx=await b.newContext({storageState:fs.existsSync(STATE)?STATE:undefined});
  const page=await ctx.newPage();
  await page.goto(WRAP+'?page=landing',{waitUntil:'domcontentloaded',timeout:60000});
  let rpc=null;
  for(let i=0;i<60&&!rpc;i++){ for(const f of page.frames()){
    try{ if(await f.evaluate(()=>!!(window.google&&google.script&&google.script.run))) rpc=f; }catch(_){}}
    if(!rpc) await page.waitForTimeout(400); }
  // Call uploadGRNImages directly over the bridge and time it.
  const r=await rpc.evaluate(px=>new Promise(res=>{
    const t=Date.now();
    const to=setTimeout(()=>res({ms:Date.now()-t,out:'TIMEOUT (no handler fired in 180s)'}),180000);
    google.script.run
      .withSuccessHandler(function(v){ clearTimeout(to);
        res({ms:Date.now()-t,out:JSON.stringify(v).slice(0,220)}); })
      .withFailureHandler(function(e){ clearTimeout(to);
        res({ms:Date.now()-t,out:'FAILURE: '+(e&&e.message||e)}); })
      .uploadGRNImages([{base64:px,mime:'image/png',kind:'doc'}]);
  }),PNG);
  console.log('uploadGRNImages over bridge: '+r.ms+'ms');
  console.log('  -> '+r.out);
  await b.close();
})();
