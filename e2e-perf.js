/* Measure BEFORE optimizing. Which forms are actually slow, and why? */
const { launch, openApp, nav } = require('./e2e-lib');
(async () => {
  const b = await launch();
  for (const mod of ['Records','GRN','IQC','Production','KPI']) {
    const { ctx, page, app } = await openApp(b);
    const t0 = await page.evaluate(()=>performance.now()).catch(()=>0);
    await nav(app, page, mod); await page.waitForTimeout(mod==='IQC'?13000:11000);
    let fr=null,len=0;
    for (const f of page.frames()){try{const n=await f.evaluate(()=>(document.body.innerText||'').length);if(n>len){len=n;fr=f;}}catch(_){}}
    const r = await fr.evaluate(() => {
      const nav0 = performance.getEntriesByType('navigation')[0] || {};
      const paints = {};
      performance.getEntriesByType('paint').forEach(p=>paints[p.name]=Math.round(p.startTime));
      const res = performance.getEntriesByType('resource');
      const byType={};
      res.forEach(r0=>{const t=r0.initiatorType||'other';
        byType[t]=byType[t]||{n:0,bytes:0};byType[t].n++;byType[t].bytes+=(r0.transferSize||0);});
      return {
        domNodes: document.querySelectorAll('*').length,
        domDepth: (function d(e,n){let m=n;for(const c of e.children)m=Math.max(m,d(c,n+1));return m;})(document.body,0),
        images: document.querySelectorAll('img').length,
        imagesLazy: document.querySelectorAll('img[loading=lazy]').length,
        fcp: paints['first-contentful-paint']||null,
        domInteractive: Math.round(nav0.domInteractive||0),
        resources: res.length,
        byType: Object.fromEntries(Object.entries(byType).map(([k,v])=>[k,v.n+'/'+Math.round(v.bytes/1024)+'kb'])),
        longTasks: performance.getEntriesByType('longtask').length,
      };
    });
    console.log('\n== '+mod+' ==  nodes='+r.domNodes+' depth='+r.domDepth+
      ' img='+r.images+'(lazy '+r.imagesLazy+')'+
      ' fcp='+r.fcp+'ms domInteractive='+r.domInteractive+'ms res='+r.resources);
    console.log('   '+JSON.stringify(r.byType));
    await ctx.close();
  }
  await b.close();
})();
