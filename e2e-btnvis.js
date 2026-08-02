/* Are the submit buttons reachable at real device sizes? Checks obstruction and
   clipping, not just presence. READ-ONLY. */
const { launch, openApp, nav } = require('./e2e-lib');
const FORMS=['GRN','IQC','OQC','IPQC','Production','Dispatch','Gatepass','NCR','CustomerReturn','PO'];
const VPS=[{w:390,h:844,n:'phone'},{w:1280,h:800,n:'desktop'}];
(async()=>{
  const b=await launch();
  for(const vp of VPS){
    console.log('\n########## '+vp.n+' '+vp.w+'x'+vp.h+' ##########');
    for(const mod of FORMS){
      const {ctx,page,app}=await openApp(b);
      await page.setViewportSize({width:vp.w,height:vp.h});
      await nav(app,page,mod); await page.waitForTimeout(mod==='IQC'?13000:11000);
      let fr=null,len=0;
      for(const f of page.frames()){try{const n=await f.evaluate(()=>(document.body.innerText||'').length);if(n>len){len=n;fr=f;}}catch(_){}}
      if(!fr){console.log(mod.padEnd(15)+'NO FRAME');await ctx.close();continue;}
      const r=await fr.evaluate(()=>{
        const vis=el=>{const b=el.getBoundingClientRect();return b.width>0&&b.height>0;};
        // candidate submit/primary actions
        const btns=[...document.querySelectorAll('button')].filter(e=>vis(e)&&
          /save|submit|create|issue|book|release|confirm|dispatch|approve/i.test(e.textContent||''));
        return btns.slice(0,3).map(e=>{
          const r0=e.getBoundingClientRect();
          const cx=Math.round(r0.left+r0.width/2), cy=Math.round(r0.top+r0.height/2);
          const inView = r0.bottom<=innerHeight+1 && r0.top>=-1;
          // what is actually on top at the button's own centre?
          const top = (cx>=0&&cx<innerWidth&&cy>=0&&cy<innerHeight)
            ? document.elementFromPoint(cx,cy) : null;
          const covered = top && top!==e && !e.contains(top);
          return {t:(e.textContent||'').trim().slice(0,18), top:Math.round(r0.top),
            bottom:Math.round(r0.bottom), vh:innerHeight, inView, covered:!!covered,
            coveredBy: covered ? (top.id||top.tagName+'.'+String(top.className).slice(0,22)) : ''};
        });
      });
      r.forEach(x=>console.log(mod.padEnd(15)+x.t.padEnd(20)+
        'btm='+String(x.bottom).padStart(5)+'/'+x.vh+
        (x.inView?'  inView':'  **OFFSCREEN**')+
        (x.covered?('  **COVERED by '+x.coveredBy+'**'):'')));
      if(!r.length) console.log(mod.padEnd(15)+'(no submit-like button found)');
      await ctx.close();
    }
  }
  await b.close();
})();
