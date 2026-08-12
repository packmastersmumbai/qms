const PW='C:/Users/Appex/AppData/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright';
const { chromium }=require(PW); const fs=require('fs'); const path=require('path');
const STATE=path.join(__dirname,'e2e-storageState.json');
const WRAP='https://packmastersmumbai.github.io/qms';
const PNG_B64='iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAJUlEQVR42mNk+M9QzzCKR8EoHgWjeBSM4lEwikfBKB4Fo3jYYQBHmwX9AAAAAElFTkSuQmCC';
(async()=>{
  const b=await chromium.launch({headless:true});
  const ctx=await b.newContext({viewport:{width:430,height:900},
    storageState:fs.existsSync(STATE)?STATE:undefined});
  const page=await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message.slice(0,100)));
  await page.goto(WRAP+'?page=landing',{waitUntil:'domcontentloaded',timeout:60000});
  let app=null;
  for(let i=0;i<60&&!app;i++){ for(const f of page.frames()){
    try{ if(await f.evaluate(()=>typeof window.navigateTo==='function')) app=f; }catch(_){}}
    if(!app) await page.waitForTimeout(400); }
  await page.waitForTimeout(2500);
  await app.evaluate(()=>window.navigateTo('GRN'));
  await page.waitForTimeout(14000);
  let fr=null;
  for(const f of page.frames()){
    try{ if(await f.evaluate(()=>!!document.getElementById('formWrap'))) fr=f; }catch(_){}}

  await fr.waitForFunction(()=>{const s=document.getElementById('supplier');
    return s&&s.options.length>1;},{timeout:90000});
  await fr.evaluate(()=>{const s=document.getElementById('supplier');
    s.value=s.options[1].value; s.dispatchEvent(new Event('change',{bubbles:true}));});
  await fr.waitForFunction(()=>{const i=document.getElementById('item');
    return i&&!i.disabled&&i.options.length>1;},{timeout:90000});
  await fr.evaluate(()=>{const i=document.getElementById('item');
    i.value=i.options[1].value; i.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.waitForTimeout(1500);
  const batch='E2E-'+Date.now();
  await fr.evaluate(bn=>{
    const b=document.getElementById('batchNo'); b.value=bn;
    b.dispatchEvent(new Event('input',{bubbles:true}));
    const q=document.getElementById('qtyReceived'); q.value='7';
    q.dispatchEvent(new Event('input',{bubbles:true}));
  },batch);
  const tmp=path.join(require('os').tmpdir(),'pmqms-e2e.png');
  fs.writeFileSync(tmp,Buffer.from(PNG_B64,'base64'));
  await (await fr.$('input.img-file-input[data-kind="doc"]')).setInputFiles(tmp);
  await page.waitForTimeout(4000);

  // Instrument: what does the save button look like, and does doSave exist?
  const pre=await fr.evaluate(()=>{
    const b=document.getElementById('btnSubmit');
    return { hasBtn:!!b, disabled:b?b.disabled:null,
             label:b?b.textContent.trim().slice(0,30):'',
             doSave:typeof window.doSave,
             validate:typeof window.validate,
             imgs:(window._grnImages||[]).length };
  });
  console.log('pre-save   : '+JSON.stringify(pre));

  // Call doSave directly — bypasses any button-state gating.
  const called=await fr.evaluate(()=>{
    try{ if(typeof window.doSave==='function'){ window.doSave(); return 'doSave() called'; }
      return 'doSave NOT a function'; }catch(e){ return 'THREW '+e.message; }
  });
  console.log('invoke     : '+called);

  for(let i=0;i<70;i++){
    const st=await fr.evaluate(()=>({
      conf:(document.getElementById('confGrnId')||{}).textContent||'',
      toast:(document.getElementById('toast')||{}).textContent||'',
      err:(document.getElementById('errBox')||{}).textContent||''
    }));
    if(st.conf.trim()){ console.log('CONFIRMED  : '+st.conf.trim()); break; }
    if(i===69) console.log('last state : '+JSON.stringify(st));
    await page.waitForTimeout(2000);
  }
  console.log('page errors: '+errs.length+(errs.length?' -> '+errs.join(' | ').slice(0,200):''));
  await b.close();
})();
