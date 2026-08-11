const { launch, openApp, nav } = require('./e2e-lib');
(async()=>{
  const b=await launch(); const { page, app }=await openApp(b);
  const errs=[]; page.on('pageerror',e=>errs.push(String(e&&e.message||e).slice(0,140)));
  await page.setViewportSize({width:1024,height:1000});
  await nav(app,page,'GRN');
  await page.waitForTimeout(14000);
  let fr=null;
  for(const f of page.frames()){
    try{ if(await f.evaluate(()=>!!document.getElementById('extra-items-list'))) fr=f; }catch(_){}
  }
  if(!fr){ console.log('NO FRAME'); await b.close(); return; }
  await fr.evaluate(()=>{ const d=document.querySelector('#extra-items-section details'); if(d) d.open=true; addExtraItem(); });
  await page.waitForTimeout(1200);
  const r=await fr.evaluate(()=>{
    const c=document.querySelector('.xi-card');
    if(!c) return {found:false};
    const cr=c.getBoundingClientRect();
    let maxRight=0;
    const fields=[];
    c.querySelectorAll('input,select').forEach(el=>{
      const b2=el.getBoundingClientRect(); if(b2.width<2) return;
      maxRight=Math.max(maxRight,b2.right);
      const wrap=el.closest('.fk-field');
      const lab=wrap?wrap.querySelector('.fk-label'):null;
      fields.push({cls:(el.className||'').split(' ').pop(), w:Math.round(b2.width),
        pct:Math.round(b2.width/cr.width*100),
        label: lab?lab.textContent.trim().replace(/\s+/g,' ').slice(0,22):'NONE',
        inlineStyle: el.getAttribute('style')||'none'});
    });
    return { found:true, h:Math.round(cr.height), usedPct:Math.round((maxRight-cr.left)/cr.width*100), fields:fields };
  });
  if(!r.found){ console.log('no .xi-card'); } else {
    console.log('xi-card height='+r.h+'px  widthUsed='+r.usedPct+'%');
    r.fields.forEach(f=>console.log('  '+f.cls.padEnd(10)+String(f.w).padStart(4)+'px('+String(f.pct).padStart(3)+'%)  label="'+f.label+'"  inline='+f.inlineStyle));
  }
  console.log('page errors:', errs.length?errs:'NONE');
  await b.close();
})();
