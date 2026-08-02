/* critique-ux: hierarchy / affordance / density measured against task completion.
   Simulates the operator path: open form -> find primary action -> can they submit? READ-ONLY. */
const { launch, openApp, nav } = require('./e2e-lib');
const SCREENS = ['GRN','IQC','OQC','Records'];
(async () => {
  const b = await launch();
  for (const mod of SCREENS) {
    const { ctx, page, app } = await openApp(b);
    await nav(app, page, mod); await page.waitForTimeout(mod==='IQC'?13000:11000);
    let fr=null,len=0;
    for (const f of page.frames()){try{const n=await f.evaluate(()=>(document.body.innerText||'').length);if(n>len){len=n;fr=f;}}catch(_){}}
    const r = await fr.evaluate(() => {
      const vis=el=>{const b=el.getBoundingClientRect();if(!(b.width>0&&b.height>0))return false;
        for(let n=el;n&&n!==document.documentElement;n=n.parentElement){const cs=getComputedStyle(n);
          if(cs.visibility==='hidden'||cs.display==='none'||parseFloat(cs.opacity)===0)return false;}return true;};
      const acts=[...document.querySelectorAll('button,a[href],[role=button],[onclick]')].filter(vis);
      // the PRIMARY action = biggest filled button in the lower third or sticky footer
      const scored = acts.map(e=>{const b=e.getBoundingClientRect(),cs=getComputedStyle(e);
        const filled=!/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor);
        return {t:(e.textContent||'').trim().slice(0,28),area:Math.round(b.width*b.height),
          filled,disabled:e.disabled===true,top:Math.round(b.top),h:Math.round(b.height)};})
        .sort((a,b)=>b.area-a.area);
      const primary = scored.find(s=>s.filled) || scored[0];
      // required fields the operator must complete before that action unlocks
      const req=[...document.querySelectorAll('[required],.req')].filter(vis).length;
      const inputs=[...document.querySelectorAll('input,select,textarea')].filter(vis);
      const empty=inputs.filter(i=>!i.value||/^(—|-|\s*$)/.test(i.value)).length;
      return {
        primary, topActions:scored.slice(0,3),
        actionCount:acts.length, requiredMarkers:req,
        inputs:inputs.length, emptyInputs:empty,
        // density: how much must the eye process before the first field?
        textNodes:[...document.querySelectorAll('body *')].filter(e=>e.children.length===0&&vis(e)&&e.textContent.trim()).length,
        scrollH:document.documentElement.scrollHeight, viewH:window.innerHeight,
        foldsToScroll:+(document.documentElement.scrollHeight/window.innerHeight).toFixed(1),
        // is the primary action reachable without scrolling?
        primaryAboveFold: primary ? primary.top < window.innerHeight : null,
      };
    });
    console.log('\n===== '+mod+' =====');
    console.log(JSON.stringify(r,null,1));
    await ctx.close();
  }
  await b.close();
})();
