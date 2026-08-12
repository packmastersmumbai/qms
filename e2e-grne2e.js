// End-to-end: fill the REAL GRN form, attach a REAL image, save, verify.
const PW='C:/Users/Appex/AppData/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright';
const { chromium }=require(PW); const fs=require('fs'); const path=require('path');
const STATE=path.join(__dirname,'e2e-storageState.json');
const WRAP='https://packmastersmumbai.github.io/qms';

// A real 8x8 PNG (not 1x1 — compressImage_ draws it to a canvas).
const PNG_B64='iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAJUlEQVR42mNk+M9QzzCKR8EoHgWjeBSM4lEwikfBKB4Fo3jYYQBHmwX9AAAAAElFTkSuQmCC';

(async()=>{
  const b=await chromium.launch({headless:true});
  const ctx=await b.newContext({viewport:{width:430,height:900},
    storageState:fs.existsSync(STATE)?STATE:undefined});
  const page=await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message.slice(0,90)));

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
  if(!fr){ console.log('NO FORM FRAME'); await b.close(); return; }

  // Wait for the supplier list to populate, then pick the first real supplier.
  await fr.waitForFunction(()=>{const s=document.getElementById('supplier');
    return s&&s.options.length>1;},{timeout:90000});
  const sup=await fr.evaluate(()=>{
    const s=document.getElementById('supplier');
    s.value=s.options[1].value;
    s.dispatchEvent(new Event('change',{bubbles:true}));
    return s.options[1].textContent.trim();
  });
  console.log('supplier   : '+sup);

  // Material list fills after the supplier change.
  await fr.waitForFunction(()=>{const i=document.getElementById('item');
    return i&&!i.disabled&&i.options.length>1;},{timeout:90000});
  const mat=await fr.evaluate(()=>{
    const i=document.getElementById('item');
    i.value=i.options[1].value;
    i.dispatchEvent(new Event('change',{bubbles:true}));
    return i.options[1].textContent.trim();
  });
  console.log('material   : '+mat.slice(0,50));
  await page.waitForTimeout(1500);

  const batch='E2E-'+Date.now();
  await fr.evaluate(bn=>{
    const b=document.getElementById('batchNo'); b.value=bn;
    b.dispatchEvent(new Event('input',{bubbles:true}));
    b.dispatchEvent(new Event('blur',{bubbles:true}));
    const q=document.getElementById('qtyReceived'); q.value='7';
    q.dispatchEvent(new Event('input',{bubbles:true}));
    q.dispatchEvent(new Event('blur',{bubbles:true}));
  },batch);
  console.log('batch/qty  : '+batch+' / 7');

  // Attach a REAL image through the real file input.
  const tmp=path.join(require('os').tmpdir(),'pmqms-e2e.png');
  fs.writeFileSync(tmp,Buffer.from(PNG_B64,'base64'));
  const input=await fr.$('input.img-file-input[data-kind="doc"]');
  if(!input){ console.log('NO FILE INPUT'); await b.close(); return; }
  await input.setInputFiles(tmp);
  await page.waitForTimeout(4000);
  const imgCount=await fr.evaluate(()=>window._grnImages?_grnImages.length:-1);
  console.log('images held: '+imgCount);

  // Save.
  const before=await fr.evaluate(()=>document.getElementById('confGrnId')
    ? document.getElementById('confGrnId').textContent : '');
  await fr.evaluate(()=>{const b=document.getElementById('btnSubmit'); if(b){b.disabled=false; b.click();}});
  console.log('save tapped, waiting…');

  let docNo='';
  for(let i=0;i<60;i++){
    docNo=await fr.evaluate(()=>{const e=document.getElementById('confGrnId');
      return e?e.textContent.trim():'';});
    if(docNo && docNo!==before) break;
    await page.waitForTimeout(2000);
  }
  console.log('SAVED      : '+(docNo||'(no confirmation)'));
  console.log('page errors: '+errs.length+(errs.length?' -> '+errs[0]:''));
  await b.close();
})();
