/* Verify the harden pass on the live DOM: live regions, focus visibility, tab order. */
const { launch, openApp, nav } = require('./e2e-lib');
(async () => {
  const b = await launch();
  for (const mod of ['GRN','Trace','Production','Records']) {
    const { ctx, page, app } = await openApp(b);
    await nav(app, page, mod); await page.waitForTimeout(11000);
    let fr=null,len=0;
    for (const f of page.frames()){try{const n=await f.evaluate(()=>(document.body.innerText||'').length);if(n>len){len=n;fr=f;}}catch(_){}}
    const r = await fr.evaluate(() => {
      const vis=el=>{const b=el.getBoundingClientRect();return b.width>0&&b.height>0;};
      const focusables=[...document.querySelectorAll('button,a[href],input,select,textarea,[tabindex]:not([tabindex="-1"]),[role=button][tabindex]')].filter(vis);
      return {
        liveRegions: document.querySelectorAll('[aria-live]').length,
        liveRole: document.querySelectorAll('[role=status]').length,
        focusable: focusables.length,
        clickableDivsNoKeyboard: [...document.querySelectorAll('div[onclick]')]
          .filter(d=>!d.hasAttribute('tabindex')&&d.getAttribute('role')!=='button').length,
        roleButtonChips: document.querySelectorAll('[role=button][tabindex]').length,
      };
    });
    // walk the tab order and check each stop paints a visible focus indicator
    let ringed=0, checked=0;
    for (let i=0;i<Math.min(8,r.focusable);i++){
      await page.keyboard.press('Tab');
      const got = await fr.evaluate(()=>{const a=document.activeElement;
        if(!a||a===document.body)return null;
        const cs=getComputedStyle(a);
        const hasRing=(cs.outlineStyle!=='none'&&parseFloat(cs.outlineWidth)>0)||cs.boxShadow!=='none';
        return {tag:a.tagName,hasRing};}).catch(()=>null);
      if(got){checked++; if(got.hasRing) ringed++;}
    }
    console.log('\n== '+mod+' ==  liveRegions='+r.liveRegions+' role=status:'+r.liveRole+
      ' focusable='+r.focusable+' roleButtonChips='+r.roleButtonChips+
      ' divsNoKeyboard='+r.clickableDivsNoKeyboard+'  focusRing '+ringed+'/'+checked);
    await ctx.close();
  }
  await b.close();
})();
