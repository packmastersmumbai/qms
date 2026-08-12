const PW='C:/Users/Appex/AppData/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright';
const { chromium }=require(PW); const fs=require('fs'); const path=require('path');
const WRAP='https://packmastersmumbai.github.io/qms';
const STATE=path.join(__dirname,'e2e-storageState.json');
async function poll(page,fn,budget){ const t=Date.now();
  while(Date.now()-t<budget){ for(const f of page.frames()){
      try{ if(await f.evaluate(fn)) return Date.now()-t; }catch(_){} }
    await page.waitForTimeout(200);} return null; }
(async()=>{
  const b=await chromium.launch({headless:true});
  const ctx=await b.newContext({viewport:{width:430,height:900},
    storageState:fs.existsSync(STATE)?STATE:undefined});
  const page=await ctx.newPage();
  await page.goto(WRAP+'?page=landing',{waitUntil:'domcontentloaded',timeout:60000});
  await poll(page,()=>typeof window.navigateTo==='function',90000);
  await page.waitForTimeout(3000);
  for(const form of ['GRN','IQC','Records']){
    let app=null;
    for(const f of page.frames()){ try{ if(await f.evaluate(()=>typeof window.navigateTo==='function')) app=f; }catch(_){} }
    if(!app){ console.log(form+': no SPA frame'); continue; }
    const T=Date.now();
    await app.evaluate(n=>window.navigateTo(n),form);
    const dom=await poll(page,()=>!!document.getElementById('formWrap')||!!document.querySelector('.tab-btn'),90000);
    const t_dom=Date.now()-T;
    // usable = a populated dropdown (forms) or rows (records)
    const usable=await poll(page,()=>{
      const s=document.querySelector('#supplier,#grnRef,#item');
      if(s) return s.options && s.options.length>1;
      return document.querySelectorAll('.tab-btn').length>0;},90000);
    console.log(form.padEnd(9)+' shell='+String(t_dom).padStart(6)+'ms   usable(data)='
      +String(Date.now()-T).padStart(6)+'ms');
    await page.goto(WRAP+'?page=landing',{waitUntil:'domcontentloaded',timeout:60000});
    await poll(page,()=>typeof window.navigateTo==='function',90000);
    await page.waitForTimeout(2500);
  }
  await b.close();
})();
