const { launch, openApp, nav } = require('./e2e-lib');
(async()=>{
  const b=await launch(); const { page, app }=await openApp(b);
  await page.setViewportSize({width:1200,height:1000});
  await nav(app,page,'GRN'); await page.waitForTimeout(14000);
  for(const w of [768,960,1280]){
    await page.setViewportSize({width:w,height:1000}); await page.waitForTimeout(1200);
    let fr=null;
    for(const f of page.frames()){ try{ if(await f.evaluate(()=>!!document.getElementById('formWrap'))) fr=f; }catch(_){} }
    const r=await fr.evaluate(()=>{
      const box=id=>{const e=document.getElementById(id);const b=e.getBoundingClientRect();
        return {t:Math.round(b.top),b:Math.round(b.bottom),l:Math.round(b.left),r:Math.round(b.right)};};
      const q=box('f-qtyReceived'), s=box('f-storage-loc'), c=box('f-coa');
      // vertical overlap = same visual row
      const ov=(a,z)=>Math.max(0,Math.min(a.b,z.b)-Math.max(a.t,z.t));
      return {q,s,c, ovQC:ov(q,c), ovSC:ov(s,c),
              gridBottom:Math.round(document.querySelector('#formWrap .fk-card > .fk-grid').getBoundingClientRect().bottom)};
    });
    console.log(w+'px  qty['+r.q.l+'-'+r.q.r+'] stor['+r.s.l+'-'+r.s.r+'] coa['+r.c.l+'-'+r.c.r+']'
      +'   vOverlap qty/coa='+r.ovQC+'px  stor/coa='+r.ovSC+'px  => '
      +((r.ovQC>10&&r.ovSC>10)?'SAME ROW':'DIFFERENT ROW'));
  }
  await b.close();
})();
