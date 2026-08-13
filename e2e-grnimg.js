// Real GRN save WITH images, through the live bridge.
const PW='C:/Users/Appex/AppData/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright';
const { chromium }=require(PW); const fs=require('fs'); const path=require('path');
const STATE=path.join(__dirname,'e2e-storageState.json');
const WRAP='https://packmastersmumbai.github.io/qms';
// 8x8 PNG — a real image, not a 1x1 placeholder.
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

  // 1. Upload images exactly as the form does.
  const up=await rpc.evaluate(px=>new Promise(res=>{
    const t=Date.now();
    google.script.run
      .withSuccessHandler(v=>res({ms:Date.now()-t,v:v}))
      .withFailureHandler(e=>res({ms:Date.now()-t,err:String(e&&e.message||e)}))
      .uploadGRNImages([
        {base64:px,mime:'image/png',kind:'doc'},
        {base64:px,mime:'image/png',kind:'product'}
      ]);
  }),PNG);
  console.log('uploadGRNImages : '+up.ms+'ms  '+(up.err?('ERR '+up.err):JSON.stringify(up.v).slice(0,150)));

  // 2. Save the GRN carrying those image URLs.
  const batch='IMGTEST-'+Date.now();
  const payload={
    date:new Date().toISOString().split('T')[0],
    supplierCode:'SUP-001', supplierName:'Deccan Cans',
    invoiceNo:'IMG-TEST', poRef:'', poNo:'',
    items:[{materialCode:'1308119', materialDesc:'LOCTITE BONDACE 007 POWDER 16KG',
            unit:'KG', qtyOrdered:5, qtyReceived:5, batchNo:batch,
            expiryDate:'', vehicleNo:'', qtyAccepted:5,
            disposition:'PENDING', locationId:'', poLineNo:null}],
    disposition:'PENDING', remarks:'image + pdf verification',
    coaReceived:'N', notifyWhatsapp:'N',
    // The FORM sends docImageUrls/productImageUrls (GRN_F.html:1804-1805).
    // An earlier version of this probe sent docImages/productImages, which
    // saveGRN ignores — the images uploaded fine but were never stamped.
    docImageUrls:(up.v&&up.v.docUrls)||[], productImageUrls:(up.v&&up.v.productUrls)||[],
    clientTxnId:'GRN-IMG-'+Date.now()
  };
  const sv=await rpc.evaluate(p=>new Promise(res=>{
    const t=Date.now();
    google.script.run
      .withSuccessHandler(v=>res({ms:Date.now()-t,v:v}))
      .withFailureHandler(e=>res({ms:Date.now()-t,err:String(e&&e.message||e)}))
      .saveGRN(p);
  }),payload);
  console.log('saveGRN         : '+sv.ms+'ms  '+(sv.err?('ERR '+sv.err):JSON.stringify(sv.v).slice(0,120)));
  console.log('batch           : '+batch);
  await b.close();
})();
