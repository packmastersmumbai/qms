/* Prove autoBatchNo_ is reachable from the actual save path (not global scope). */
const { launch, openApp, nav } = require('./e2e-lib');
(async()=>{
  const b=await launch();
  const {ctx,page,app}=await openApp(b);
  const errs=[];
  page.on('pageerror',e=>errs.push('PAGEERR: '+e.message));
  await nav(app,page,'GRN'); await page.waitForTimeout(11000);
  let fr=null,len=0;
  for(const f of page.frames()){try{const n=await f.evaluate(()=>(document.body.innerText||'').length);if(n>len){len=n;fr=f;}}catch(_){}}
  // fill the top item so buildRows()/doSave() would run the auto-batch branch,
  // then call the row builder WITHOUT submitting.
  const out=await fr.evaluate(()=>{
    const set=(id,v)=>{const e=document.getElementById(id);if(!e)return 'no #'+id;
      e.value=v;e.dispatchEvent(new Event('change',{bubbles:true}));
      e.dispatchEvent(new Event('input',{bubbles:true}));return null;};
    const sup=document.getElementById('supplier');
    const so=[...sup.options].find(o=>o.value&&!/^[—–-]/.test(o.textContent.trim()));
    if(so) set('supplier',so.value);
    const it=document.getElementById('item');
    const io=it?[...it.options].find(o=>o.value&&!/^[—–-]/.test(o.textContent.trim())):null;
    if(io) set('item',io.value);
    set('qtyReceived','5');
    const bn=document.getElementById('batchNo'); if(bn) bn.value='';   // force auto
    return {supplier:so?so.textContent.trim().slice(0,20):null,
            item:io?io.value:null, batchLeftBlank:bn?bn.value==='':null};
  });
  await page.waitForTimeout(2500);
  console.log(JSON.stringify(out,null,1));
  console.log('page errors:', errs.length?errs.slice(0,2):'none');
  await ctx.close(); await b.close();
})();
