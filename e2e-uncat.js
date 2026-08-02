/* Which materials are still uncategorised, grouped by their existing Category. READ-ONLY. */
const { launch, openApp, call } = require('./e2e-lib');
(async () => {
  const b = await launch();
  const { ctx, rpc } = await openApp(b);
  const mats = await call(rpc, 'getMaterials', []);
  const blank = (mats||[]).filter(m => !(m.inspectionCategory||'').trim());
  const by = {};
  blank.forEach(m => {
    const c = String(m.category||'(blank)').trim().toUpperCase();
    (by[c] = by[c] || []).push((m.code||m.itemCode)+'  '+String(m.desc||m.description||'').slice(0,52));
  });
  console.log('uncategorised: '+blank.length+' of '+(mats||[]).length);
  Object.entries(by).sort((a,b)=>b[1].length-a[1].length).forEach(([c,list])=>{
    console.log('\n== '+c+'  x'+list.length);
    list.slice(0,6).forEach(s=>console.log('   '+s));
    if(list.length>6) console.log('   ... +'+(list.length-6)+' more');
  });
  await ctx.close(); await b.close();
})();
