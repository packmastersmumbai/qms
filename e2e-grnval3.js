const PW='C:/Users/Appex/AppData/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright';
const { chromium }=require(PW); const fs=require('fs'); const path=require('path');
const STATE=path.join(__dirname,'e2e-storageState.json');
const WRAP='https://packmastersmumbai.github.io/qms';
const PNG='iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAJUlEQVR42mNk+M9QzzCKR8EoHgWjeBSM4lEwikfBKB4Fo3jYYQBHmwX9AAAAAElFTkSuQmCC';
(async()=>{
  const b=await chromium.launch({headless:true});
  const ctx=await b.newContext({viewport:{width:430,height:900},
    storageState:fs.existsSync(STATE)?STATE:undefined});
  const page=await ctx.newPage();
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
  await fr.evaluate(bn=>{
    const b=document.getElementById('batchNo'); b.value=bn;
    b.dispatchEvent(new Event('input',{bubbles:true}));
    const q=document.getElementById('qtyReceived'); q.value='7';
    q.dispatchEvent(new Event('input',{bubbles:true}));
  },'E2E-'+Date.now());
  const tmp=path.join(require('os').tmpdir(),'pmqms-e2e.png');
  fs.writeFileSync(tmp,Buffer.from(PNG,'base64'));
  await (await fr.$('input.img-file-input[data-kind="doc"]')).setInputFiles(tmp);
  await page.waitForTimeout(4000);

  const diag=await fr.evaluate(()=>{
    const v = (typeof window.validate==='function') ? window.validate() : 'no validate';
    const vals={};
    ['supplier','item','batchNo','qtyReceived','invoiceNo'].forEach(id=>{
      const e=document.getElementById(id); vals[id]=e?String(e.value).slice(0,28):'(missing)';
    });
    // Which error messages are visible?
    const shown=[...document.querySelectorAll('.field-error-msg')]
      .filter(e=>getComputedStyle(e).display!=='none'&&e.offsetHeight>0)
      .map(e=>e.id+': '+e.textContent.trim().slice(0,40));
    return { validate:v, vals:vals, shownErrors:shown,
             disposition: (typeof disposition!=='undefined')?String(disposition):'(undefined)',
             activePO: (typeof _activePO!=='undefined'&&_activePO)?'set':'null' };
  });
  console.log(JSON.stringify(diag,null,1));
  await b.close();
})();
