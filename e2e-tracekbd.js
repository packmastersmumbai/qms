/* Trace chips only exist after a search. Run one, then check keyboard operability. */
const { launch, openApp, nav } = require('./e2e-lib');
(async () => {
  const b = await launch();
  const { ctx, page, app } = await openApp(b);
  await nav(app, page, 'Trace'); await page.waitForTimeout(11000);
  let fr=null,len=0;
  for (const f of page.frames()){try{const n=await f.evaluate(()=>(document.body.innerText||'').length);if(n>len){len=n;fr=f;}}catch(_){}}
  await fr.evaluate(()=>{const i=document.getElementById('qInput');
    i.value='PM/GRN/2026-093'; i.dispatchEvent(new Event('input',{bubbles:true}));
    document.getElementById('goBtn').click();});
  await page.waitForTimeout(12000);
  console.log(JSON.stringify(await fr.evaluate(()=>{
    const chips=[...document.querySelectorAll('[role=button][tabindex]')];
    const c=chips[0];
    let ring=null;
    if(c){c.focus();const cs=getComputedStyle(c);
      ring=(cs.outlineStyle!=='none'&&parseFloat(cs.outlineWidth)>0);}
    return {bodyText:(document.body.innerText||"").slice(0,180), allRoleBtn:document.querySelectorAll("[role=button]").length, chips:chips.length, firstFocusable:!!c && document.activeElement===c,
            focusRing:ring, sample:c?c.textContent.trim().slice(0,24):null};
  }),null,1));
  await ctx.close(); await b.close();
})();
