const { launch, openApp, nav } = require('./e2e-lib');
(async () => {
  const b = await launch();
  const { ctx, page, app } = await openApp(b);
  await nav(app, page, 'Records'); await page.waitForTimeout(11000);
  let fr=null,len=0;
  for (const f of page.frames()){try{const n=await f.evaluate(()=>(document.body.innerText||'').length);if(n>len){len=n;fr=f;}}catch(_){}}
  console.log(JSON.stringify(await fr.evaluate(()=>{
    const de=document.getElementById('customDate');
    const rules=[];
    for(const sh of document.styleSheets){
      try{for(const r of sh.cssRules){
        if(r.selectorText&&/date-expander/.test(r.selectorText))
          rules.push(r.selectorText+' { '+r.style.cssText.slice(0,90)+' }');
      }}catch(e){}
    }
    const before=getComputedStyle(de).gridTemplateRows;
    de.classList.add('is-open');
    const after=getComputedStyle(de).gridTemplateRows;
    const childH=de.firstElementChild?Math.round(de.firstElementChild.getBoundingClientRect().height):null;
    de.classList.remove('is-open');
    return {classList:de.className, before, after, childH, rules};
  }),null,1));
  await ctx.close(); await b.close();
})();
