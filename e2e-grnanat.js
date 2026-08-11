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
    document.querySelectorAll('#formWrap > *').forEach(el=>{
      const rc=el.getBoundingClientRect();
      if(rc.height<1) return;
      const label=(el.className||el.tagName).toString().slice(0,26);
      const txt=(el.textContent||'').replace(/\s+/g,' ').trim().slice(0,44);
      out.push({h:Math.round(rc.height), cls:label, txt:txt, hidden:getComputedStyle(el).display==='none'});
    });
    return out;
  });
  let tot=0; r.forEach(x=>{tot+=x.h; console.log(String(x.h).padStart(5)+'px  '+x.cls.padEnd(28)+x.txt);});
  console.log('total children:', tot);
  await b.close();
})();
