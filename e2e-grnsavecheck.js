const { launch, openApp, nav } = require('./e2e-lib');
(async()=>{
  const b=await launch(); const { page, app }=await openApp(b);
  const errs=[]; page.on('pageerror',e=>errs.push(String(e&&e.message||e).slice(0,160)));
  await nav(app,page,'GRN');
  await page.waitForTimeout(18000);
  let fr=null;
  for(const f of page.frames()){
    try{ if(await f.evaluate(()=>!!document.getElementById('btnSubmit'))) fr=f; }catch(_){}
  }
  if(!fr){ console.log('NO FRAME'); await b.close(); return; }

  await fr.evaluate(async()=>{
    const s=document.getElementById('supplier');
    for(let i=0;i<30;i++){ if(s&&s.options.length>1) break; await new Promise(r=>setTimeout(r,500)); }
    s.value=s.options[1].value; s.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await page.waitForTimeout(6000);
  await fr.evaluate(async()=>{
    const s=document.getElementById('item');
    for(let i=0;i<30;i++){ if(s&&s.options.length>1) break; await new Promise(r=>setTimeout(r,500)); }
    s.value=s.options[1].value; s.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await page.waitForTimeout(3000);

  const batch='CLEAN-'+Date.now();
  // NO shim this time — completely untouched bridge.
  await fr.evaluate((bt)=>{
    const set=(id,v)=>{const e=document.getElementById(id);if(!e)return;e.value=String(v);
      e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));};
    set('qtyReceived',7); set('batchNo',bt);
    const d=document.getElementById('date'); if(d&&!d.value) set('date',new Date().toISOString().slice(0,10));
  }, batch);

  await fr.evaluate(()=>document.getElementById('btnSubmit').click());
  await page.waitForTimeout(2500);
  const modalVisible = await fr.evaluate(()=>{
    const mo=document.getElementById('opModal');
    if(!mo) return 'no modal';
    const cs=getComputedStyle(mo);
    return 'offsetParent='+(mo.offsetParent!==null)+' display='+cs.display+' visibility='+cs.visibility+' opacity='+cs.opacity+' zIndex='+cs.zIndex;
  });
  console.log('modal after click:', modalVisible);

  const ans = await fr.evaluate(()=>{
    const mo=document.getElementById('opModal'); if(!mo) return 'no modal';
    const nb=mo.querySelector('.op-name-btn'); if(!nb) return 'no name buttons';
    nb.click();
    const c=mo.querySelector('#opConfirmBtn');
    c.click();
    return 'confirmed as '+(nb.textContent||'').trim();
  });
  console.log('answered:', ans);

  // Poll the CONFIRM SCREEN / button label, plus errors
  for(let i=0;i<16;i++){
    await page.waitForTimeout(3000);
    const st=await fr.evaluate(()=>{
      const b=document.getElementById('btnSubmit');
      const conf=document.getElementById('confGrnId');
      return { label:b?(b.textContent||'').trim().slice(0,30):null, disabled:b?b.disabled:null,
               confirmShown: !!(conf && conf.offsetParent!==null), confText: conf?conf.textContent:'' };
    });
    if(st.confirmShown || /saved|done/i.test(st.label||'')) { console.log('OUTCOME:', JSON.stringify(st)); break; }
    if(i===15) console.log('FINAL STATE:', JSON.stringify(st));
  }
  console.log('batch:', batch);
  console.log('page errors:', errs.length?errs:'NONE');
  await b.close();
})();
