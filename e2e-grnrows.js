const { launch, openApp, nav } = require('./e2e-lib');
(async()=>{
  const b=await launch(); const { page, app }=await openApp(b);
  await page.setViewportSize({width:1200,height:1000});
  await nav(app,page,'GRN');
  await page.waitForTimeout(14000);
  for(const w of [768,960,1280]){
    await page.setViewportSize({width:w,height:1000});
    await page.waitForTimeout(1200);
    let fr=null;
    for(const f of page.frames()){
      try{ if(await f.evaluate(()=>!!document.getElementById('formWrap'))) fr=f; }catch(_){}
    }
    if(!fr){ console.log(w+': NO FRAME'); continue; }
    const r=await fr.evaluate(()=>{
      const rowsOf = el => { if(!el) return [];
        const t=new Set();
        [...el.children].forEach(c=>{ const b=c.getBoundingClientRect();
          if(b.width>2&&b.height>2) t.add(Math.round(b.top)); });
        return [...t].sort((a,b)=>a-b); };
      const grid=document.querySelector('#formWrap .fk-card > .fk-grid');
      const hdr=document.querySelector('.fk-row.wide-first');
      const f=id=>{const e=document.getElementById(id); if(!e) return null;
        const b=e.getBoundingClientRect(); return Math.round(b.top)+'@'+Math.round(b.width);};
      return { hdrRows:rowsOf(hdr), gridRows:rowsOf(grid),
        cols: grid?getComputedStyle(grid).gridTemplateColumns:null,
        pos:{sup:f('f-supplier'),po:f('poRefSelect'),inv:f('invoiceNo'),
             item:f('f-item'),batch:f('f-batchNo'),exp:f('f-expiry'),
             qty:f('f-qtyReceived'),stor:f('f-storage-loc')} };
    });
    console.log('--- '+w+'px ---');
    console.log(' header rows: '+r.hdrRows.length+'  '+JSON.stringify(r.hdrRows));
    console.log(' item rows  : '+r.gridRows.length+'  '+JSON.stringify(r.gridRows));
    console.log(' grid cols  : '+r.cols);
    console.log(' pos        : '+JSON.stringify(r.pos));
  }
  await b.close();
})();
