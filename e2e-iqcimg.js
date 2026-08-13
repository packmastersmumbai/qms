// Real IQC save WITH images, against a real pending GRN.
const PW='C:/Users/Appex/AppData/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright';
const { chromium }=require(PW); const fs=require('fs'); const path=require('path');
const STATE=path.join(__dirname,'e2e-storageState.json');
const WRAP='https://packmastersmumbai.github.io/qms';
const PNG='iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAJUlEQVR42mNk+M9QzzCKR8EoHgWjeBSM4lEwikfBKB4Fo3jYYQBHmwX9AAAAAElFTkSuQmCC';
const GRN=process.argv[2]||'PM/GRN/2026-130';
(async()=>{
  const b=await chromium.launch({headless:true});
  const ctx=await b.newContext({storageState:fs.existsSync(STATE)?STATE:undefined});
  const page=await ctx.newPage();
  await page.goto(WRAP+'?page=landing',{waitUntil:'domcontentloaded',timeout:60000});
  let rpc=null;
  for(let i=0;i<60&&!rpc;i++){ for(const f of page.frames()){
    try{ if(await f.evaluate(()=>!!(window.google&&google.script&&google.script.run))) rpc=f; }catch(_){}}
    if(!rpc) await page.waitForTimeout(400); }

  // Confirm the GRN is inspectable.
  const init=await rpc.evaluate(()=>new Promise(res=>{
    google.script.run.withSuccessHandler(d=>res({n:(d.recentGRNs||[]).length,
      first:(d.recentGRNs||[])[0]||null, all:(d.recentGRNs||[])}))
      .withFailureHandler(e=>res({err:String(e&&e.message)})).getIQCFormInit();
  }));
  console.log('pending GRNs for IQC : '+(init.n!=null?init.n:init.err));

  // Pin to a GRN whose batch we know, so the ledger can resolve the lot.
  const list=init.all||[];
  const pick=list.filter(g=>g.batch||g.batchNo)[0] || init.first || {};
  const target=pick.grnNo||GRN;
  console.log('inspecting           : '+target);

  // IQC images go through their own uploader.
  // Images travel INSIDE the save payload (data.images); uploadIQCImages_ is
  // private and called by saveIQC itself. Testing it standalone was wrong.
  // Use the GRN's ACTUAL material and batch. The first run passed batch
  // 'IMGTEST', which matches no lot, and the ledger correctly refused with
  // "Missing matCode/batch/location" — a bad test fixture, not a product bug.
  const g=pick;
  const mat=g.materialCode||'1308119';
  const bat=g.batch||g.batchNo||'';
  const desc=g.material||g.materialDesc||'';
  console.log('material/batch       : '+mat+' / '+(bat||'(none on GRN)'));
  const payload={
    date:new Date().toISOString().split('T')[0],
    grnNo:target, supplierName:'Deccan Cans', inspector:'QA E2E',
    aqlLevel:'2.5', inspLevel:'II', severity:'Normal', lotSize:5,
    disposition:'ACCEPT', remarks:'pdf + image verification',
    sampleId:'', ncrRef:'', deviationRef:'',
    items:[{materialCode:mat, materialDesc:desc,
            batchNo:bat, sampleSize:2, acceptedQty:5, rejectedQty:0,
            params:{qty:'OK',pkg:'OK',colour:'OK',shape:'OK',dims:'OK',weight:'OK',
                    clean:'OK',odour:'OK',label:'OK',msds:'OK',shelf:'OK',coa:'OK'}}],
    images:[{base64:PNG,mime:'image/png'}],
    clientTxnId:'IQC-IMG-'+Date.now()
  };
  const sv=await rpc.evaluate(p=>new Promise(res=>{
    const t=Date.now();
    google.script.run
      .withSuccessHandler(v=>res({ms:Date.now()-t,v:v}))
      .withFailureHandler(e=>res({ms:Date.now()-t,err:String(e&&e.message||e)}))
      .saveIQC(p);
  }),payload);
  console.log('saveIQC              : '+sv.ms+'ms  '+(sv.err?('ERR '+sv.err):JSON.stringify(sv.v).slice(0,160)));
  await b.close();
})();
