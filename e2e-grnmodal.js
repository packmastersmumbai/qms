const { launch, openApp, nav } = require('./e2e-lib');
(async()=>{
  const b=await launch(); const { page, app }=await openApp(b);
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
  await fr.evaluate(()=>{
    const set=(id,v)=>{const e=document.getElementById(id);if(!e)return;e.value=String(v);
      e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));};
    set('qtyReceived',7); set('batchNo','MODAL-'+Date.now());
    const d=document.getElementById('date'); if(d&&!d.value) set('date',new Date().toISOString().slice(0,10));
  });
  await fr.evaluate(()=>document.getElementById('btnSubmit').click());
  await page.waitForTimeout(3000);
  const r = await fr.evaluate(()=>{
    const mo=document.getElementById('opModal');
    if(!mo) return {present:false};
    const rect=mo.getBoundingClientRect();
    const sheet=mo.querySelector('.op-sheet');
    const sr=sheet?sheet.getBoundingClientRect():null;
    const nb=mo.querySelector('.op-name-btn');
    const nr=nb?nb.getBoundingClientRect():null;
    // Real hit test: what element is at the centre of the first name button?
    let hit=null;
    if(nr){ const el=document.elementFromPoint(nr.left+nr.width/2, nr.top+nr.height/2);
            hit = el?(el.className||el.tagName)+' "'+(el.textContent||'').trim().slice(0,18)+'"':'none'; }
    return { present:true,
      modalRect:{w:Math.round(rect.width),h:Math.round(rect.height),top:Math.round(rect.top)},
      sheetRect:sr?{w:Math.round(sr.width),h:Math.round(sr.height),top:Math.round(sr.top)}:null,
      nameBtnRect:nr?{w:Math.round(nr.width),h:Math.round(nr.height),top:Math.round(nr.top)}:null,
      elementAtNameBtn:hit,
      viewport:{w:window.innerWidth,h:window.innerHeight},
      inDom:document.body.contains(mo) };
  });
  console.log(JSON.stringify(r,null,1));
  await b.close();
})();
