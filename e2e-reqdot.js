/* Did the navy dot actually render, and is red gone from required indicators? */
const { launch, openApp, nav } = require('./e2e-lib');
(async () => {
  const b = await launch();
  for (const mod of ['GRN','OQC','Gatepass']) {
    const { ctx, page, app } = await openApp(b);
    await nav(app, page, mod); await page.waitForTimeout(11000);
    let fr=null,len=0;
    for (const f of page.frames()){try{const n=await f.evaluate(()=>(document.body.innerText||'').length);if(n>len){len=n;fr=f;}}catch(_){}}
    console.log('\n== '+mod+' ==', JSON.stringify(await fr.evaluate(()=>{
      const els=[...document.querySelectorAll('.req,.req-dot')];
      const out=els.slice(0,3).map(e=>{const cs=getComputedStyle(e),r=e.getBoundingClientRect();
        return {cls:e.className,bg:cs.backgroundColor,color:cs.color,fs:cs.fontSize,
                w:Math.round(r.width),h:Math.round(r.height),visible:r.width>0&&r.height>0};});
      // any RED still painted on a required marker?
      const red=els.filter(e=>{const c=getComputedStyle(e).color+getComputedStyle(e).backgroundColor;
        return /220, 38, 38|239, 68, 68|248, 113/.test(c);}).length;
      return {count:els.length, redRemaining:red, sample:out};
    }),null,1));
    await ctx.close();
  }
  await b.close();
})();
