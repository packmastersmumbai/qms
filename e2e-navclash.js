/* Is .fk-nav present and does it overlap each form's own fixed footer? */
const { launch, openApp, nav } = require('./e2e-lib');
(async()=>{
  const b=await launch();
  for(const mod of ['GRN','IQC','IPQC','OQC','NCR']){
    const {ctx,page,app}=await openApp(b);
    await page.setViewportSize({width:390,height:844});
    await nav(app,page,mod); await page.waitForTimeout(mod==='IQC'?13000:11000);
    let fr=null,len=0;
    for(const f of page.frames()){try{const n=await f.evaluate(()=>(document.body.innerText||'').length);if(n>len){len=n;fr=f;}}catch(_){}}
    console.log(mod.padEnd(9), JSON.stringify(await fr.evaluate(()=>{
      const nav0=document.querySelector('.fk-nav');
      const bars=[...document.querySelectorAll('*')].filter(e=>{
        const c=getComputedStyle(e);
        return c.position==='fixed'&&c.bottom==='0px'&&e.getBoundingClientRect().height>0
               &&!e.classList.contains('fk-nav');});
      const g=e=>{const c=getComputedStyle(e),r=e.getBoundingClientRect();
        return {z:c.zIndex,t:Math.round(r.top),h:Math.round(r.height)};};
      return {navPresent:!!nav0, nav:nav0&&nav0.getBoundingClientRect().height>0?g(nav0):null,
              ownBars:bars.slice(0,2).map(g)};
    }),0));
    await ctx.close();
  }
  await b.close();
})();
