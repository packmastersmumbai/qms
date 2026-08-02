/* Do the extracted tokens resolve at runtime, and is --pm-faint now AA? */
const { launch, openApp, nav } = require('./e2e-lib');
(async () => {
  const b = await launch();
  for (const mod of ['GRN','Production','Trace','KPI']) {
    const { ctx, page, app } = await openApp(b);
    await nav(app, page, mod); await page.waitForTimeout(11000);
    let fr=null,len=0;
    for (const f of page.frames()){try{const n=await f.evaluate(()=>(document.body.innerText||'').length);if(n>len){len=n;fr=f;}}catch(_){}}
    console.log('\n== '+mod+' ==', JSON.stringify(await fr.evaluate(()=>{
      const cs=getComputedStyle(document.documentElement);
      const tok=n=>cs.getPropertyValue(n).trim()||'(unset)';
      // a token that fails to resolve leaves the element painting its fallback,
      // so also sample a real element that consumes one
      const bordered=[...document.querySelectorAll('*')].find(e=>{
        const b=getComputedStyle(e).borderTopColor;
        return b==='rgb(226, 232, 240)';});
      return {pmBorder:tok('--pm-border'), pmPage:tok('--pm-page'),
              pmFaint:tok('--pm-faint'), pmChip:tok('--pm-chip'),
              fkBorder:tok('--fk-border'), fkFaint:tok('--fk-faint'),
              borderPaints:!!bordered};
    }),null,0));
    await ctx.close();
  }
  await b.close();
})();
