const { launch, openApp, nav } = require('./e2e-lib');
(async()=>{
  const b=await launch(); const { page, app }=await openApp(b);
  await page.setViewportSize({width:390,height:844});
  await nav(app,page,'GRN');
  await page.waitForTimeout(15000);
  let fr=null;
  for(const f of page.frames()){
    try{ if(await f.evaluate(()=>!!document.getElementById('formWrap'))) fr=f; }catch(_){}
  }
  if(!fr){ console.log('NO FRAME'); await b.close(); return; }
  const r=await fr.evaluate(()=>{
    const out=[];
    document.querySelectorAll('#formWrap input, #formWrap select, #formWrap textarea').forEach(el=>{
      const rc=el.getBoundingClientRect(); if(rc.height<1) return;
      const cs=getComputedStyle(el);
      const lab=document.querySelector('label[for="'+el.id+'"]');
      const hint=el.parentElement?el.parentElement.querySelector('.fk-hint'):null;
      out.push({ id:el.id||'(no id)', tag:el.tagName.toLowerCase(),
        w:Math.round(rc.width), h:Math.round(rc.height),
        pctOfViewport: Math.round(rc.width/window.innerWidth*100),
        fontSize:cs.fontSize,
        hasLabel: !!lab, hasHint: !!hint,
        hintText: hint?(hint.textContent||'').trim().slice(0,40):'' });
    });
    return { fields: out, vw: window.innerWidth };
  });
  console.log('viewport', r.vw);
  r.fields.forEach(f=>console.log(
    f.id.padEnd(18)+f.tag.padEnd(9)+String(f.w).padStart(4)+'px ('+String(f.pctOfViewport).padStart(3)+'%)  h='+String(f.h).padStart(3)+
    '  label='+(f.hasLabel?'y':'N')+'  hint='+(f.hasHint?'y':'N')+'  '+f.hintText));
  await b.close();
})();
