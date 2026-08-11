const { launch, openApp, nav } = require('./e2e-lib');
(async()=>{
  const b=await launch();
  const { page, app }=await openApp(b);
  for (const vp of [{w:390,h:844,n:'iPhone 14'},{w:768,h:1024,n:'iPad'}]) {
    await page.setViewportSize({width:vp.w,height:vp.h});
    await nav(app,page,'GRN');
    await page.waitForTimeout(15000);
    let fr=null;
    for(const f of page.frames()){
      try{ if(await f.evaluate(()=>!!document.getElementById('formWrap'))) fr=f; }catch(_){}
    }
    if(!fr){ console.log(vp.n+': NO FRAME'); continue; }
    const r=await fr.evaluate(()=>{
      const w=document.getElementById('formWrap');
      const cs=getComputedStyle(w);
      const cards=[...w.querySelectorAll('.fk-card')].map(c=>Math.round(c.getBoundingClientRect().height));
      const fields=[...w.querySelectorAll('.fk-field')].length;
      const rows=[...w.querySelectorAll('.fk-row')].length;
      const hint=document.getElementById('submitHint');
      const hr=hint?hint.getBoundingClientRect():null;
      const foot=document.getElementById('stickyFooter');
      const fbr=foot?foot.getBoundingClientRect():null;
      return { formH:Math.round(w.getBoundingClientRect().height), gap:cs.gap,
               cardHeights:cards, cardCount:cards.length, fields:fields, rows:rows,
               viewportH:window.innerHeight,
               screensToScroll:+(w.getBoundingClientRect().height/window.innerHeight).toFixed(2),
               hintVisible: hr?(hr.top<window.innerHeight && hr.bottom>0):null,
               hintTop: hr?Math.round(hr.top):null,
               footerTop: fbr?Math.round(fbr.top):null };
    });
    console.log(vp.n+' ('+vp.w+'x'+vp.h+'): '+JSON.stringify(r));
  }
  await b.close();
})();
