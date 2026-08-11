const { launch, openApp, nav } = require('./e2e-lib');
(async()=>{
  const b=await launch(); const { page, app }=await openApp(b);
  const errs=[]; page.on('pageerror',e=>errs.push(String(e&&e.message||e).slice(0,140)));
  await page.setViewportSize({width:390,height:844});
  await nav(app,page,'GRN');
  await page.waitForTimeout(15000);
  let fr=null;
  for(const f of page.frames()){
    try{ if(await f.evaluate(()=>!!document.getElementById('btnSubmit'))) fr=f; }catch(_){}
  }
  if(!fr){ console.log('NO FRAME'); await b.close(); return; }

  console.log('qty hint rendered:', await fr.evaluate(()=>{
    const h=document.getElementById('hint-qtyReceived');
    return h?('"'+h.textContent.trim().slice(0,44)+'" visible='+(h.getBoundingClientRect().height>0)):'MISSING';
  }));
  console.log('unit chip:', await fr.evaluate(()=>{
    const c=document.getElementById('qtyUnit'); return c?('hidden='+c.hidden):'MISSING';
  }));

  // Blur an empty required field -> should turn invalid
  console.log('blur batchNo empty ->', await fr.evaluate(()=>{
    const el=document.getElementById('batchNo');
    el.dispatchEvent(new Event('blur'));
    const w=document.getElementById('f-batchNo');
    const err=document.getElementById('err-batchNo');
    return 'is-invalid='+w.classList.contains('is-invalid')+' errVisible='+(err.getBoundingClientRect().height>0)+' msg="'+err.textContent.trim()+'"';
  }));
  // Type a value -> error must clear
  console.log('after typing ->', await fr.evaluate(()=>{
    const el=document.getElementById('batchNo');
    el.value='B-2026-01'; el.dispatchEvent(new Event('input',{bubbles:true}));
    const w=document.getElementById('f-batchNo');
    return 'is-invalid='+w.classList.contains('is-invalid')+' is-valid='+w.classList.contains('is-valid');
  }));
  // Tap disabled Save -> toast + fields light up + scroll to first bad
  await fr.evaluate(()=>document.getElementById('btnSubmit').click());
  await page.waitForTimeout(900);
  console.log('after tapping blocked Save:', await fr.evaluate(()=>{
    const t=document.getElementById('toast');
    const tr=t.getBoundingClientRect();
    return 'toastShown='+t.className.indexOf('show')+' top='+Math.round(tr.top)+
      ' msg="'+t.textContent.trim().slice(0,58)+'" invalidCount='+document.querySelectorAll('#formWrap .fk-field.is-invalid').length;
  }));
  console.log('page errors:', errs.length?errs:'NONE');
  await b.close();
})();
