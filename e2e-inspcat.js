/* Does the category->parameter chain actually resolve now? READ-ONLY. */
const { launch, openApp, call } = require('./e2e-lib');
(async () => {
  const b = await launch();
  const { ctx, rpc } = await openApp(b);
  const mats = await call(rpc, 'getMaterials', []);
  const withCat = (mats||[]).filter(m => (m.inspectionCategory||'').trim());
  console.log('materials: '+(mats||[]).length+'  withInspectionCategory: '+withCat.length);
  const seen = {}; const probe=["2967583","3050437","2963401"];
  withCat.forEach(m => { const c=m.inspectionCategory; if(!seen[c]) seen[c]=m; });
  for (const [cat, m] of Object.entries(seen)) {
    const p = await call(rpc, 'getIqcParamsForProduct', [m.code||m.itemCode]);
    const n = p && p.params ? (p.params.length+' fallback='+p.fallback+' cat='+p.category) : (p&&p.__err?'ERR '+p.__err:JSON.stringify(p).slice(0,70));
    console.log('  '+cat.padEnd(13)+' '+String(m.code||m.itemCode).padEnd(16)+' params='+n);
  }
  // a material left blank must still fall back, not break
  const blank = (mats||[]).find(m => !(m.inspectionCategory||'').trim());
  if (blank) {
    const p = await call(rpc, 'getIqcParamsForProduct', [blank.code||blank.itemCode]);
    console.log('  (blank cat)   '+String(blank.code||blank.itemCode).padEnd(16)+' params='+(p&&p.params?p.params.length+' fallback='+p.fallback:'?'));
  }
  console.log("-- user-confirmed mappings --");
  for(const c of probe){const m=(mats||[]).find(x=>String(x.code||x.itemCode)===c);const p=await call(rpc,"getIqcParamsForProduct",[c]);console.log("  "+c.padEnd(16)+String(m&&m.category||"?").padEnd(10)+"-> "+String(m&&m.inspectionCategory||"(blank)").padEnd(13)+" params="+(p&&p.params?p.params.length+" fallback="+p.fallback:"?"));}
  await ctx.close(); await b.close();
})();
