const { launch, openApp, nav } = require('./e2e-lib');
(async()=>{
  const b=await launch(); const { page, app }=await openApp(b);
  for (const vp of [{w:1024,h:1366,n:'iPad Pro land'},{w:820,h:1180,n:'iPad Air'}]) {
    await page.setViewportSize({width:vp.w,height:vp.h});
    await nav(app,page,'GRN');
    await page.waitForTimeout(14000);
    let fr=null;
    for(const f of page.frames()){
      try{ if(await f.evaluate(()=>!!document.getElementById('formWrap'))) fr=f; }catch(_){}
    }
    if(!fr){ console.log(vp.n+' NO FRAME'); continue; }
    const r=await fr.evaluate(()=>{
      const wrap=document.getElementById('formWrap');
      const ww=wrap.getBoundingClientRect().width;
      const out=[];
      ['item','storageLocation','qtyReceived','batchNo','invoiceNo'].forEach(id=>{
        const el=document.getElementById(id); if(!el) return;
        const rc=el.getBoundingClientRect();
        out.push(id+'='+Math.round(rc.width)+'px('+Math.round(rc.width/ww*100)+'% of form)');
      });
      const cards=[...wrap.querySelectorAll('.fk-card')].map(c=>Math.round(c.getBoundingClientRect().height));
      return { formW:Math.round(ww), formH:Math.round(wrap.getBoundingClientRect().height),
               fields:out, cards:cards, mq900:window.matchMedia('(min-width:900px)').matches,
               fine:window.matchMedia('(pointer:fine)').matches };
    });
    console.log(vp.n+' vw='+vp.w+' formW='+r.formW+' formH='+r.formH+' mq900='+r.mq900+' pointerFine='+r.fine);
    console.log('   '+r.fields.join('  '));
    console.log('   cards: '+r.cards.join(', '));
  }
  await b.close();
})();
