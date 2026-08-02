/* Drive IQC to screen 2, then measure the sticky footer + save button for real. */
const { launch, openApp, nav } = require('./e2e-lib');
(async()=>{
  const b=await launch();
  for(const vp of [{w:390,h:844,n:'phone'},{w:1280,h:800,n:'desktop'}]){
    const {ctx,page,app}=await openApp(b);
    await page.setViewportSize({width:vp.w,height:vp.h});
    await nav(app,page,'IQC'); await page.waitForTimeout(13000);
    let fr=null,len=0;
    for(const f of page.frames()){try{const n=await f.evaluate(()=>(document.body.innerText||'').length);if(n>len){len=n;fr=f;}}catch(_){}}
    // pick the first real GRN and advance
    const picked=await fr.evaluate(()=>{
      const s=document.getElementById('grnNo');
      if(!s) return 'no grnNo';
      const o=[...s.options].find(x=>x.value&&!/^[—–-]/.test(x.textContent.trim()));
      if(!o) return 'no real option';
      s.value=o.value; s.dispatchEvent(new Event('change',{bubbles:true}));
      return o.textContent.trim().slice(0,26);
    });
    await page.waitForTimeout(9000);
    await fr.evaluate(()=>{ try{ showSummary(); }catch(e){ return 'ERR '+e.message; } });
    await page.waitForTimeout(3000);
    const r=await fr.evaluate(()=>{
      const s2=document.getElementById('screen2');
      const f=document.querySelector('footer');
      const btn=document.getElementById('saveBtn');
      const g=e=>{if(!e)return null;const c=getComputedStyle(e),b=e.getBoundingClientRect();
        return {disp:c.display,op:c.opacity,pos:c.position,z:c.zIndex,
          t:Math.round(b.top),b:Math.round(b.bottom),h:Math.round(b.height),w:Math.round(b.width)};};
      let covered=null;
      if(btn){const b0=btn.getBoundingClientRect();
        const cx=Math.round(b0.left+b0.width/2),cy=Math.round(b0.top+b0.height/2);
        if(cx>0&&cy>0&&cy<innerHeight){const t=document.elementFromPoint(cx,cy);
          covered=(t&&t!==btn&&!btn.contains(t))?(t.id||t.tagName+'.'+String(t.className).slice(0,26)):null;}}
      return {screen2:g(s2),footer:g(f),saveBtn:g(btn),vh:innerHeight,
              covered, btnText:btn?(btn.textContent||'').trim().slice(0,24):null,
              bodyPadBottom:getComputedStyle(document.body).paddingBottom};
    });
    console.log('\n== '+vp.n+' ==  picked: '+picked);
    console.log(JSON.stringify(r,null,1));
    await ctx.close();
  }
  await b.close();
})();
