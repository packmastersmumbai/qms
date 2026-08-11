const { launch, openApp, nav } = require('./e2e-lib');
(async()=>{
  const b=await launch(); const { page, app }=await openApp(b);
  await page.setViewportSize({width:1200,height:1000});
  await nav(app,page,'GRN'); await page.waitForTimeout(14000);
  for(const w of [390,768,1280]){
    await page.setViewportSize({width:w,height:1000}); await page.waitForTimeout(1200);
    let fr=null;
    for(const f of page.frames()){ try{ if(await f.evaluate(()=>!!document.getElementById('formWrap'))) fr=f; }catch(_){} }
    const r=await fr.evaluate(()=>{
      const g=id=>{const e=document.getElementById(id); const b=e.getBoundingClientRect();
        return {top:Math.round(b.top),w:Math.round(b.width)};};
      const hdr=document.querySelector('.fk-row.wide-first');
      return {cols:getComputedStyle(hdr).gridTemplateColumns,
        sup:g('supplier'),po:g('poRefSelect'),inv:g('invoiceNo'),
        cardH:Math.round(hdr.closest('.fk-card').getBoundingClientRect().height)};
    });
    const oneRow = r.sup.top===r.po.top && r.po.top===r.inv.top;
    console.log(w+'px  cols='+r.cols+'  cardH='+r.cardH+'  SAME-ROW='+(oneRow?'YES':'no')
      +'  sup='+r.sup.top+'/'+r.sup.w+' po='+r.po.top+'/'+r.po.w+' inv='+r.inv.top+'/'+r.inv.w);
  }
  await b.close();
})();
