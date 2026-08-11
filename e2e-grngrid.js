const { launch, openApp, nav } = require('./e2e-lib');
(async()=>{
  const b=await launch(); const { page, app }=await openApp(b);
  await page.setViewportSize({width:1200,height:1000});
  await nav(app,page,'GRN');
  await page.waitForTimeout(14000);
  let fr=null;
  for(const f of page.frames()){
    try{ if(await f.evaluate(()=>!!document.getElementById('formWrap'))) fr=f; }catch(_){}
  }
  if(!fr){ console.log('NO FRAME'); await b.close(); return; }
  const r=await fr.evaluate(()=>{
    const w=document.getElementById('formWrap');
    const ww=w.getBoundingClientRect().width;
    const out=[];
    w.querySelectorAll('.fk-card').forEach((c,i)=>{
      const rc=c.getBoundingClientRect();
      // widest right edge of any control inside this card = how much width is USED
      let maxRight=0;
      c.querySelectorAll('input,select,textarea,.img-tile,button').forEach(el=>{
        const r2=el.getBoundingClientRect();
        if(r2.width>2) maxRight=Math.max(maxRight, r2.right);
      });
      const used = maxRight? Math.round((maxRight-rc.left)/rc.width*100) : 0;
      out.push({i:i, h:Math.round(rc.height), usedPct:used,
        txt:(c.textContent||'').replace(/\s+/g,' ').trim().slice(0,34)});
    });
    return {formW:Math.round(ww), formH:Math.round(w.getBoundingClientRect().height), cards:out};
  });
  console.log('formW='+r.formW+'  formH='+r.formH);
  r.cards.forEach(c=>console.log('  card'+c.i+'  h='+String(c.h).padStart(4)+'px  widthUsed='+String(c.usedPct).padStart(3)+'%   '+c.txt));
  await b.close();
})();
