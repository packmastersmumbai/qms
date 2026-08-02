const { launch, openApp, nav } = require('./e2e-lib');
(async () => {
  const b = await launch();
  for (const mod of ["Records","Trace"]) {
    const { ctx, page, app } = await openApp(b);
    await nav(app, page, mod); await page.waitForTimeout(11000);
    let fr=null,len=0;
    for (const f of page.frames()) { try{const n=await f.evaluate(()=>(document.body.innerText||'').length); if(n>len){len=n;fr=f;}}catch(_){}}
    console.log('\n== '+mod+' ==', JSON.stringify(await fr.evaluate(()=>{
      const h=document.querySelector('header')||document.querySelector('[class*=topbar],[class*=hdr],[class*=si-top]');
      if(!h) return 'NO HEADER';
      const cs=getComputedStyle(h), r=h.getBoundingClientRect();
      return {tag:h.tagName, cls:String(h.className).slice(0,60), bg:cs.backgroundColor,
        bgImage:cs.backgroundImage.slice(0,40), color:cs.color, pos:cs.position,
        top:Math.round(r.top), h:Math.round(r.height), zIndex:cs.zIndex,
        parentBg:h.parentElement?getComputedStyle(h.parentElement).backgroundColor:null};
    }),null,1));
    await ctx.close();
  }
  await b.close();
})();
