const PW='C:/Users/Appex/AppData/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright';
const { chromium }=require(PW); const fs=require('fs'); const path=require('path');
const STATE=path.join(__dirname,'e2e-storageState.json');
const WRAP='https://packmastersmumbai.github.io/qms';
(async()=>{
  const b=await chromium.launch({headless:true});
  const ctx=await b.newContext({storageState:fs.existsSync(STATE)?STATE:undefined});
  const page=await ctx.newPage();
  await page.goto(WRAP+'?page=landing',{waitUntil:'domcontentloaded',timeout:60000});
  let rpc=null;
  for(let i=0;i<60&&!rpc;i++){ for(const f of page.frames()){
    try{ if(await f.evaluate(()=>!!(window.google&&google.script&&google.script.run))) rpc=f; }catch(_){}}
    if(!rpc) await page.waitForTimeout(400); }
  const batch='E2E-'+Date.now();
  const payload={
    date:new Date().toISOString().split('T')[0],
    supplierCode:'SUP-001', supplierName:'Deccan Cans',
    invoiceNo:'E2E-INV', poRef:'', poNo:'',
    items:[{materialCode:'1308119', materialDesc:'LOCTITE BONDACE 007 POWDER 16KG',
            unit:'KG', qtyOrdered:7, qtyReceived:7, batchNo:batch,
            expiryDate:'', vehicleNo:'', qtyAccepted:7,
            disposition:'PENDING', locationId:'', poLineNo:null}],
    disposition:'PENDING', remarks:'e2e drive verification',
    coaReceived:'N', notifyWhatsapp:'N',
    docImages:[], productImages:[],
    clientTxnId:'GRN-E2E-'+Date.now()
  };
  const r=await rpc.evaluate(p=>new Promise(res=>{
    const t=Date.now();
    const to=setTimeout(()=>res({ms:Date.now()-t,out:'TIMEOUT — no handler in 240s'}),240000);
    google.script.run
      .withSuccessHandler(function(v){ clearTimeout(to); res({ms:Date.now()-t,out:JSON.stringify(v).slice(0,300)}); })
      .withFailureHandler(function(e){ clearTimeout(to); res({ms:Date.now()-t,out:'FAILURE: '+(e&&e.message||e)}); })
      .saveGRN(p);
  }),payload);
  console.log('saveGRN over bridge: '+r.ms+'ms');
  console.log('  -> '+r.out);
  console.log('  batch: '+batch);
  await b.close();
})();
