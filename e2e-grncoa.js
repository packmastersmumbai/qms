const { launch, openApp, nav } = require('./e2e-lib');
(async()=>{
  const b=await launch(); const { page, app }=await openApp(b);
  await page.setViewportSize({width:1200,height:1000});
  await nav(app,page,'GRN'); await page.waitForTimeout(14000);
  for(const w of [390,768,960,1280]){
    await page.setViewportSize({width:w,height:1000}); await page.waitForTimeout(1200);
    let fr=null;
    for(const f of page.frames()){ try{ if(await f.evaluate(()=>!!document.getElementById('formWrap'))) fr=f; }catch(_){} }
    const r=await fr.evaluate(()=>{
      const grid=document.querySelector('#formWrap .fk-card > .fk-grid');
      const rows={};
      [...grid.children].forEach(c=>{
        const bb=c.getBoundingClientRect();
        if(bb.width<2||bb.height<2) return;
        // group by the row the CONTROL sits on, tolerant of label-height diffs
        const ctl=c.querySelector('input,select,.fk-switch-track')||c;
        const t=Math.round(ctl.getBoundingClientRect().top/12)*12;
        (rows[t]=rows[t]||[]).push(c.id||c.className.split(' ')[0]);
      });
      const coa=document.getElementById('f-coa').getBoundingClientRect();
      const card=grid.closest('.fk-card').getBoundingClientRect();
      return {rows, coa:{top:Math.round(coa.top),w:Math.round(coa.width),h:Math.round(coa.height)},
              cardH:Math.round(card.height)};
    });
    const keys=Object.keys(r.rows).sort((a,b)=>a-b);
    console.log('--- '+w+'px --- ROWS='+keys.length+'  cardH='+r.cardH+'  coa w='+r.coa.w+' h='+r.coa.h);
    keys.forEach(k=>console.log('    y'+k+': '+r.rows[k].join(', ')));
  }
  await b.close();
})();
